import {createClient} from "npm:@supabase/supabase-js@2.49.4";
import {JWT} from "npm:google-auth-library@9.15.1";
Deno.serve(async req=>{
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info"};
if(req.method==="OPTIONS")return new Response(null,{headers:cors});
try{
const url=Deno.env.get("SUPABASE_URL")!, key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db=createClient(url,key);const token=req.headers.get("Authorization")?.replace(/^Bearer /i,"");
if(!token)return new Response("Unauthorized",{status:401,headers:cors});
if(token!==key){const {data,error}=await db.auth.getUser(token);if(error||!data.user)return new Response("Unauthorized",{status:401,headers:cors});if(data.user.role!=="authenticated"||data.user.app_metadata?.elhelw_staff===true)return new Response("Forbidden",{status:403,headers:cors});}
const account=JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT")!);
const jwt=new JWT({email:account.client_email,key:account.private_key,scopes:["https://www.googleapis.com/auth/firebase.messaging"]});
const access=await jwt.getAccessToken();
const {data:jobs,error}=await db.from("push_outbox").select("*").is("sent_at",null).order("id").limit(50);if(error)throw error;
let sent=0;
for(const job of jobs||[]){
const {data:devices,error:de}=await db.from("push_devices").select("token").eq("user_id",job.recipient);if(de)continue;
let ok=true;
for(const d of devices||[]){
const res=await fetch("https://fcm.googleapis.com/v1/projects/"+account.project_id+"/messages:send",{method:"POST",headers:{Authorization:"Bearer "+access.token,"Content-Type":"application/json"},body:JSON.stringify({message:{token:d.token,notification:{title:"Elhelw Distribution",body:job.kind==="chat"?"لديك رسالة جديدة":"لديك إشعار جديد"},android:{priority:"high"},data:{screen:job.kind==="chat"?"chat":"notifications"}}})});
if(!res.ok){const e=await res.json();if(e.error?.details?.some((x:any)=>x.errorCode==="UNREGISTERED"))await db.from("push_devices").delete().eq("token",d.token);else ok=false;}
}
if(ok){await db.from("push_outbox").update({sent_at:new Date().toISOString()}).eq("id",job.id);sent++;}
}
return new Response(JSON.stringify({sent}),{headers:{...cors,"Content-Type":"application/json"}});
}catch(e){console.error("Push dispatch failed",e instanceof Error?e.message:"unknown");return new Response("Dispatch failed",{status:500,headers:cors});}
});