(async()=>{
 const state=document.getElementById("state");
 try {
  const node=document.getElementById("assets"), assets=JSON.parse(node.textContent);
  node.remove();
  async function bytes(encoded){
   const binary=atob(encoded),buffer=new Uint8Array(binary.length);
   for(let i=0;i<binary.length;i++)buffer[i]=binary.charCodeAt(i);
   const decoded=new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
   return new Response(decoded).arrayBuffer();
  }
  const db=await window.PreviewPostgres.create({wasmModule:await WebAssembly.compile(await bytes(assets.wasm)),fsBundle:new Blob([await bytes(assets.fs)])});
  for(const sql of assets.sql)await db.exec(sql);
  const actor=document.getElementById("actor"),host=document.getElementById("erp-workspace");
  const client={rpc:async(name,p={})=>{
    try{
      const result=name==="elhelw_erp_workspace"?await db.query("select public.elhelw_erp_workspace() data"):
        await db.query("select public.elhelw_erp_command($1,$2::jsonb,$3::uuid) data",[p.p_action,JSON.stringify(p.p_payload),p.p_request]);
      return {data:result.rows[0].data};
    }catch(error){return {error};}
  }};
  async function switchActor(){
   actor.disabled=true;
   const id="00000000-0000-4000-8000-00000000000"+actor.value;
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
   const surface=document.createElement("section");host.replaceChildren(surface);
   await window.renderElhelwERP(surface,client,id);
   actor.disabled=false;
  }
  await db.exec("set role authenticated");
  actor.onchange=switchActor;await switchActor();state.textContent="";
 }catch(e){state.textContent="تعذّر فتح التجربة. "+e.message;console.error(e);}
})();
