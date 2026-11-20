/* Elhelw Distribution - supplier procurement and raw material stock UI */
(() => {
  const esc = s => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const num = n => Number(n||0).toLocaleString("en-US",{maximumFractionDigits:3});
  const money = n => new Intl.NumberFormat("ar-EG",{style:"currency",currency:"EGP",maximumFractionDigits:2}).format(Number(n||0));
  let sb, root, suppliers=[], materials=[], prices=[], orders=[], balances=[];
  let view="suppliers";
  const q = id => root.querySelector("#"+id);
  const notify = msg => { if(window.elhelwToast) window.elhelwToast(msg); else alert(msg); };
  const rows = async (table, select="*") => { const {data,error}=await sb.from(table).select(select); if(error) throw error; return data||[]; };
  const save = async (table,payload) => { const {error}=await sb.from(table).insert(payload); if(error) throw error; };
  const tabs = () => '<div class="tabs" style="margin:12px 0;flex-wrap:wrap">'+[
    ["suppliers","الموردون"],["materials","الخامات والأسعار"],["orders","طلبيات الموردين"],["stock","مخزون الخامات"]
  ].map(([id,label])=>'<button class="tab '+(view===id?'active':'')+'" data-view="'+id+'">'+label+'</button>').join("")+'</div>';
  const panel = (title,body,action="") => '<section class="panel-card">'+
    '<div class="section-head"><h2>'+title+'</h2>'+action+'</div>'+body+'</section>';
  const btn = (id,label) => '<button class="primary" type="button" id="'+id+'">'+label+'</button>';
  const input = (label,name,type="text",extra="") => '<label class="field">'+label+'<input name="'+name+'" type="'+type+'" '+extra+'></label>';
  const select = (label,name,opts) => '<label class="field">'+label+'<select name="'+name+'" required><option value="">اختر</option>'+opts.map(x=>'<option value="'+esc(x.value)+'">'+esc(x.label)+'</option>').join("")+'</select></label>';
  function set(html){root.innerHTML=tabs()+html;root.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{view=b.dataset.view;render().catch(showError)});}
  function showError(e){console.error(e);root.insertAdjacentHTML("afterbegin",'<div class="panel-card error">'+esc(e.message||"حدث خطأ")+'</div>');}
  async function load(){
    [suppliers,materials,prices,orders,balances]=await Promise.all([
      rows("suppliers","id,name,contact_name,phone,notes,active,created_at"),
      rows("raw_materials","id,name,unit,active,notes"),
      rows("supplier_material_prices","id,supplier_id,raw_material_id,unit_price,updated_at"),
      rows("supplier_purchase_orders","id,order_number,supplier_id,status,order_date,expected_date,supplier_invoice_number,notes,created_at"),
      rows("raw_material_stock_balances","raw_material_id,quantity_kg")
    ]);
    const ids=orders.map(x=>x.id);
    let items=[];
    if(ids.length){const {data,error}=await sb.from("supplier_purchase_order_items").select("id,purchase_order_id,raw_material_id,ordered_quantity_kg,received_quantity_kg,unit_price").in("purchase_order_id",ids);if(error)throw error;items=data||[];}
    orders=orders.map(o=>({...o,items:items.filter(i=>i.purchase_order_id===o.id)})).sort((a,b)=>b.order_number-a.order_number);
  }
  function supplierPage(){
    const body=suppliers.map(s=>'<tr><td><b>'+esc(s.name)+'</b><div class="hint">'+esc(s.contact_name||"")+'</div></td><td>'+esc(s.phone||"-")+'</td><td>'+(s.active?"نشط":"موقوف")+'</td><td><button class="secondary" data-supplier="'+s.id+'">تعديل</button></td></tr>').join("");
    set(panel("الموردون",'<p class="muted">إدارة الموردين الذين يتم شراء خامات التصنيع منهم.</p>'+ '<div class="table-wrap"><table><thead><tr><th>المورد</th><th>الهاتف</th><th>الحالة</th><th></th></tr></thead><tbody>'+(body||'<tr><td colspan="4" class="empty">لم تتم إضافة موردين بعد</td></tr>')+'</tbody></table></div>',btn("add-supplier","إضافة مورد")));
    q("add-supplier").onclick=()=>supplierForm();
    root.querySelectorAll("[data-supplier]").forEach(b=>b.onclick=()=>supplierForm(suppliers.find(x=>x.id===b.dataset.supplier)));
  }
  function supplierForm(s){
    const html='<form id="supplier-form" class="form-panel"><h3>'+(s?"تعديل المورد":"إضافة مورد جديد")+'</h3><div class="form-grid">'+
      input("اسم المورد","name","text",'required maxlength="150"')+input("اسم مسؤول التواصل","contact_name")+input("رقم الهاتف","phone","tel")+
      '<label class="field">ملاحظات<textarea name="notes" rows="2"></textarea></label>'+
      (s?'<label class="field">الحالة<select name="active"><option value="true">نشط</option><option value="false">موقوف</option></select></label>':"")+
      '</div><div class="form-actions"><button class="primary">حفظ</button><button type="button" class="secondary" data-close>إلغاء</button></div></form>';
    root.insertAdjacentHTML("afterbegin",html);
    const f=q("supplier-form");if(s){for(const k of ["name","contact_name","phone","notes"])f.elements[k].value=s[k]||"";f.elements.active.value=String(s.active);}
    f.querySelector("[data-close]").onclick=()=>f.remove();
    f.onsubmit=async e=>{e.preventDefault();const d=new FormData(f),v={name:String(d.get("name")).trim(),contact_name:d.get("contact_name")||null,phone:d.get("phone")||null,notes:d.get("notes")||null};if(s)v.active=d.get("active")==="true";try{let res=s?await sb.from("suppliers").update(v).eq("id",s.id):await sb.from("suppliers").insert(v);if(res.error)throw res.error;notify("تم حفظ بيانات المورد");await render();}catch(x){showError(x)}};
  }
  function materialPage(){
    const body=materials.map(m=>{
      const ps=prices.filter(p=>p.raw_material_id===m.id).map(p=>{const s=suppliers.find(x=>x.id===p.supplier_id);return s?'<div>'+esc(s.name)+': <b>'+money(p.unit_price)+'</b> / كجم</div>':""}).join("");
      const stock=balances.find(b=>b.raw_material_id===m.id)?.quantity_kg||0;
      return '<tr><td><b>'+esc(m.name)+'</b><div class="hint">'+(m.active?"نشطة":"موقوفة")+'</div></td><td>'+num(stock)+' كجم</td><td>'+(ps||'<span class="muted">لا توجد أسعار</span>')+'</td><td><button class="secondary" data-price="'+m.id+'">إضافة / تحديث سعر</button></td></tr>';
    }).join("");
    set(panel("الخامات وأسعار الموردين",'<p class="muted">أضف أسماء الخامات مرة واحدة، ثم سجل سعر كل خامة عند كل مورد. الأسعار قابلة للتحديث، وسعر الطلبية يُحفظ وقت إنشائها.</p><div class="table-wrap"><table><thead><tr><th>الخامة</th><th>الرصيد</th><th>أسعار الموردين</th><th></th></tr></thead><tbody>'+(body||'<tr><td colspan="4" class="empty">لا توجد خامات مسجلة</td></tr>')+'</tbody></table></div>',btn("add-material","إضافة خامة")));
    q("add-material").onclick=()=>materialForm();
    root.querySelectorAll("[data-price]").forEach(b=>b.onclick=()=>priceForm(b.dataset.price));
  }
  function materialForm(){
    const html='<form id="material-form" class="form-panel"><h3>إضافة خامة</h3><div class="form-grid">'+input("اسم الخامة","name","text",'required maxlength="150"')+select("وحدة القياس","unit",[{value:"kg",label:"كيلوجرام"},{value:"g",label:"جرام"},{value:"liter",label:"لتر"},{value:"piece",label:"قطعة"}])+'</div><div class="form-actions"><button class="primary">حفظ</button><button type="button" class="secondary" data-close>إلغاء</button></div></form>';
    root.insertAdjacentHTML("afterbegin",html);const f=q("material-form");f.querySelector("[data-close]").onclick=()=>f.remove();
    f.onsubmit=async e=>{e.preventDefault();const d=new FormData(f);try{await save("raw_materials",{name:String(d.get("name")).trim(),unit:d.get("unit")});notify("تمت إضافة الخامة");await render()}catch(x){showError(x)}};
  }
  function priceForm(materialId){
    if(!suppliers.some(s=>s.active))return notify("أضف موردًا نشطًا أولاً");
    const existing=prices.filter(p=>p.raw_material_id===materialId);
    const html='<form id="price-form" class="form-panel"><h3>أسعار الموردين — '+esc(materials.find(m=>m.id===materialId)?.name)+'</h3><div class="form-grid">'+
      select("المورد","supplier_id",suppliers.filter(s=>s.active).map(s=>({value:s.id,label:s.name})))+
      input("سعر الكيلو بالجنيه","unit_price","number",'required min="0" step="0.001')+
      '</div><div class="form-actions"><button class="primary">حفظ السعر</button><button type="button" class="secondary" data-close>إلغاء</button></div></form>';
    root.insertAdjacentHTML("afterbegin",html);const f=q("price-form");f.querySelector("[data-close]").onclick=()=>f.remove();
    f.onsubmit=async e=>{e.preventDefault();const d=new FormData(f),supplierId=d.get("supplier_id"),price=Number(d.get("unit_price"));try{const old=existing.find(p=>p.supplier_id===supplierId);const res=old?await sb.from("supplier_material_prices").update({unit_price:price,updated_at:new Date().toISOString()}).eq("id",old.id):await sb.from("supplier_material_prices").insert({supplier_id:supplierId,raw_material_id:materialId,unit_price:price});if(res.error)throw res.error;notify("تم تحديث السعر");await render()}catch(x){showError(x)}};
  }
  function orderPage(){
    const body=orders.map(o=>{
      const supplier=suppliers.find(s=>s.id===o.supplier_id);
      const total=o.items.reduce((a,i)=>a+Number(i.ordered_quantity_kg)*Number(i.unit_price),0);
      const received=o.items.every(i=>Number(i.received_quantity_kg)>=Number(i.ordered_quantity_kg));
      return '<tr><td>#'+o.order_number+'</td><td>'+esc(supplier?.name||"-")+'</td><td>'+new Date(o.order_date).toLocaleDateString("ar-EG")+'</td><td>'+esc(({draft:"مسودة",ordered:"تم الطلب",partially_received:"استلام جزئي",received:"مستلمة",cancelled:"ملغاة"})[o.status]||o.status)+'</td><td>'+money(total)+'</td><td><div class="history-actions"><button class="secondary" data-view-order="'+o.id+'">عرض / فاتورة</button>'+(o.status!=="received"&&o.status!=="cancelled"?'<button class="primary" data-receive="'+o.id+'">تسجيل استلام</button>':"")+'</div></td></tr>';
    }).join("");
    set(panel("طلبيات الموردين",'<p class="muted">سجل أوامر الشراء، ثم سجل الكميات المستلمة فعليًا لإضافتها إلى مخزون الخامات.</p><div class="table-wrap"><table><thead><tr><th>رقم</th><th>المورد</th><th>التاريخ</th><th>الحالة</th><th>القيمة</th><th></th></tr></thead><tbody>'+(body||'<tr><td colspan="6" class="empty">لا توجد طلبيات حتى الآن</td></tr>')+'</tbody></table></div>',btn("new-purchase","إنشاء طلبية")));
    q("new-purchase").onclick=()=>purchaseForm();
    root.querySelectorAll("[data-view-order]").forEach(b=>b.onclick=()=>invoice(orders.find(o=>o.id===b.dataset.viewOrder)));
    root.querySelectorAll("[data-receive]").forEach(b=>b.onclick=()=>receiveForm(orders.find(o=>o.id===b.dataset.receive)));
  }
  function purchaseForm(){
    if(!suppliers.some(s=>s.active)||!materials.length)return notify("أضف موردًا وخامة واحدة على الأقل أولاً");
    const html='<form id="purchase-form" class="form-panel"><h3>طلبية خامات جديدة</h3><div class="form-grid">'+
      select("المورد","supplier_id",suppliers.filter(s=>s.active).map(s=>({value:s.id,label:s.name})))+
      input("تاريخ التوريد المتوقع","expected_date","date")+
      '<div id="purchase-lines" style="grid-column:1/-1"></div>'+
      '</div><div class="form-actions"><button type="button" class="secondary" id="add-purchase-line">إضافة خامة</button><button class="primary">حفظ الطلبية</button><button type="button" class="secondary" data-close>إلغاء</button></div></form>';
    root.insertAdjacentHTML("afterbegin",html);const f=q("purchase-form"),lines=q("purchase-lines");
    f.querySelector("[data-close]").onclick=()=>f.remove();
    const addLine=()=>{const wrap=document.createElement("div");wrap.className="form-grid";wrap.style.cssText="border:1px solid var(--line);padding:10px;border-radius:12px;margin:8px 0";wrap.innerHTML=select("الخامة","material_id",materials.filter(m=>m.active).map(m=>({value:m.id,label:m.name})))+input("الكمية المطلوبة بالكيلو","quantity","number",'required min="0.001" step="0.001"')+input("سعر الكيلو","price","number",'required min="0" step="0.001"')+'<button type="button" class="secondary remove-line">حذف البند</button>';lines.append(wrap);wrap.querySelector(".remove-line").onclick=()=>wrap.remove();};
    f.elements.supplier_id.onchange=()=>{const supplierId=f.elements.supplier_id.value;lines.innerHTML="";addLine();lines.querySelectorAll("select[name=material_id]").forEach(sel=>sel.onchange=()=>{const p=prices.find(x=>x.supplier_id===supplierId&&x.raw_material_id===sel.value);sel.closest(".form-grid").querySelector("input[name=price]").value=p?.unit_price??"";});};
    q("add-purchase-line").onclick=addLine;addLine();
    f.onsubmit=async e=>{e.preventDefault();const supplierId=f.elements.supplier_id.value;const itemForms=[...lines.querySelectorAll(".form-grid")];const entries=itemForms.map(w=>({raw_material_id:w.querySelector("[name=material_id]").value,ordered_quantity_kg:Number(w.querySelector("[name=quantity]").value),unit_price:Number(w.querySelector("[name=price]").value)}));if(!supplierId||!entries.length||entries.some(x=>!x.raw_material_id||!x.ordered_quantity_kg||x.unit_price<0))return notify("أكمل بيانات المورد وبنود الطلبية");try{const {data:order,error}=await sb.from("supplier_purchase_orders").insert({supplier_id:supplierId,status:"ordered",expected_date:f.elements.expected_date.value||null}).select().single();if(error)throw error;const res=await sb.from("supplier_purchase_order_items").insert(entries.map(x=>({...x,purchase_order_id:order.id})));if(res.error)throw res.error;notify("تم إنشاء طلبية المورد");await render()}catch(x){showError(x)}};
  }
  function receiveForm(order){
    const pending=order.items.filter(i=>Number(i.received_quantity_kg)<Number(i.ordered_quantity_kg));
    const html='<form id="receive-form" class="form-panel"><h3>تسجيل استلام الطلبية #'+order.order_number+'</h3><p class="hint">أدخل الكمية التي وصلت فعليًا لكل خامة. سيتم إضافتها للمخزون بعد الحفظ.</p><div class="form-grid">'+
      pending.map(i=>'<label class="field">'+esc(materials.find(m=>m.id===i.raw_material_id)?.name||"خامة")+' — متبقي '+num(i.ordered_quantity_kg-i.received_quantity_kg)+' كجم<input name="'+i.id+'" type="number" min="0" max="'+(i.ordered_quantity_kg-i.received_quantity_kg)+'" step="0.001" value="'+(i.ordered_quantity_kg-i.received_quantity_kg)+'"></label>').join("")+
      input("رقم فاتورة المورد","invoice_number")+'</div><div class="form-actions"><button class="primary">تأكيد الاستلام وإضافة للمخزون</button><button type="button" class="secondary" data-close>إلغاء</button></div></form>';
    root.insertAdjacentHTML("afterbegin",html);const f=q("receive-form");f.querySelector("[data-close]").onclick=()=>f.remove();
    f.onsubmit=async e=>{e.preventDefault();const data=new FormData(f),items=pending.map(i=>({item_id:i.id,quantity_kg:Number(data.get(i.id)||0)})).filter(x=>x.quantity_kg>0);if(!items.length)return notify("أدخل كمية مستلمة واحدة على الأقل");try{const {data:result,error}=await sb.rpc("admin_receive_supplier_purchase",{p_purchase_order_id:order.id,p_items:items,p_supplier_invoice_number:data.get("invoice_number")||null});if(error)throw error;notify("تم تسجيل الاستلام وإضافة "+num(result.received_kg)+" كجم للمخزون");await render()}catch(x){showError(x)}};
  }
  function invoice(order){
    if(!order)return;const supplier=suppliers.find(s=>s.id===order.supplier_id),total=order.items.reduce((a,i)=>a+i.ordered_quantity_kg*i.unit_price,0);
    const html='<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>فاتورة توريد خامات</title><style>body{font-family:Tahoma,Arial;padding:28px;color:#30251f}h1{color:#704326}table{width:100%;border-collapse:collapse;margin-top:22px}th,td{border:1px solid #ddd;padding:10px;text-align:right}th{background:#f5eee7}.total{font-size:20px;font-weight:bold;margin-top:20px}.meta{line-height:2}@media print{button{display:none}}</style><h1>بن الحلو — فاتورة توريد خامات</h1><div class="meta">رقم الطلبية: #'+order.order_number+'<br>المورد: '+esc(supplier?.name||"-")+'<br>التاريخ: '+new Date(order.order_date).toLocaleDateString("ar-EG")+'<br>رقم فاتورة المورد: '+esc(order.supplier_invoice_number||"-")+'</div><table><thead><tr><th>الخامة</th><th>المطلوب كجم</th><th>المستلم كجم</th><th>سعر الكيلو</th><th>الإجمالي</th></tr></thead><tbody>'+order.items.map(i=>'<tr><td>'+esc(materials.find(m=>m.id===i.raw_material_id)?.name||"-")+'</td><td>'+num(i.ordered_quantity_kg)+'</td><td>'+num(i.received_quantity_kg)+'</td><td>'+money(i.unit_price)+'</td><td>'+money(i.ordered_quantity_kg*i.unit_price)+'</td></tr>').join("")+'</tbody></table><div class="total">إجمالي قيمة الطلبية: '+money(total)+'</div><p>توقيع المستلم: ____________________</p><script>window.onload=()=>window.print()<\/script></html>';
    const w=window.open("","_blank");if(!w)return notify("اسمح بفتح نافذة الفاتورة من المتصفح");w.document.open();w.document.write(html);w.document.close();
  }
  function stockPage(){
    const body=materials.map(m=>'<tr><td>'+esc(m.name)+'</td><td><b>'+num(balances.find(b=>b.raw_material_id===m.id)?.quantity_kg||0)+' كجم</b></td></tr>').join("");
    set(panel("مخزون الخامات",'<p class="muted">الرصيد يتحدث تلقائيًا عند تسجيل الاستلام أو صرف الخامات للإنتاج.</p><div class="table-wrap"><table><thead><tr><th>الخامة</th><th>الرصيد الحالي</th></tr></thead><tbody>'+(body||'<tr><td colspan="2" class="empty">لا توجد خامات</td></tr>')+'</tbody></table></div>')+
      panel("تسوية رصيد افتتاحي / جرد",'<form id="adjust-form" class="form-grid">'+select("الخامة","raw_material_id",materials.map(m=>({value:m.id,label:m.name})))+select("نوع الحركة","direction",[{value:"in",label:"إضافة للمخزون"},{value:"out",label:"خصم من المخزون"}])+input("الكمية بالكيلو","quantity","number",'min="0.001" step="0.001" required')+input("ملاحظات","notes")+'</form>'+btn("save-adjust","حفظ التسوية")));
    q("save-adjust").onclick=async()=>{const f=q("adjust-form"),d=new FormData(f);try{const {error}=await sb.rpc("admin_adjust_raw_material_stock",{p_raw_material_id:d.get("raw_material_id"),p_quantity_kg:Number(d.get("quantity")),p_direction:d.get("direction"),p_notes:d.get("notes")||null});if(error)throw error;notify("تم تحديث المخزون");await render()}catch(x){showError(x)}};
  }
  async function render(){
    root.innerHTML='<div class="panel-card">جارٍ تحميل بيانات الموردين والخامات...</div>';
    await load();
    if(view==="suppliers")supplierPage();else if(view==="materials")materialPage();else if(view==="orders")orderPage();else stockPage();
  }
  window.renderElhelwProcurement=async function(target,client){
    root=target;sb=client;view="suppliers";
    await render().catch(showError);
  };
})();