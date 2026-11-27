import { createClient } from "npm:@supabase/supabase-js@2.49.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token || token === authHeader) return json({ error: "Authentication required." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
    if (!supabaseUrl || !supabaseKey) throw new Error("Supabase auth environment is not configured.");

    const userClient = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "Invalid or expired session." }, 401);

    const { data: profile, error: profileError } = await userClient
      .from("profiles").select("role").eq("id", userData.user.id).single();
    if (profileError || profile?.role !== "admin") return json({ error: "Admin access required." }, 403);

    const key = Deno.env.get("ELHELW_INVENTORY_KEY") || "";
    if (!/^[a-f0-9]{64}$/.test(key)) return json({error:"Central inventory key is missing or invalid."},503);
    const response = await fetch("https://elhelwcoffee.com/wp-json/elhelw/v1/app-inventory",{headers:{"X-Elhelw-Inventory-Key":key,Accept:"application/json"},redirect:"error",signal:AbortSignal.timeout(25000)});
    if(!response.ok) return json({error:"Central inventory API returned "+response.status},502);
    const data=await response.json();
    const expected=new Set(["PL-L","PL-M","PL-D","BL-L","BL-M","BL-D","FR","HZ"].flatMap(t=>["050","100","200"].map(w=>"EL-"+t+"-"+w)));
    if(data.enabled!==true||data.source!=="central_inventory"||!Array.isArray(data.items)||data.items.length!==24)throw Error("Invalid central inventory response");
    const products=data.items.map((i:any)=>{
      if(!expected.delete(i.code)||typeof i.name!=="string"||Number(i.weight)!==Number(i.code.slice(-3))||![i.stock,i.reserved,i.available].every(Number.isSafeInteger)||i.stock<0||i.reserved<0||i.available<0||i.available!==i.stock-i.reserved)throw Error("Invalid central inventory item");
      return {id:i.code,name:i.name,sku:i.code,size:i.weight+" جم",stock_quantity:i.stock,reserved:i.reserved,available:i.available,stock_status:"المتاح: "+i.available,type:"المحجوز: "+i.reserved};
    });
    return json({source:"central_inventory",fetched_at:data.fetched_at,count:products.length,products});
  } catch (error) {
    console.error("woocommerce-stock-read:", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected server error." }, 500);
  }
});
