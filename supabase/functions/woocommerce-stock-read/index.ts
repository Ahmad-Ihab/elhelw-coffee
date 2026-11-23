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

function sizeLabel(product: any): string {
  const attrs = Array.isArray(product.attributes)
    ? product.attributes.map((a: any) => [a.name, a.option].filter(Boolean).join(": ")).join(" · ")
    : "";
  const text = [product.name, product.sku, attrs].filter(Boolean).join(" ");
  const normalized = text.replace(/[٠-٩]/g, (d: string) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  const match = normalized.match(/(?:^|\D)(50|100|200)\s*(?:g|gm|gr|gram|grams|جم|جرام)(?:\b|$)/i);
  return match ? match[1] + " جم" : (attrs || "-");
}

async function wooGet(base: string, path: string, auth: string) {
  const response = await fetch(base + "/wp-json/wc/v3/" + path, {
    method: "GET",
    headers: { Authorization: auth, Accept: "application/json" },
    signal: AbortSignal.timeout(25000),
  });
  const text = await response.text();
  if (!response.ok) {
    let detail = "";
    try { detail = JSON.parse(text)?.message || ""; } catch { /* ignore */ }
    throw new Error("WooCommerce API returned " + response.status + (detail ? ": " + detail : ""));
  }
  try { return JSON.parse(text); }
  catch { throw new Error("WooCommerce returned an invalid JSON response."); }
}

async function fetchAllProducts(base: string, auth: string) {
  const all: any[] = [];
  for (let page = 1; page <= 50; page++) {
    const batch = await wooGet(base, "products?status=publish&per_page=100&page=" + page + "&orderby=id&order=asc", auth);
    if (!Array.isArray(batch)) throw new Error("Unexpected WooCommerce products response.");
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
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

    const storeUrl = (Deno.env.get("WOOCOMMERCE_STORE_URL") || "").trim().replace(/\/+$/, "");
    const consumerKey = Deno.env.get("WOOCOMMERCE_CONSUMER_KEY") || "";
    const consumerSecret = Deno.env.get("WOOCOMMERCE_CONSUMER_SECRET") || "";
    if (!storeUrl || !consumerKey || !consumerSecret) {
      return json({ error: "WooCommerce credentials are not configured in Supabase Edge Function secrets." }, 503);
    }
    const parsed = new URL(storeUrl);
    if (parsed.protocol !== "https:") return json({ error: "The WooCommerce store URL must use HTTPS." }, 400);

    const auth = "Basic " + btoa(consumerKey + ":" + consumerSecret);
    const parents = await fetchAllProducts(storeUrl, auth);
    const products: any[] = [];

    for (const parent of parents) {
      if (parent.type === "variable") {
        if (parent.manage_stock && parent.stock_quantity !== null && parent.stock_quantity !== undefined) {
          products.push({
            id: parent.id, parent_id: null, name: parent.name, sku: parent.sku || "",
            size: sizeLabel(parent), type: "variable-parent",
            stock_quantity: Number(parent.stock_quantity), stock_status: parent.stock_status || "unknown",
          });
          continue;
        }
        for (let page = 1; page <= 20; page++) {
          const variations = await wooGet(storeUrl, "products/" + parent.id + "/variations?per_page=100&page=" + page, auth);
          if (!Array.isArray(variations)) throw new Error("Unexpected WooCommerce variations response.");
          for (const v of variations) {
            const managed = v.manage_stock === true || (v.stock_quantity !== null && v.stock_quantity !== undefined);
            if (!managed) continue;
            const attrs = Array.isArray(v.attributes) ? v.attributes : [];
            const attrText = attrs.map((a: any) => a.option || a.name).filter(Boolean).join(" / ");
            products.push({
              id: v.id, parent_id: parent.id,
              name: [parent.name, attrText].filter(Boolean).join(" — "),
              sku: v.sku || parent.sku || "", size: sizeLabel({ ...v, name: attrText || parent.name }),
              type: "variation", stock_quantity: Number(v.stock_quantity ?? 0),
              stock_status: v.stock_status || "unknown",
            });
          }
          if (variations.length < 100) break;
        }
      } else if (parent.manage_stock === true || (parent.stock_quantity !== null && parent.stock_quantity !== undefined)) {
        products.push({
          id: parent.id, parent_id: null, name: parent.name, sku: parent.sku || "",
          size: sizeLabel(parent), type: parent.type || "simple",
          stock_quantity: Number(parent.stock_quantity ?? 0), stock_status: parent.stock_status || "unknown",
        });
      }
    }

    products.sort((a, b) => String(a.name).localeCompare(String(b.name), "ar"));
    return json({ source: "WooCommerce", fetched_at: new Date().toISOString(), count: products.length, products });
  } catch (error) {
    console.error("woocommerce-stock-read:", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected server error." }, 500);
  }
});
