import {test} from "node:test";
import assert from "node:assert/strict";
import {readCentralStock} from "../../supabase/functions/woocommerce-stock-read/central-stock.mjs";
function snapshot() {
  return {enabled:true,source:"central_inventory",fetched_at:"2026-11-27T00:00:00Z",
    items:["PL-L","PL-M","PL-D","BL-L","BL-M","BL-D","FR","HZ"].flatMap(blend=>[50,100,200].map(weight=>({
      code:"EL-"+blend+"-"+String(weight).padStart(3,"0"),name:blend,weight,stock:8,reserved:3,available:5})))};
}
test("returns all 24 distinct central balances and their available quantities",()=>{
  const response=readCentralStock(snapshot());assert.equal(response.count,24);assert.equal(new Set(response.products.map(p=>p.sku)).size,24);
  assert.equal(response.products[0].stock_quantity,8);assert.equal(response.products[0].available,5);
});
test("rejects language duplicates, partial snapshots, invalid balances and other sources",()=>{
  for(const change of [s=>s.items.pop(),s=>s.items[1]=s.items[0],s=>s.items[1].available=-1,
    s=>s.items[0].stock=12,s=>s.items[0].weight=100,s=>s.source="WooCommerce",s=>s.enabled=false]){
    const data=snapshot();change(data);assert.throws(()=>readCentralStock(data));
  }
});
