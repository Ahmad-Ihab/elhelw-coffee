const varieties = ["PL-L","PL-M","PL-D","BL-L","BL-M","BL-D","FR","HZ"];
const weights = [50,100,200];
export function readCentralStock(data) {
  const expected = new Map(varieties.flatMap(variety => weights.map(weight => [
    "EL-"+variety+"-"+String(weight).padStart(3,"0"),weight
  ])));
  if (data?.enabled !== true || data.source !== "central_inventory" ||
      !Array.isArray(data.items) || data.items.length !== expected.size ||
      typeof data.fetched_at !== "string" || !Number.isFinite(Date.parse(data.fetched_at))) {
    throw Error("Incomplete central inventory snapshot");
  }
  const products = data.items.map(item => {
    const weight = expected.get(item?.code);
    if (!weight || Number(item.weight) !== weight || typeof item.name !== "string" || !item.name.trim() ||
        ![item.stock,item.reserved,item.available].every(q => Number.isSafeInteger(q) && q>=0) ||
        item.stock !== item.available+item.reserved) throw Error("Invalid central inventory item");
    expected.delete(item.code);
    return {id:item.code,sku:item.code,name:item.name,size:weight+" جم",stock_quantity:item.stock,
      reserved:item.reserved,available:item.available,stock_status:"المتاح: "+item.available,type:"المحجوز: "+item.reserved};
  });
  return {source:"central_inventory",fetched_at:data.fetched_at,count:products.length,products};
}
