import { createClient } from "npm:@supabase/supabase-js@2.49.8";

const cors = {"Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods":"POST, OPTIONS"};
const response = (body: unknown, status=200) => new Response(JSON.stringify(body), {status, headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
Deno.serve(async req=>{
  if(req.method==="OPTIONS") return new Response(null,{headers:cors});
  if(req.method!=="POST") return response({error:"Method not allowed"},405);
  const auth=req.headers.get("Authorization")||"";
  if(!/^Bearer \S+$/i.test(auth)) return response({error:"سجّل الدخول أولًا"},401);
  const url=Deno.env.get("SUPABASE_URL")!, key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const service=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:authError}=await service.auth.getUser(auth.slice(7));
  if(authError||!user) return response({error:"جلسة الدخول انتهت"},401);
  let b;
  try { b=await req.json(); } catch { return response({error:"طلب غير صالح"},400); }
  if(!b||typeof b!=="object") return response({error:"طلب غير صالح"},400);
  if(user.role==="elhelw_staff" && user.app_metadata?.elhelw_staff===true){
    if(b.op!=="workspace"&&b.op!=="command"&&b.op!=="status") return response({error:"العملية غير متاحة لهذا الحساب"},403);
    const {data,error}=await service.rpc("elhelw_staff_run",{p_actor:user.id,p_op:b.op,p:b.args||{}});
    if(error) return response({error:error.message},error.code==="42501"?403:400);
    return response({data});
  }
  if(b.op!=="create"||user.role!=="authenticated") return response({error:"العملية غير متاحة لهذا الحساب"},403);
  const caller=createClient(url,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}});
  const info={request:b.request,name:b.name,email:String(b.email||"").trim().toLowerCase(),permissions:b.permissions};
  if(typeof b.password!=="string"||b.password.length<10||b.password.length>128) return response({error:"استخدم كلمة مرور من ١٠ إلى ١٢٨ حرف"},400);
  const prepare=()=>caller.rpc("elhelw_staff_manage",{p_op:"prepare",p:info});
  const {data:ready,error}=await prepare();
  if(error) return response({error:error.message},error.code==="42501"?403:400);
  if(ready?.created) return response({data:{created:true}});
  const result=await service.auth.admin.createUser({email:info.email,password:b.password,email_confirm:true,role:"elhelw_staff",
    app_metadata:{elhelw_staff:true,staff_request:info.request}});
  // The Auth transaction registers the employee and initial permissions as one commit.
  // After duplicate or ambiguous responses only the same completed request counts as success.
  const confirmation=await prepare();
  if(confirmation.data?.created) return response({data:{created:true}});
  if(result.error) return response({error:result.error.code==="email_exists"||result.error.code==="email_address_not_authorized"||result.error.message.includes("registered")?"البريد مستخدم بالفعل أو غير متاح. اختَر بريدًا مخصصًا للموظف.":"تعذّر إنشاء حساب الموظف. راجع بيانات الحساب ثم حاول مجددًا."},400);
  return response({error:"تعذر تأكيد إنشاء الحساب. أعد المحاولة."},503);
});
