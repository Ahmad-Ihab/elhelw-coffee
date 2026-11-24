/* Elhelw Distribution - supplier procurement and raw material stock UI */
(() => {
  const esc = s => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const num = n => Number(n||0).toLocaleString("en-US",{maximumFractionDigits:3});
  const money = n => new Intl.NumberFormat("ar-EG",{style:"currency",currency:"EGP",maximumFractionDigits:2}).format(Number(n||0));
  let sb, root, suppliers=[], materials=[], prices=[], orders=[], balances=[];
  let view="suppliers", recipes=[], recipeItems=[];
  const q = id => root.querySelector("#"+id);
  const notify = msg => { if(window.elhelwToast) window.elhelwToast(msg); else alert(msg); };
  const rows = async (table, select="*") => { const {data,error}=await sb.from(table).select(select); if(error) throw error; return data||[]; };
  const save = async (table,payload) => { const {error}=await sb.from(table).insert(payload); if(error) throw error; };
  const tabs = () => '<div class="tabs" style="margin:12px 0;flex-wrap:wrap">'+[
    ["suppliers","الموردون"],["materials","الخامات والأسعار"],["orders","طلبيات الموردين"],["stock","مخزون الخامات"],["recipes","توليفات الإنتاج"],["packaging","مخزون التعبئة والتغليف"],["roasting","التحميص"],["factory","تصنيع وتعبئة"]
  ].map(([id,label])=>'<button class="tab '+(view===id?'active':'')+'" data-view="'+id+'">'+label+'</button>').join("")+'</div>';
  const panel = (title,body,action="") => '<section class="panel-card">'+
    '<div class="section-head"><h2>'+title+'</h2>'+action+'</div>'+body+'</section>';
  const btn = (id,label) => '<button class="primary" type="button" id="'+id+'">'+label+'</button>';
  const input = (label,name,type="text",extra="") => '<label class="field">'+label+'<input name="'+name+'" type="'+type+'" '+extra+'></label>';
  const select = (label,name,opts) => '<label class="field">'+label+'<select name="'+name+'" required><option value="">اختر</option>'+opts.map(x=>'<option value="'+esc(x.value)+'">'+esc(x.label)+'</option>').join("")+'</select></label>';
  function set(html){root.innerHTML=html;root.querySelectorAll(".table-wrap").forEach(w=>{const t=w.querySelector("table");if(!t)return;const i=document.createElement("input");i.type="search";i.className="ux-search";i.placeholder="بحث في القائمة…";w.before(i);i.oninput=()=>t.querySelectorAll("tbody tr").forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(i.value.trim().toLowerCase()))});root.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{view=b.dataset.view;render().catch(showError)});}
  function showError(e){console.error(e);root.insertAdjacentHTML("afterbegin",'<div class="panel-card error">'+esc(e.message||"حدث خطأ")+'</div>');}
  async function load(){
    [suppliers,materials,prices,orders,balances]=await Promise.all([
      rows("suppliers","id,name,contact_name,phone,notes,active,created_at"),
      rows("raw_materials",["roasting","factory"].includes(view)?"id,name,unit,active,notes,factory_kind,origin,bean_type,screen_size":"id,name,unit,active,notes"),
      rows("supplier_material_prices","id,supplier_id,raw_material_id,unit_price,updated_at"),
      rows("supplier_purchase_orders","id,order_number,supplier_id,status,order_date,expected_date,supplier_invoice_number,notes,created_at"),
      rows("raw_material_stock_balances","raw_material_id,quantity_kg")
    ]);
    [recipes,recipeItems]=await Promise.all([rows("production_recipes"),rows("production_recipe_items")]);
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
    const html='<form id="material-form" class="form-panel"><h3>إضافة خامة</h3><div class="form-grid">'+input("اسم الخامة","name","text",'required maxlength="150"')+select("وحدة القياس","unit",[{value:"kg",label:"كيلوجرام"}])+'</div><div class="form-actions"><button class="primary">حفظ</button><button type="button" class="secondary" data-close>إلغاء</button></div></form>';
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
  function recipesPage(){
    const body=recipes.map(r=>{
      const items=recipeItems.filter(i=>i.recipe_id===r.id);
      return '<tr><td><b>'+esc(r.name)+'</b></td><td>'+items.length+' خامات</td><td>'+num(r.roast_loss_percent)+'%</td><td>'+(r.active?'نشطة':'موقوفة')+'</td><td><button class="secondary" data-edit-recipe="'+r.id+'">تعديل</button></td></tr>';
    }).join("");
    set(panel("توليفات الإنتاج",'<p class="muted">احفظ حتى 3 توليفات أو أكثر. كل توليفة لها مكوناتها ونسبة الهالك الخاصة بها، وتستخدمها الحاسبة مباشرة.</p><div class="table-wrap"><table><thead><tr><th>التوليفة</th><th>المكونات</th><th>هالك التحميص</th><th>الحالة</th><th></th></tr></thead><tbody>'+(body||'<tr><td colspan="5" class="empty">لم تتم إضافة توليفات بعد</td></tr>')+'</tbody></table></div>',btn("add-recipe","إضافة توليفة")));
    q("add-recipe").onclick=()=>recipeForm();
    root.querySelectorAll("[data-edit-recipe]").forEach(b=>b.onclick=()=>recipeForm(recipes.find(r=>r.id===b.dataset.editRecipe)));
  }
  function recipeForm(recipe){
    if(!materials.length)return notify("أضف الخامات أولاً");
    const existing=recipe?recipeItems.filter(i=>i.recipe_id===recipe.id):[];
    const html='<form id="recipe-form" class="form-panel"><h3>'+(recipe?"تعديل التوليفة":"توليفة إنتاج جديدة")+'</h3><div class="form-grid">'+input("اسم التوليفة","name","text",'required maxlength="100"')+input("هالك التحميص %","roast_loss_percent","number",'min="0" max="99.9" step="0.1" value="20" required')+'<label class="field">الحالة<select name="active"><option value="true">نشطة</option><option value="false">موقوفة</option></select></label><div id="recipe-lines" style="grid-column:1/-1"></div></div><div class="form-actions"><button type="button" class="secondary" id="add-recipe-line">إضافة مكون</button><button class="primary">حفظ التوليفة</button><button type="button" class="secondary" data-close>إلغاء</button></div></form>';
    root.insertAdjacentHTML("afterbegin",html);const f=q("recipe-form"),lines=q("recipe-lines");
    if(recipe){f.elements.name.value=recipe.name;f.elements.roast_loss_percent.value=recipe.roast_loss_percent;f.elements.active.value=String(recipe.active)}
    f.querySelector("[data-close]").onclick=()=>f.remove();
    const addLine=(item={})=>{const wrap=document.createElement("div");wrap.className="form-grid";wrap.style.cssText="border:1px solid var(--line);padding:10px;border-radius:12px;margin:8px 0";wrap.innerHTML=select("الخامة","raw_material_id",materials.filter(m=>m.active).map(m=>({value:m.id,label:m.name})))+input("كمية الخامة لكل 1 كجم منتج","ratio","number",'required min="0.000001" step="0.000001"')+'<label class="field">يطبق عليها هالك التحميص؟<select name="loss"><option value="false">لا</option><option value="true">نعم</option></select></label><button type="button" class="secondary remove-line">حذف المكون</button>';lines.append(wrap);if(item.raw_material_id){wrap.querySelector('[name="raw_material_id"]').value=item.raw_material_id;wrap.querySelector('[name="ratio"]').value=item.output_kg_per_kg;wrap.querySelector('[name="loss"]').value=String(item.apply_roast_loss)}wrap.querySelector(".remove-line").onclick=()=>wrap.remove();};
    if(existing.length)existing.forEach(addLine);else addLine();
    q("add-recipe-line").onclick=()=>addLine();
    f.onsubmit=async e=>{e.preventDefault();const d=new FormData(f),items=[...lines.querySelectorAll(".form-grid")].map(w=>({raw_material_id:w.querySelector('[name="raw_material_id"]').value,output_kg_per_kg:Number(w.querySelector('[name="ratio"]').value),apply_roast_loss:w.querySelector('[name="loss"]').value==="true"}));if(!items.length||items.some(x=>!x.raw_material_id||!x.output_kg_per_kg)||new Set(items.map(x=>x.raw_material_id)).size!==items.length)return notify("تأكد من المكونات وعدم تكرار الخامة");try{
      const payload={name:String(d.get("name")).trim(),roast_loss_percent:Number(d.get("roast_loss_percent")),active:d.get("active")==="true"};
      let recipeId=recipe?.id;
      if(recipe){const {error}=await sb.from("production_recipes").update({...payload,updated_at:new Date().toISOString()}).eq("id",recipe.id);if(error)throw error;const del=await sb.from("production_recipe_items").delete().eq("recipe_id",recipe.id);if(del.error)throw del.error;}
      else{const {data,error}=await sb.from("production_recipes").insert(payload).select("id").single();if(error)throw error;recipeId=data.id;}
      const ins=await sb.from("production_recipe_items").insert(items.map(x=>({...x,recipe_id:recipeId})));if(ins.error)throw ins.error;
      notify("تم حفظ التوليفة، وستظهر في الحاسبة");await render();
    }catch(x){showError(x)}};
  }

  async function packagingPage(){
    const [items,moves]=await Promise.all([rows("packaging_items"),rows("packaging_movements")]);
    if(view!=="packaging")return;
    items.sort((a,b)=>a.kind.localeCompare(b.kind)||a.weight_g-b.weight_g||a.sku.localeCompare(b.sku));
    const table=items.map(i=>'<tr><td>'+esc(i.name)+'</td><td>'+num(i.quantity)+'</td><td>'+money(i.average_cost)+'</td><td>'+money(Number(i.quantity)*Number(i.average_cost))+'</td></tr>').join("");
    const history=moves.sort((a,b)=>b.created_at.localeCompare(a.created_at)).map(m=>'<tr><td>'+esc(new Date(m.created_at).toLocaleString("ar-EG"))+'</td><td>'+esc(items.find(i=>i.sku===m.sku)?.name||m.sku)+'</td><td>'+esc(({purchase:"شراء",opening:"رصيد افتتاحي",waste:"هالك",adjustment_in:"تسوية إضافة",adjustment_out:"تسوية خصم"})[m.movement_type])+'</td><td>'+num(m.quantity_delta)+'</td><td>'+money(m.unit_cost)+'</td><td>'+esc(suppliers.find(s=>s.id===m.supplier_id)?.name||"-")+'</td><td>'+esc(m.invoice_number||"-")+'</td><td>'+esc(m.notes||"-")+'</td></tr>').join("");
    set(panel("مخزون التعبئة والتغليف",'<p class="muted">الأرصدة بالقطعة والتكلفة بالجنيه لكل قطعة.</p><p>إجمالي قيمة المخزون: <b>'+money(items.reduce((a,i)=>a+Number(i.quantity)*Number(i.average_cost),0))+'</b></p><div class="table-wrap"><table><thead><tr><th>الصنف</th><th>الرصيد</th><th>متوسط التكلفة</th><th>القيمة</th></tr></thead><tbody>'+table+'</tbody></table></div>',btn("pack-move","تسجيل حركة"))+panel("سجل الحركات",'<div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>الصنف</th><th>الحركة</th><th>الكمية</th><th>تكلفة القطعة</th><th>المورد</th><th>الفاتورة</th><th>ملاحظات</th></tr></thead><tbody>'+(history||'<tr><td colspan="8">لا توجد حركات</td></tr>')+'</tbody></table></div>'));
    q("pack-move").onclick=()=>packagingForm(items);
  }
  function packagingForm(items){
    if(q("pack-form"))return;
    const types=[["purchase","شراء"],["opening","رصيد افتتاحي"],["waste","هالك"],["adjustment_in","تسوية إضافة"],["adjustment_out","تسوية خصم"]];
    root.insertAdjacentHTML("afterbegin",'<form id="pack-form" class="form-panel"><h3>حركة تعبئة وتغليف</h3><div class="form-grid">'+select("الصنف","sku",items.map(i=>({value:i.sku,label:i.name})))+select("نوع الحركة","type",types.map(([value,label])=>({value,label})))+input("الكمية بالقطعة","qty","number",'required min="1" step="1"')+input("إجمالي التكلفة بالجنيه","cost","number",'min="0" step="0.01"')+select("المورد","supplier",suppliers.filter(s=>s.active).map(s=>({value:s.id,label:s.name})))+input("رقم الفاتورة","invoice")+input("السبب / ملاحظات","notes")+'</div><div class="form-actions"><button class="primary">حفظ</button><button type="button" class="secondary" data-close>إلغاء</button></div></form>');
    const f=q("pack-form"),e=f.elements;let pending=false,requestId=null,signature=null;
    const sync=()=>{const t=e.type.value,inc=["purchase","opening","adjustment_in"].includes(t);e.cost.disabled=!inc;e.cost.required=inc;e.supplier.disabled=t!=="purchase";e.supplier.required=t==="purchase";e.invoice.disabled=t!=="purchase";e.notes.required=["waste","adjustment_in","adjustment_out"].includes(t);};
    e.type.onchange=sync;sync();
    f.querySelector("[data-close]").onclick=()=>{if(!pending)f.remove()};
    f.onsubmit=async ev=>{ev.preventDefault();if(pending)return;const d=new FormData(f),qty=Number(d.get("qty")),t=d.get("type"),cost=d.get("cost");
      if(!Number.isSafeInteger(qty)||qty<=0)return notify("أدخل عدد قطع صحيح");
      const payload={p_sku:d.get("sku"),p_type:t,p_quantity:qty,p_unit_cost:cost===null?null:Number(cost)/qty,p_supplier:d.get("supplier")||null,p_invoice:d.get("invoice")||null,p_notes:d.get("notes")||null};
      const next=JSON.stringify(payload);if(signature!==next){requestId=crypto.randomUUID();signature=next;}
      pending=true;const b=f.querySelector('button.primary');b.disabled=true;
      try{const {error}=await sb.rpc("record_packaging_movement",{p_id:requestId,...payload});if(error)throw error;notify("تم تسجيل الحركة");await render();}
      catch(x){showError(x)}finally{pending=false;b.disabled=false;}
    };
  }

  async function roastingPage(){
    const [stock,batches]=await Promise.all([rows("roasted_stock"),rows("roasting_batches")]);
    if(view!=="roasting")return;
    const name=id=>esc(materials.find(m=>m.id===id)?.name||id);
    const table=stock.map(i=>'<tr><td>'+name(i.raw_material_id)+'</td><td>'+esc(i.roast_degree)+'</td><td>'+num(i.quantity_kg)+'</td><td>'+money(i.average_cost)+'</td></tr>').join("");
    const history=batches.sort((a,b)=>b.created_at.localeCompare(a.created_at)).map(b=>'<tr><td>'+esc(new Date(b.created_at).toLocaleString("ar-EG"))+'</td><td>'+name(b.raw_material_id)+'</td><td>'+esc(b.roast_degree)+'</td><td>'+num(b.input_kg)+'</td><td>'+num(b.output_kg)+'</td><td>'+num(b.loss_percent)+'%</td><td>'+money((Number(b.input_kg)*Number(b.green_unit_cost)+Number(b.processing_cost))/Number(b.output_kg))+'</td></tr>').join("");
    set(panel("مخزون البن المحمص",'<div class="table-wrap"><table><thead><tr><th>الخامة</th><th>التحميص</th><th>كجم</th><th>تكلفة الكيلو</th></tr></thead><tbody>'+(table||'<tr><td colspan="4">لا يوجد مخزون محمص</td></tr>')+'</tbody></table></div>',btn("new-roast","تسجيل تحميص")+btn("classify-material","تصنيف خامة"))+panel("سجل التحميص",'<div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>الخامة</th><th>الدرجة</th><th>قبل</th><th>بعد</th><th>الفاقد</th><th>تكلفة الكيلو</th></tr></thead><tbody>'+history+'</tbody></table></div>'));
    q("new-roast").onclick=()=>roastingForm();
    q("classify-material").onclick=()=>classifyMaterial();
  }
  function classifyMaterial(){
    if(q("classify-form"))return;
    root.insertAdjacentHTML("afterbegin",'<form id="classify-form" class="form-panel"><h3>تصنيف الخامة</h3><div class="form-grid">'+select("الخامة","material",materials.map(m=>({value:m.id,label:m.name})))+select("التصنيف","kind",[{value:"green_coffee",label:"بن أخضر"},{value:"additive",label:"إضافات"}])+input("بلد المنشأ","origin")+input("نوع الحبوب","bean_type")+input("حجم الحبوب","screen_size")+'</div><button class="primary">حفظ</button><button type="button" class="secondary" data-close>إلغاء</button></form>');
    const f=q("classify-form"),e=f.elements;
    e.material.onchange=()=>{const m=materials.find(x=>x.id===e.material.value);for(const k of ["origin","bean_type","screen_size"])e[k].value=m?.[k]||"";e.kind.value=m?.factory_kind||"";};e.material.onchange();
    f.querySelector("[data-close]").onclick=()=>f.remove();
    f.onsubmit=async ev=>{ev.preventDefault();const b=f.querySelector("button.primary");b.disabled=true;try{const {error}=await sb.from("raw_materials").update({factory_kind:e.kind.value,origin:e.origin.value.trim()||null,bean_type:e.bean_type.value.trim()||null,screen_size:e.screen_size.value.trim()||null}).eq("id",e.material.value);if(error)throw error;notify("تم حفظ التصنيف");await render()}catch(x){showError(x)}finally{b.disabled=false}};
  }
  function roastingForm(){
    if(q("roast-form"))return;
    const green=materials.filter(m=>m.active&&m.factory_kind==="green_coffee");
    if(!green.length)return notify("صنف خامة بن أخضر أولاً");
    root.insertAdjacentHTML("afterbegin",'<form id="roast-form" class="form-panel"><h3>تسجيل دفعة تحميص</h3><div class="form-grid">'+select("البن الأخضر","material",green.map(m=>({value:m.id,label:m.name+" — "+num(balances.find(b=>b.raw_material_id===m.id)?.quantity_kg)+" كجم"})))+input("درجة التحميص","degree","text",'required maxlength="80"')+input("الوزن قبل التحميص كجم","before","number",'required min="0.001" step="0.001"')+input("الوزن بعد التحميص كجم","after","number",'required min="0.001" step="0.001"')+input("تكلفة كيلو الخام","cost","number",'required min="0" step="0.0001"')+input("إجمالي تكلفة التحميص","processing","number",'required min="0" step="0.01" value="0"')+input("ملاحظات","notes")+'</div><p id="roast-preview"></p><button class="primary">تنفيذ التحميص</button><button type="button" class="secondary" data-close>إلغاء</button></form>');
    const f=q("roast-form"),e=f.elements;let pending=false,id=null,sig=null;
    f.oninput=()=>{const a=Number(e.before.value),b=Number(e.after.value);q("roast-preview").textContent=a>0&&b>0&&b<=a?"الفاقد: "+num(100*(a-b)/a)+"% — تكلفة الكيلو: "+money((a*Number(e.cost.value)+Number(e.processing.value))/b):""};
    f.querySelector("[data-close]").onclick=()=>{if(!pending)f.remove()};
    f.onsubmit=async ev=>{ev.preventDefault();if(pending)return;const p={p_material:e.material.value,p_degree:e.degree.value.trim(),p_input:Number(e.before.value),p_output:Number(e.after.value),p_green_cost:Number(e.cost.value),p_processing_cost:Number(e.processing.value),p_notes:e.notes.value||null};if(p.p_output>p.p_input)return notify("الناتج لا يمكن أن يتجاوز وزن الخام");const next=JSON.stringify(p);if(next!==sig){id=crypto.randomUUID();sig=next}pending=true;const b=f.querySelector("button.primary");b.disabled=true;try{const {error}=await sb.rpc("record_roasting_batch",{p_id:id,...p});if(error)throw error;notify("تم تسجيل التحميص");await render()}catch(x){showError(x)}finally{pending=false;b.disabled=false}};
  }

  async function factoryPage(){
    const [versions,stock,roasted,products,mappings,batches,packs]=await Promise.all(["factory_blend_versions","factory_blend_stock","roasted_stock","products","factory_product_mapping","factory_blend_batches","factory_packing_batches"].map(t=>rows(t)));
    if(view!=="factory")return;
    const vname=v=> (recipes.find(r=>r.id===v.recipe_id)?.name||v.recipe_id)+" / v"+v.version;
    const opts=versions.map(v=>({value:v.id,label:vname(v)}));
    const table=versions.map(v=>{const b=stock.find(x=>x.version_id===v.id),m=mappings.find(x=>x.version_id===v.id);return '<tr><td>'+esc(vname(v))+'</td><td>'+num(b?.quantity_kg)+'</td><td>'+money(b?.average_cost)+'</td><td>'+esc(products.find(p=>p.id===m?.product_id)?.name||"غير مربوط")+'</td></tr>'}).join("");
    set(panel("تصنيع وتعبئة التوليفات",'<div class="table-wrap"><table><thead><tr><th>التوليفة</th><th>كجم</th><th>تكلفة الكيلو</th><th>المنتج النهائي</th></tr></thead><tbody>'+table+'</tbody></table></div>',btn("factory-recipe","وصفة جديدة")+btn("factory-map","ربط المنتج")+btn("factory-run","تنفيذ إنتاج"))+panel("سجل التصنيع والتعبئة",'<div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>العملية</th><th>الوزن</th><th>التكلفة</th></tr></thead><tbody>'+[...batches.map(b=>({...b,kind:"تصنيع",kg:b.output_kg})),...packs.map(b=>({...b,kind:"تعبئة",kg:b.quantity_kg}))].sort((a,b)=>b.created_at.localeCompare(a.created_at)).map(b=>'<tr><td>'+esc(new Date(b.created_at).toLocaleString("ar-EG"))+'</td><td>'+b.kind+'</td><td>'+num(b.kg)+'</td><td>'+money(b.total_cost)+'</td></tr>').join("")+'</tbody></table></div>'));
    function form(title,body,submit){
      if(q("factory-form"))return;
      root.insertAdjacentHTML("afterbegin",'<form id="factory-form" class="form-panel"><h3>'+title+'</h3><div class="form-grid">'+body+'</div><button class="primary">حفظ</button><button type="button" class="secondary" data-close>إلغاء</button></form>');
      const f=q("factory-form");let busy=false;const ids={};f.querySelector("[data-close]").onclick=()=>{if(!busy)f.remove()};
      f.onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;const b=f.querySelector("button.primary");b.disabled=true;try{await submit(f,ids);notify("تم الحفظ");await render()}catch(x){showError(x)}finally{busy=false;b.disabled=false}};return f;
    }
    const rpc=async(name,args)=>{const {error}=await sb.rpc(name,args);if(error)throw error};
    q("factory-recipe").onclick=()=>{
      const components=[...roasted.map(r=>({value:JSON.stringify({material_id:r.raw_material_id,kind:"roasted",roast_degree:r.roast_degree}),label:(materials.find(m=>m.id===r.raw_material_id)?.name||"")+" / "+r.roast_degree})),...materials.filter(m=>m.active&&m.factory_kind==="additive").map(m=>({value:JSON.stringify({material_id:m.id,kind:"additive"}),label:m.name}))];
      const f=form("وصفة تصنيع جديدة",select("التوليفة","recipe",recipes.filter(r=>r.active).map(r=>({value:r.id,label:r.name})))+'<div id="factory-lines"></div><button type="button" id="factory-add">إضافة مكون</button>',async f=>{const cs=[...f.querySelectorAll("[data-component]")].map(w=>({...JSON.parse(w.querySelector("select").value),ratio:(Number(w.querySelector("input").value)/100).toFixed(5)}));await rpc("save_factory_blend_version",{p_recipe:f.elements.recipe.value,p_components:cs})});
      if(!f)return;const add=()=>{const w=document.createElement("div");w.dataset.component="1";w.innerHTML=select("المكون","component",components)+input("النسبة %","ratio","number",'required min="0.001" max="100" step="0.001"')+'<button type="button">حذف</button>';w.querySelector("button").onclick=()=>w.remove();q("factory-lines").append(w)};q("factory-add").onclick=add;add();
    };
    q("factory-map").onclick=()=>form("ربط المنتج النهائي",select("الوصفة","version",opts)+select("المنتج","product",products.filter(p=>p.active).map(p=>({value:p.id,label:p.name})))+select("نوع الاستيكر","label",["بدون","سادة فاتح","سادة وسط","سادة غامق","محوج فاتح","محوج وسط","محوج غامق","فرنساوي","فرنساوي بندق"].map((label,i)=>({value:String(i),label}))),async f=>rpc("set_factory_product_mapping",{p_version:f.elements.version.value,p_product:f.elements.product.value,p_label:Number(f.elements.label.value)||null}));
    q("factory-run").onclick=()=>{
      const f=form("عملية إنتاج",select("الوصفة","version",opts)+select("العملية","mode",[{value:"blend",label:"تصنيع وتخزين"},{value:"pack",label:"تعبئة من المخزون"},{value:"direct",label:"تصنيع وتعبئة مباشرة"}])+input("وزن المكونات كجم","before","number",'min="0.001" step="0.001"')+input("وزن الناتج كجم","after","number",'min="0.001" step="0.001"')+[50,100,200,500,1000].map(w=>input("عدد أكياس "+w+" جم","bag"+w,"number",'min="0" step="1" value="0"')).join("")+input("تكلفة التصنيع","blendcost","number",'min="0" step="0.01" value="0"')+input("تكلفة التعبئة","packcost","number",'min="0" step="0.01" value="0"')+'<div id="factory-additive-costs"></div>',async(f,ids)=>{
        const e=f.elements,mode=e.mode.value,v=e.version.value,bags=Object.fromEntries([50,100,200,500,1000].map(w=>[String(w),Number(e["bag"+w].value)])),costs=Object.fromEntries([...f.querySelectorAll("[data-additive]")].map(x=>[x.dataset.additive,Number(x.value)]));
        const signature=JSON.stringify([mode,v,bags,costs,e.before.value,e.after.value,e.blendcost.value,e.packcost.value]);if(ids.signature!==signature){ids.signature=signature;ids.blend=crypto.randomUUID();ids.pack=crypto.randomUUID()}
        if(mode==="blend")await rpc("record_factory_blend",{p_id:ids.blend,p_version:v,p_input:Number(e.before.value),p_output:Number(e.after.value),p_additive_costs:costs,p_processing_cost:Number(e.blendcost.value)});
        else if(mode==="pack")await rpc("record_factory_packing",{p_id:ids.pack,p_version:v,p_bags:bags,p_processing_cost:Number(e.packcost.value)});
        else await rpc("record_factory_direct_pack",{p_blend_id:ids.blend,p_pack_id:ids.pack,p_version:v,p_input:Number(e.before.value),p_bags:bags,p_additive_costs:costs,p_blend_cost:Number(e.blendcost.value),p_pack_cost:Number(e.packcost.value)});
      });
      if(!f)return;const e=f.elements;const sync=()=>{const mode=e.mode.value;for(const k of ["before","blendcost"])e[k].disabled=mode==="pack";e.before.required=mode!=="pack";e.after.disabled=mode!=="blend";e.after.required=mode==="blend";for(const w of [50,100,200,500,1000])e["bag"+w].disabled=mode==="blend";e.packcost.disabled=mode==="blend";const box=q("factory-additive-costs");box.innerHTML="";if(mode!=="pack")for(const c of (versions.find(v=>v.id===e.version.value)?.components||[]).filter(c=>c.kind==="additive")){const l=document.createElement("label");l.className="field";l.textContent="تكلفة كيلو "+(materials.find(m=>m.id===c.material_id)?.name||"الإضافة");const i=document.createElement("input");i.type="number";i.min="0";i.step="0.0001";i.required=true;i.dataset.additive=c.material_id;l.append(i);box.append(l)}};e.mode.onchange=sync;e.version.onchange=sync;sync();
    };
  }
  async function render(){
    root.innerHTML='<div class="panel-card">جارٍ تحميل بيانات الموردين والخامات...</div>';
    await load();
    if(view==="suppliers")supplierPage();else if(view==="materials")materialPage();else if(view==="orders")orderPage();else if(view==="recipes")recipesPage();else if(view==="packaging")await packagingPage();else if(view==="roasting")await roastingPage();else if(view==="factory")await factoryPage();else stockPage();
  }
  window.renderElhelwProcurement=async function(target,client,initial="suppliers"){
    root=target;sb=client;view=initial;
    await render().catch(showError);
  };
})();