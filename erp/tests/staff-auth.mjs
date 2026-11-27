import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {randomBytes,randomUUID} from "node:crypto";
import {execFileSync} from "node:child_process";

const cfg=JSON.parse(readFileSync(process.argv[2],"utf8"));
const url=cfg.API_URL;
assert.ok(["127.0.0.1","localhost"].includes(new URL(url).hostname),"Local test environment required");
const anon=cfg.ANON_KEY,service=cfg.SERVICE_ROLE_KEY;
const password=randomBytes(24).toString("base64url");
async function post(path,token,body){
  const r=await fetch(url+path,{method:"POST",headers:{apikey:token===service?service:anon,Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify(body)});
  const txt=await r.text();let data;try{data=JSON.parse(txt)}catch{data={error:txt.slice(0,200)}}
  return {status:r.status,data,ok:r.ok};
}
async function accepted(response,step){const r=await response;assert.ok(r.ok,step+" "+r.status+" "+(r.data?.error??r.data?.message??""));return r.data;}
const email=label=>label+"-"+randomUUID()+"@example.invalid";
const ownerEmail=email("owner");
const owner=await accepted(post("/auth/v1/admin/users",service,{email:ownerEmail,password,email_confirm:true}),"Create test owner");
assert.match(owner.id,/^[0-9a-f-]{36}$/);
execFileSync("psql",[cfg.DB_URL,"-v","ON_ERROR_STOP=1","-c","insert into erp.roles(code,name) values('ERP_ADMIN','Test owner'); insert into erp.user_roles select '"+owner.id+"',id from erp.roles where code='ERP_ADMIN';"]);
const login=async(email)=> (await accepted(post("/auth/v1/token?grant_type=password",anon,{email,password}),"Employee sign-in")).access_token;
const ownerToken=await login(ownerEmail);
const edge=(token,params)=>post("/functions/v1/staff-access",token,params);
const manage=(op,p)=>post("/rest/v1/rpc/elhelw_staff_manage",ownerToken,{p_op:op,p});
const definitions=[["buyer",["purchases.catalog","purchases.manage","purchases.receive"]],["finance",["finance.read","finance.post"]],["production",["manufacturing.post"]]];
let buyerToken;
for(const [name,rights] of definitions){
  const mail=email(name);
  const create={op:"create",request:randomUUID(),name,email:mail,password,permissions:rights};
  await accepted(edge(ownerToken,create),"Create "+name);await accepted(edge(ownerToken,create),"Idempotent create");
  const token=await login(mail);
  const w=(await accepted(edge(token,{op:"workspace"}),"Open employee workspace")).data;
  assert.deepEqual([...w.permissions].sort(),rights.sort());assert.equal(w.can_manage_staff,false);
  assert.equal(Boolean(w.records.trial),name==="finance");assert.equal(Boolean(w.choices.quotes),name==="buyer");
  const direct=await fetch(url+"/rest/v1/suppliers?select=id",{headers:{apikey:anon,Authorization:"Bearer "+token}});assert.ok(!direct.ok,"Staff token must not carry legacy REST access");
  if(name==="buyer")buyerToken=token;
}
const list=await accepted(manage("list",{}),"Owner staff directory");assert.equal(list.length,3);
const buyer=list.find(x=>x.name==="buyer");
await accepted(manage("update",{...buyer,permissions:["inventory.read"],enabled:true}),"Update responsibilities");
const changed=(await accepted(edge(buyerToken,{op:"workspace"}),"Read changed session")).data;
assert.deepEqual(changed.permissions,["inventory.read"]);assert.equal(changed.choices.quotes,undefined);
await accepted(manage("update",{...buyer,revision:buyer.revision+1,permissions:[],enabled:false}),"Suspend employee");
assert.equal((await edge(buyerToken,{op:"workspace"})).status,403);
console.log("Three employee accounts signed in with independent permissions. Updates and suspension applied to the existing session.");
