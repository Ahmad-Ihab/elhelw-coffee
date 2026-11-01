import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "Server configuration is incomplete" }, 500);
  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const adminClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: authError } = await adminClient.auth.getUser(authorization.slice(7));
  if (authError || !user) return json({ error: "Unauthorized" }, 401);
  const { data: caller } = await adminClient.from("profiles").select("role").eq("id", user.id).single();
  if (caller?.role !== "admin") return json({ error: "Admin access required" }, 403);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const full_name = String(body.full_name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const role = String(body.role || "");
  const phone = String(body.phone || "").trim();
  if (!full_name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 ||
      !["admin", "distributor"].includes(role)) return json({ error: "راجع بيانات الحساب" }, 400);
  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (createError || !created.user) return json({ error: createError?.message || "Could not create user" }, 400);
  const userId = created.user.id;
  const { error: profileError } = await adminClient.from("profiles").insert({ id: userId, full_name, role });
  if (profileError) {
    await adminClient.auth.admin.deleteUser(userId);
    return json({ error: profileError.message }, 400);
  }
  if (role === "distributor") {
    const { error } = await adminClient.from("distributors").insert({
      user_id: userId, name: full_name, phone: phone || null, active: true,
    });
    if (error) {
      await adminClient.from("profiles").delete().eq("id", userId);
      await adminClient.auth.admin.deleteUser(userId);
      return json({ error: error.message }, 400);
    }
  }
  return json({ success: true, user_id: userId });
});