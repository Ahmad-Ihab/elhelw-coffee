// Build an offline, synthetic acceptance copy. The production app does not load these files.
const fs=require("node:fs");
const path=require("node:path");
const {gzipSync}=require("node:zlib");
const {build}=require("esbuild");
const root=path.resolve(__dirname,"../..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const dataDir=path.dirname(require.resolve("@electric-sql/pglite"));
const archive=name=>gzipSync(fs.readFileSync(path.join(dataDir,name))).toString("base64");
const fixture=`create role anon; create role authenticated; create role service_role; create schema auth;create table auth.users(id uuid primary key,email text,role text,raw_app_meta_data jsonb);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.suppliers(id uuid primary key);create table public.cafes(id uuid primary key);create table public.distributors(id uuid primary key);`;
async function main(){
 const out=process.argv[2];if(!out)throw Error("Pass the output HTML path");
 const bundle=await build({stdin:{contents:'import { PGlite } from "@electric-sql/pglite"; window.PreviewPostgres=PGlite;',resolveDir:dataDir},bundle:true,write:false,format:"iife",platform:"browser",minify:true,external:["node:*","fs","path","url"],define:{"import.meta.url":JSON.stringify("file:///erp-preview/")}});
 const schemas=fs.readdirSync(path.join(root,"erp/sql")).filter(n=>n.endsWith(".draft.sql")).sort().map(n=>read("erp/sql/"+n));
 const licenses=fs.readFileSync(path.join(dataDir,"../LICENSE"),"utf8");
 const assets={license:licenses,wasm:archive("pglite.wasm"),fs:archive("pglite.data"),sql:[fixture,...schemas,read("erp/preview/seed.sql")]};
 const script=s=>s.replace(/<\/script/gi,"<\\/script");
 const logo=fs.readFileSync(path.join(root,"assets/brand-logo.svg")).toString("base64");
 const html=`<!doctype html><html lang="ar" dir="rtl"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>بن الحلو · تجربة نظام الشركة</title>
 <style>${read("styles.css").replace(/@import\s+url\([^)]*\);/g,"")}${read("interface.css").replace(/@font-face\s*\{[^}]*\}/g,"")}body{padding-bottom:2rem}main{max-width:1080px;margin:auto;padding:1rem}.preview-head{display:flex;align-items:center;gap:1rem;flex-wrap:wrap}.preview-head img{height:3rem}.preview-head label{margin-inline-start:auto}#state{padding:.6rem 0}</style>
 <main><header class="preview-head"><img alt="بن الحلو" src="data:image/svg+xml;base64,${logo}"><h1>تجربة نظام الشركة</h1><label>حساب التجربة <select id="actor" disabled><option value="1">مسؤول التشغيل</option><option value="2">مراجع الاعتمادات</option></select></label></header>
 <p>بيانات تدريبية على جهازك. إعادة فتح الصفحة تبدأ تجربة جديدة.</p><div id="state" role="status">جارٍ تجهيز قاعدة بيانات التجربة…</div><section id="erp-workspace"></section></main>
 <script>${script(bundle.outputFiles[0].text)}</script><script>${script(read("illustrations.js"))}</script><script>${script(read("erp-workspace.js"))}</script>
 <script type="application/json" id="assets">${script(JSON.stringify(assets))}</script><script>${script(read("erp/preview/start.js"))}</script></html>`;
 fs.writeFileSync(out,html);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
