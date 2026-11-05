(() => {
  const recipes = {
    plain:{name:"سادة",items:{"بن إندونيسي":.750,"بن هندي":.125,"بن برازيلي":.125}},
    hawaji:{name:"محوجة",items:{"بن إندونيسي":.700,"بن هندي":.116,"بن برازيلي":.116,"حبهان":.045,"قرنفل":.0045,"زهر ورد":.0185}},
    french:{name:"فرنسية",items:{"بن إندونيسي":.255,"بن هندي":.0425,"بن برازيلي":.0425,"لبن بودرة":.660}},
    hazelnut:{name:"بندق",items:{"بن إندونيسي":.255,"بن هندي":.0425,"بن برازيلي":.0425,"لبن بودرة":.600,"بندق حصاة":.045,"نكهة بندق":.015}}
  };
  const roastLossItems=new Set(["بن إندونيسي","بن هندي","بن برازيلي","حبهان"]);
  const keyFor=id=>"elhelw-production-history-"+id;
  const fmt=n=>Number(n||0).toLocaleString("en-US",{maximumFractionDigits:3});
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const dateLabel=v=>new Date(v).toLocaleString("ar-EG",{dateStyle:"medium",timeStyle:"short"});
  function history(id){try{const d=JSON.parse(localStorage.getItem(keyFor(id))||"[]");return Array.isArray(d)?d:[]}catch(_){return[]}}
  function store(id,data){localStorage.setItem(keyFor(id),JSON.stringify(data.slice(0,100)))}
  function calculate(v){
    const waste=Math.min(99.9,Math.max(0,Number(v.waste)||0));
    const orders=Object.fromEntries(Object.keys(recipes).map(k=>[k,Math.max(0,Number(v[k])||0)]).filter(([,n])=>n>0));
    const totals={},details=[];
    for(const [key,amount] of Object.entries(orders)){
      const recipe=recipes[key],lines=[];
      for(const [item,ratio] of Object.entries(recipe.items)){
        const output=amount*ratio,raw=roastLossItems.has(item)?output/(1-waste/100):output;
        totals[item]=(totals[item]||0)+raw;lines.push({item,ratio,output,raw});
      }
      details.push({name:recipe.name,amount,lines});
    }
    return {values:{...v,waste},orders,totals,details,totalOrder:Object.values(orders).reduce((a,b)=>a+b,0),createdAt:new Date().toISOString()};
  }
  function render(userId){
    const root=document.getElementById("production-calculator");if(!root)return;
    root.innerHTML='<div class="pc-heading"><div class="eyebrow">ELHELW COFFEE · PRODUCTION</div><h2>حاسبة خامات الإنتاج</h2><p class="muted">أدخل وزن كل صنف بالكيلو لحساب خامات الطلبية.</p></div>'+
      '<section class="pc-card"><div class="pc-section-title"><h3>بيانات الطلبية</h3><span>1</span></div><label class="pc-label">اسم الطلبية / ملاحظة (اختياري)<input id="pc-name" type="text" maxlength="80" placeholder="مثال: طلبية كافيه ..."></label><div class="pc-products">'+
      '<label class="pc-product">سادة<input id="pc-plain" type="number" min="0" step="0.001" inputmode="decimal" placeholder="0"><small>كجم</small></label><label class="pc-product">محوجة<input id="pc-hawaji" type="number" min="0" step="0.001" inputmode="decimal" placeholder="0"><small>كجم</small></label><label class="pc-product">فرنسية<input id="pc-french" type="number" min="0" step="0.001" inputmode="decimal" placeholder="0"><small>كجم</small></label><label class="pc-product">بندق<input id="pc-hazelnut" type="number" min="0" step="0.001" inputmode="decimal" placeholder="0"><small>كجم</small></label></div><label class="pc-waste">هالك التحميص للبن والحبهان (%)<input id="pc-waste" type="number" min="0" max="99.9" step="0.1" value="20"></label><button id="pc-calculate" class="primary">احسب الخامات المطلوبة</button></section>'+
      '<section class="pc-card"><div class="pc-section-title"><h3>الخامات المطلوبة</h3><span>2</span></div><div id="pc-summary" class="pc-empty">أدخل كميات الطلبية ثم اضغط «احسب الخامات المطلوبة».</div></section>'+
      '<section class="pc-card"><div class="pc-section-title"><h3>تفاصيل الحساب</h3><span>3</span></div><div id="pc-details" class="pc-empty">ستظهر تفاصيل كل منتج هنا.</div></section>'+
      '<section class="pc-card pc-history"><div class="pc-section-title"><h3>سجل الحسابات المحفوظة</h3><span id="pc-history-count">0</span></div><p class="pc-hint">يُحفظ كل حساب مع تاريخه على هذا الجهاز والمتصفح، ويمكن استرجاعه أو طباعته لاحقًا.</p><div id="pc-history-list"></div></section>';
    const $=id=>document.getElementById(id);
    const readValues=()=>({name:$("pc-name").value.trim(),plain:$("pc-plain").value,hawaji:$("pc-hawaji").value,french:$("pc-french").value,hazelnut:$("pc-hazelnut").value,waste:$("pc-waste").value});
    function showResult(r){
      if(!r.totalOrder){$("pc-summary").innerHTML='<div class="pc-empty">أدخل كمية واحدة على الأقل.</div>';$("pc-details").innerHTML='<div class="pc-empty">لا توجد تفاصيل لعرضها.</div>';return}
      const rows=Object.entries(r.totals).map(([item,n])=>'<tr><td><b>'+esc(item)+'</b></td><td class="pc-num"><b>'+fmt(n)+' كجم</b><small>'+fmt(n*1000)+' جم</small></td></tr>').join("");
      $("pc-summary").innerHTML='<div class="pc-total"><span>إجمالي وزن الطلبية</span><strong>'+fmt(r.totalOrder)+' كجم</strong></div><div class="pc-table-wrap"><table><thead><tr><th>الخامة</th><th>الكمية المطلوبة</th></tr></thead><tbody>'+rows+'</tbody></table></div><p class="pc-hint">الهالك '+fmt(r.values.waste)+'% مطبق على البن الإندونيسي والهندي والبرازيلي والحبهان فقط.</p><div class="pc-actions"><button id="pc-save" class="primary">حفظ الحساب بالتاريخ</button><button id="pc-print" class="secondary">طباعة / PDF</button></div>';
      $("pc-details").innerHTML=r.details.map(d=>'<details class="pc-detail"><summary>'+esc(d.name)+' — '+fmt(d.amount)+' كجم</summary><div class="pc-table-wrap"><table><thead><tr><th>الخامة</th><th>الوصفة / كجم</th><th>خام البداية</th></tr></thead><tbody>'+d.lines.map(x=>'<tr><td>'+esc(x.item)+'</td><td>'+fmt(x.ratio)+' كجم</td><td>'+fmt(x.raw)+' كجم</td></tr>').join("")+'</tbody></table></div></details>').join("");
      $("pc-save").onclick=()=>{const record={...r,id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),label:r.values.name||("طلبية "+dateLabel(r.createdAt))};store(userId,[record,...history(userId)]);renderHistory();$("pc-save").textContent="تم حفظ الحساب ✓";$("pc-save").disabled=true};
      $("pc-print").onclick=()=>window.print();
    }
    function loadRecord(r){["plain","hawaji","french","hazelnut","waste"].forEach(k=>{$("pc-"+k).value=r.values[k]??(k==="waste"?20:"")});$("pc-name").value=r.values.name||r.label||"";showResult(r);root.scrollIntoView({behavior:"smooth",block:"start"})}
    function renderHistory(){
      const saved=history(userId);$("pc-history-count").textContent=String(saved.length);
      $("pc-history-list").innerHTML=saved.length?saved.map(r=>'<article class="pc-history-item"><div><b>'+esc(r.label||"طلبية محفوظة")+'</b><small>'+dateLabel(r.createdAt)+' · '+fmt(r.totalOrder)+' كجم</small></div><div class="pc-history-actions"><button class="secondary" data-pc-load="'+esc(r.id)+'">فتح</button><button class="secondary" data-pc-print="'+esc(r.id)+'">طباعة</button><button class="danger" data-pc-delete="'+esc(r.id)+'">حذف</button></div></article>').join(""):'<div class="pc-empty">لا توجد حسابات محفوظة حتى الآن.</div>';
      $("pc-history-list").querySelectorAll("[data-pc-load]").forEach(b=>b.onclick=()=>{const r=history(userId).find(x=>x.id===b.dataset.pcLoad);if(r)loadRecord(r)});
      $("pc-history-list").querySelectorAll("[data-pc-print]").forEach(b=>b.onclick=()=>{const r=history(userId).find(x=>x.id===b.dataset.pcPrint);if(r){loadRecord(r);setTimeout(()=>window.print(),100)}});
      $("pc-history-list").querySelectorAll("[data-pc-delete]").forEach(b=>b.onclick=()=>{if(!confirm("هل تريد حذف هذا الحساب المحفوظ؟"))return;store(userId,history(userId).filter(x=>x.id!==b.dataset.pcDelete));renderHistory()});
    }
    $("pc-calculate").onclick=()=>showResult(calculate(readValues()));
    renderHistory();
  }
  window.renderElhelwProductionCalculator=render;
})();