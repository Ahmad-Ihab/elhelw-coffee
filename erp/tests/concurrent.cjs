// Run on a disposable ERP test database. Uses the same RPC as the application.
const assert = require("node:assert/strict");
const {randomUUID} = require("node:crypto");
const {Client} = require("pg");
async function main() {
  const setup = new Client(); await setup.connect();
  const db = (await setup.query("select current_database() name")).rows[0].name;
  assert.match(db,/^erp_test(?:_|$)/);
  const actor = randomUUID(), item = randomUUID(), lot = randomUUID(), source = randomUUID(), target = randomUUID();
  await setup.query("insert into auth.users(id) values($1)",[actor]);
  await setup.query("insert into erp.user_permissions values($1,'inventory.transfer',true)",[actor]);
  await setup.query("insert into erp.items(id,sku,name,kind,base_unit) values($1::uuid,$2::text,'Test','RM','KG')",[item,item]);
  await setup.query("insert into erp.lots(id,item_id,lot_code,quality_status) values($1,$2,'Test','released')",[lot,item]);
  await setup.query("insert into erp.locations(id,code,name,kind) values($1::uuid,($1::uuid)::text,'Source','storage'),($2::uuid,($2::uuid)::text,'Target','storage')",[source,target]);
  await setup.query("insert into erp.stock_balances values($1,$2,$3,10)",[item,lot,source]);
  await setup.query("insert into erp.item_valuation values($1,10,100)",[item]);
  const session = async () => {
    const c=new Client(); await c.connect();
    await c.query("set role authenticated");
    await c.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
    return c;
  };
  const a=await session(), b=await session();
  const move=(client,id,qty)=>client.query("select public.elhelw_erp_command('transfer',$1,$2) result",[{lot,from:source,to:target,qty},id]);
  try {
    const sameKey=randomUUID();
    await a.query("begin"); const first=await move(a,sameKey,4);
    const duplicate=move(b,sameKey,4); await a.query("commit");
    assert.deepEqual((await duplicate).rows,first.rows);
    await a.query("begin"); await move(a,randomUUID(),4);
    const oversell=assert.rejects(move(b,randomUUID(),4),/Insufficient unreserved stock/);
    await a.query("commit"); await oversell;
    const after = await setup.query("select quantity::float8 quantity from erp.stock_balances where item_id=$1 and location_id=$2",[item,source]);
    assert.equal(after.rows[0].quantity,2);
    assert.equal((await setup.query("select count(*)::int n from erp.stock_documents where created_by=$1",[actor])).rows[0].n,2);
    console.log("Concurrent retries and competing stock transfers passed");
  } finally {await Promise.all([a.end(),b.end(),setup.end()]);}
}
main().catch(error=>{console.error(error.message);process.exit(1);});
