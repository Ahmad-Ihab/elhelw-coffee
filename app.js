/* Elhelw Coffee distributor workspace. Sensitive business operations are executed by SQL RPCs. */
(() => {
  const cfg = window.APP_CONFIG || {};
  const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("YOUR_PROJECT") &&
    cfg.SUPABASE_PUBLISHABLE_KEY && !cfg.SUPABASE_PUBLISHABLE_KEY.includes("YOUR_SUPABASE");
  const $ = (id) => document.getElementById(id);
  let sb, sessionUser, profile, distributor, activeTab = "dashboard";
  const adminTabs = [["dashboard","الرئيسية"],["distributors","الموزعون"],["commissions","العمولات"],["products","المنتجات والأسعار"],["inventory","المخزون"],["cafes","الكافيهات"],["orders","الطلبيات"],["finance","الحسابات"],["returns","المرتجعات"]];
  const distTabs = [["dashboard","الرئيسية"],["inventory","مخزوني"],["cafes","الكافيهات"],["orders","الطلبيات"],["samples","العينات"],["finance","حساباتي"],["returns","المرتجعات"]];
  const money = n => new Intl.NumberFormat("ar-EG",{style:"currency",currency:"EGP",maximumFractionDigits:2}).format(Number(n||0));
  const qty = n => `${Number(n||0).toLocaleString("en-US",{maximumFractionDigits:3})}`;
  const esc = s => String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function toast(msg){let el=document.createElement("div");el.className="toast";el.textContent=msg;document.body.append(el);setTimeout(()=>el.remove(),3000)}
  function fail(e){console.error(e);toast(e?.message||"حدث خطأ. راجع البيانات وحاول مرة أخرى.");}
  async function rows(table, query){let q=sb.from(table).select(query||"*");let {data,error}=await q; if(error)throw error;return data||[]}
  async function rpc(name,args){let {data,error}=await sb.rpc(name,args);if(error)throw error;return data}
  function setContent(html){$("content").innerHTML=html}
  function table(headers, body){return `<div class="table-wrap"><table><thead><tr>${headers.map(x=>`<th>${x}</th>`).join("")}</tr></thead><tbody>${body||`<tr><td colspan="${headers.length}" class="empty">لا توجد بيانات حتى الآن</td></tr>`}</tbody></table></div>`}
  function section(title,action=""){return `<div class="section-head"><h2>${title}</h2>${action}</div>`}
  function field(label,name,type="text",extra=""){return `<label class="field">${label}<input name="${name}" type="${type}" ${extra}></label>`}
  function selectField(label,name,options){return `<label class="field">${label}<select name="${name}" required><option value="">اختر</option>${options.map(o=>`<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("")}</select></label>`}
  function formPanel(id,title,fields,submitLabel="حفظ"){return `<form id="${id}" class="form-panel"><h3>${title}</h3><div class="form-grid">${fields}</div><div class="form-actions"><button class="primary">${submitLabel}</button><button type="button" class="secondary" data-cancel>إلغاء</button></div></form>`}
  function showForm(html){$("content").insertAdjacentHTML("afterbegin",html);$("content").querySelector("[data-cancel]")?.addEventListener("click",e=>e.target.closest("form").remove())}
  async function boot(){
    if(!configured){$("setup-warning").classList.remove("hidden");return}
    sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY);
    const {data:{session}}=await sb.auth.getSession();
    if(session) await loadUser(session.user); else $("auth-view").classList.remove("hidden");
    sb.auth.onAuthStateChange((event,s)=>{if(event==="SIGNED_OUT"&&!s){location.reload()}});
  }
  async function loadUser(user){
    sessionUser=user;
    const {data:p,error}=await sb.from("profiles").select("*").eq("id",user.id).single();
    if(error)throw error; profile=p;
    if(profile.role==="distributor"){
      const {data:d,error:de}=await sb.from("distributors").select("*").eq("user_id",user.id).single();
      if(de)throw de;distributor=d;
    }
    $("auth-view").classList.add("hidden");$("workspace").classList.remove("hidden");
    $("user-area").innerHTML=`<span>${esc(profile.full_name)} · ${profile.role==="admin"?"إدارة":"موزع"}</span><button id="logout" class="secondary">خروج</button>`;
    $("logout").onclick=()=>sb.auth.signOut();
    $("role-label").textContent=profile.role==="admin"?"ADMIN WORKSPACE":"DISTRIBUTOR WORKSPACE";
    $("welcome-title").textContent=`أهلاً ${profile.full_name}`;
    $("welcome-subtitle").textContent=profile.role==="admin"?"إدارة شبكة الموزعين والمبيعات والمخزون.":"متابعة مخزونك وكافيهاتك وطلبياتك.";
    $("refresh-btn").onclick=render;
    renderTabs();await render();
  }
  function renderTabs(){
    const tabs=profile.role==="admin"?adminTabs:distTabs;
    $("tabs").innerHTML=tabs.map(([id,label])=>`<button class="tab ${activeTab===id?"active":""}" data-tab="${id}">${label}</button>`).join("");
    $("tabs").querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{activeTab=b.dataset.tab;renderTabs();render()});
  }
  async function render(){
    try{
      if(activeTab==="dashboard")return dashboard();
      if(activeTab==="products")return products();
      if(activeTab==="commissions")return commissions();
      if(activeTab==="distributors")return distributors();
      if(activeTab==="inventory")return inventory();
      if(activeTab==="cafes")return cafes();
      if(activeTab==="orders")return orders();
      if(activeTab==="samples")return samples();
      if(activeTab==="finance")return finance();
      if(activeTab==="returns")return returnsPage();
    }catch(e){fail(e);setContent(`<div class="panel-card error">${esc(e.message)}</div>`)}
  }
  async function dashboard(){
    const [prods,cafes,orders,balances]=await Promise.all([
      rows("products","id,name,active"),rows("cafes","id,name,status"),
      rows("orders","id,status,order_number"),rows("stock_balances","quantity")
    ]);
    const total=balances.reduce((a,b)=>a+Number(b.quantity),0);
    const pending=orders.filter(o=>!["delivered","cancelled"].includes(o.status)).length;
    setContent(`<div class="cards">
      <div class="stat"><span>الأصناف النشطة</span><strong>${prods.filter(x=>x.active).length}</strong></div>
      <div class="stat"><span>الكافيهات</span><strong>${cafes.length}</strong></div>
      <div class="stat"><span>الطلبيات المفتوحة</span><strong>${pending}</strong></div>
      <div class="stat"><span>إجمالي المخزون الظاهر لك</span><strong>${qty(total)} كجم</strong></div>
      </div><div class="panel-card"><h2>ابدأ من هنا</h2><p class="muted">سجل الاستلام، أضف الكافيهات، ثم أنشئ الطلبيات وسجل التسليم والتحصيل.</p><p class="hint">يتم عرض البيانات وفق صلاحيات حسابك. عمليات المخزون والمالية الحساسة تتم من خلال وظائف قاعدة البيانات.</p></div>`);
  }
  async function products(){
    if(profile.role!=="admin")return setContent("غير مصرح.");
    const [ps,prices]=await Promise.all([rows("products"),rows("product_prices","product_id,price,effective_from")]);
    const latest={};prices.forEach(p=>{if(!latest[p.product_id]||new Date(p.effective_from)>new Date(latest[p.product_id].effective_from))latest[p.product_id]=p});
    const body=ps.map(p=>`<tr><td>${esc(p.name)}</td><td>${p.active?"نشط":"موقوف"}</td><td>${money(latest[p.id]?.price)}</td></tr>`).join("");
    setContent(section("المنتجات والأسعار",'<button id="add-product" class="primary">إضافة منتج</button>')+table(["المنتج","الحالة","السعر الحالي / كجم"],body));
    $("add-product").onclick=()=>{showForm(formPanel("product-form","منتج جديد",field("اسم المنتج","name")+field("سعر البيع / كجم","price","number",'step="0.01" min="0" required')+field("تكلفة المنتج / كجم","cost_per_unit","number",'step="0.01" min="0" required')));
      $("product-form").onsubmit=async e=>{e.preventDefault();let f=new FormData(e.target);try{let {data,error}=await sb.from("products").insert({name:f.get("name"),cost_per_unit:Number(f.get("cost_per_unit"))}).select().single();if(error)throw error;let r=await sb.from("product_prices").insert({product_id:data.id,price:Number(f.get("price"))});if(r.error){await sb.from("products").delete().eq("id",data.id);throw r.error}toast("تمت إضافة المنتج");render()}catch(x){fail(x)}}};
  }
  async function commissions(){
    if(profile.role!=="admin")return setContent("غير مصرح.");
    const [rules,ds,ps]=await Promise.all([rows("commission_rules"),rows("distributors"),rows("products")]);
    const dn=Object.fromEntries(ds.map(x=>[x.id,x.name])),pn=Object.fromEntries(ps.map(x=>[x.id,x.name]));
    const body=rules.map(r=>`<tr><td>${esc(dn[r.distributor_id]||"")}</td><td>${esc(pn[r.product_id]||"")}</td><td>${r.commission_type==="percentage"?"نسبة مئوية":"مبلغ لكل كجم"}</td><td>${Number(r.commission_value).toLocaleString("en-US")}${r.commission_type==="percentage"?"%":" ج/كجم"}</td><td>${r.active?"نشط":"موقوف"}</td></tr>`).join("");
    setContent(section("قواعد عمولات الموزعين",'<button id="add-commission" class="primary">تحديد عمولة</button>')+table(["الموزع","الصنف","نوع العمولة","القيمة","الحالة"],body)+`<p class="hint">العمولة تُحفظ وقت إصدار الفاتورة؛ تعديل القاعدة يؤثر على التسليمات الجديدة فقط ولا يغيّر الفواتير السابقة.</p>`);
    $("add-commission").onclick=()=>{showForm(formPanel("commission-form","إضافة / تحديث قاعدة عمولة",selectField("الموزع","distributor_id",ds.map(x=>({value:x.id,label:x.name})))+selectField("الصنف","product_id",ps.map(x=>({value:x.id,label:x.name})))+selectField("نوع العمولة","commission_type",[{value:"percentage",label:"نسبة من قيمة البيع"},{value:"per_kg",label:"مبلغ ثابت لكل كجم"}])+field("قيمة العمولة","commission_value","number",'step="0.001" min="0" required')));
      $("commission-form").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{const payload={distributor_id:f.get("distributor_id"),product_id:f.get("product_id"),commission_type:f.get("commission_type"),commission_value:Number(f.get("commission_value")),active:true};const {data:existing,error:lookupError}=await sb.from("commission_rules").select("id").eq("distributor_id",payload.distributor_id).eq("product_id",payload.product_id).limit(1).maybeSingle();if(lookupError)throw lookupError;const result=existing?await sb.from("commission_rules").update(payload).eq("id",existing.id):await sb.from("commission_rules").insert(payload);if(result.error)throw result.error;toast(existing?"تم تحديث قاعدة العمولة":"تمت إضافة قاعدة العمولة");render()}catch(x){fail(x)}}};
  }
  async function distributors(){
    if(profile.role!=="admin")return setContent("غير مصرح.");
    const ds=await rows("distributors");
    const body=ds.map(d=>`<tr><td>${esc(d.name)}</td><td>${esc(d.phone||"-")}</td><td>${d.active?"نشط":"موقوف"}</td></tr>`).join("");
    setContent(section("الموزعون",'<button id="add-dist" class="primary">إضافة موزع</button>')+table(["الاسم","الهاتف","الحالة"],body)+`<p class="hint">إنشاء حساب الدخول يتم من Supabase Authentication ثم ربطه بملف profiles وسجل distributors وفق تعليمات الإعداد.</p>`);
    $("add-dist").onclick=()=>{showForm(formPanel("dist-form","إضافة سجل موزع",field("الاسم","name")+field("رقم الهاتف","phone")+field("معرّف المستخدم من Authentication","user_id")));
      $("dist-form").onsubmit=async e=>{e.preventDefault();let f=new FormData(e.target);try{let {error}=await sb.from("distributors").insert({name:f.get("name"),phone:f.get("phone"),user_id:f.get("user_id")});if(error)throw error;toast("تمت إضافة الموزع");render()}catch(x){fail(x)}}};
  }
  async function inventory(){
    const [bs,ps,ds]=await Promise.all([rows("stock_balances"),rows("products"),profile.role==="admin"?rows("distributors"):Promise.resolve([distributor])]);
    const pn=Object.fromEntries(ps.map(p=>[p.id,p.name])),dn=Object.fromEntries(ds.map(d=>[d.id,d.name]));
    const body=bs.map(b=>`<tr><td>${esc(dn[b.distributor_id]||"")}</td><td>${esc(pn[b.product_id]||"")}</td><td>${qty(b.quantity)} كجم</td></tr>`).join("");
    setContent(section(profile.role==="admin"?"مخزون الموزعين":"مخزوني",profile.role==="admin"?'<button id="receive-stock" class="primary">تسجيل استلام بضاعة</button>':'')+table(["الموزع","الصنف","إجمالي الوزن"],body));
    if($("receive-stock"))$("receive-stock").onclick=async()=>{
      const [ds2,ps2]=await Promise.all([rows("distributors"),rows("products")]);
      showForm(formPanel("receive-form","تسجيل استلام بضاعة",selectField("اسم الصنف","product_id",ps2.map(x=>({value:x.id,label:x.name})))+
        selectField("الموزع","distributor_id",ds2.map(x=>({value:x.id,label:x.name})))+
        field("عدد أكياس 50 جرام","bags_50","number",'min="0" step="1" value="0" inputmode="numeric" required')+
        field("عدد أكياس 100 جرام","bags_100","number",'min="0" step="1" value="0" inputmode="numeric" required')+
        field("عدد أكياس 200 جرام","bags_200","number",'min="0" step="1" value="0" inputmode="numeric" required')+
        field("عدد أكياس 500 جرام","bags_500","number",'min="0" step="1" value="0" inputmode="numeric" required')+
        field("عدد أكياس 1 كيلو","bags_1000","number",'min="0" step="1" value="0" inputmode="numeric" required')+
        '<div class="field"><span>إجمالي الوزن بالكيلو</span><strong id="stock-total-kg">0.000 كجم</strong></div>'+
        field("ملاحظات","notes")));
      const form=$("receive-form");
      const updateTotal=()=>{
        const n50=Number(form.elements.bags_50.value||0),n100=Number(form.elements.bags_100.value||0),n200=Number(form.elements.bags_200.value||0),n500=Number(form.elements.bags_500.value||0),n1000=Number(form.elements.bags_1000.value||0);
        const valid=[n50,n100,n200,n500,n1000].every(n=>Number.isInteger(n)&&n>=0);
        const kg=(n50*50+n100*100+n200*200+n500*500+n1000*1000)/1000;
        $("stock-total-kg").textContent=valid?`${kg.toFixed(3)} كجم`:"راجع أعداد الأكياس";
        return valid?kg:NaN;
      };
      ["bags_50","bags_100","bags_200","bags_500","bags_1000"].forEach(name=>form.elements[name].addEventListener("input",updateTotal));
      form.onsubmit=async e=>{
        e.preventDefault();const f=new FormData(form);const totalKg=updateTotal();
        if(!Number.isFinite(totalKg)||totalKg<=0)return toast("أدخل عدد أكياس صحيحًا، ويجب أن يكون الإجمالي أكبر من صفر");
        try{
          await rpc("admin_receive_stock",{p_distributor_id:f.get("distributor_id"),p_product_id:f.get("product_id"),p_quantity:totalKg,p_notes:f.get("notes")||null});
          toast(`تم تسجيل الاستلام بإجمالي ${totalKg.toFixed(3)} كجم`);render();
        }catch(x){fail(x)}
      };
    };
  }
  async function cafes(){
    const cs=await rows("cafes");
    const body=cs.map(c=>`<tr><td>${esc(c.name)}</td><td>${esc(c.contact_name||"-")}</td><td>${esc(c.phone||"-")}</td><td>${esc(c.status)}</td><td>${profile.role==="admin"?`<select data-cafe-status="${c.id}"><option value="prospect" ${c.status==="prospect"?"selected":""}>محتمل</option><option value="active" ${c.status==="active"?"selected":""}>نشط</option><option value="inactive" ${c.status==="inactive"?"selected":""}>موقوف</option></select>`:""}</td></tr>`).join("");
    setContent(section("الكافيهات",'<button id="add-cafe" class="primary">إضافة كافيه</button>')+table(["الكافيه","المسؤول","الهاتف","الحالة",...(profile.role==="admin"?["تغيير الحالة"]:[])],body));
    if(profile.role==="admin")$("content").querySelectorAll("[data-cafe-status]").forEach(sel=>sel.onchange=async()=>{try{const {error}=await sb.from("cafes").update({status:sel.value}).eq("id",sel.dataset.cafeStatus);if(error)throw error;toast("تم تحديث حالة الكافيه");}catch(x){fail(x);render()}});
    $("add-cafe").onclick=async()=>{const ds=profile.role==="admin"?await rows("distributors"):[];showForm(formPanel("cafe-form","كافيه جديد",(profile.role==="admin"?selectField("الموزع المسؤول","distributor_id",ds.map(x=>({value:x.id,label:x.name}))) : "")+field("اسم الكافيه","name")+field("اسم المسؤول","contact_name")+field("الهاتف","phone")+field("العنوان","address")));
      $("cafe-form").onsubmit=async e=>{e.preventDefault();let f=new FormData(e.target);try{let payload={name:f.get("name"),contact_name:f.get("contact_name"),phone:f.get("phone"),address:f.get("address")};if(distributor)payload.distributor_id=distributor.id;else payload.distributor_id=f.get("distributor_id");let {error}=await sb.from("cafes").insert(payload);if(error)throw error;toast("تمت إضافة الكافيه");render()}catch(x){fail(x)}}};
  }
  async function orders(){
    const [os,cs,ds]=await Promise.all([rows("orders"),rows("cafes"),profile.role==="admin"?rows("distributors"):Promise.resolve([distributor])]);
    const cn=Object.fromEntries(cs.map(c=>[c.id,c.name])),dn=Object.fromEntries(ds.map(d=>[d.id,d.name]));
    const body=os.map(o=>`<tr><td>#${o.order_number}</td><td>${esc(cn[o.cafe_id]||"")}</td><td>${esc(dn[o.distributor_id]||"")}</td><td>${esc(o.expected_delivery||"-")}</td><td><span class="pill">${esc(o.status)}</span></td><td>${o.status==="confirmed"||o.status==="preparing"?`<button class="primary" data-deliver="${o.id}">تأكيد التسليم</button>`:""}</td></tr>`).join("");
    setContent(section("الطلبيات",'<button id="new-order" class="primary">طلبية جديدة</button>')+table(["رقم","الكافيه","الموزع","موعد التسليم","الحالة","إجراء"],body));
    $("new-order").onclick=async()=>{const [cs2,ps2,ds2]=await Promise.all([rows("cafes"),rows("products"),profile.role==="admin"?rows("distributors"):Promise.resolve([distributor])]);showForm(formPanel("order-form","طلبية جديدة",selectField("الكافيه","cafe_id",cs2.map(x=>({value:x.id,label:x.name})))+(profile.role==="admin"?selectField("الموزع","distributor_id",ds2.map(x=>({value:x.id,label:x.name}))):"")+field("موعد التسليم","expected_delivery","date")+selectField("المنتج","product_id",ps2.map(x=>({value:x.id,label:x.name})))+field("الكمية بالكيلو","quantity","number",'step="0.001" min="0.001"')+field("ملاحظات","notes")));
      $("order-form").onsubmit=async e=>{e.preventDefault();let f=new FormData(e.target);try{let d=await rpc("create_distributor_order",{p_cafe_id:f.get("cafe_id"),p_distributor_id:distributor?.id||f.get("distributor_id"),p_product_id:f.get("product_id"),p_quantity:Number(f.get("quantity")),p_expected_delivery:f.get("expected_delivery")||null,p_notes:f.get("notes")||null});toast("تم إنشاء الطلبية");render()}catch(x){fail(x)}}};
    $("content").querySelectorAll("[data-deliver]").forEach(b=>b.onclick=async()=>{if(!confirm("تأكيد تسليم الطلبية وخصمها من المخزون؟"))return;try{await rpc("deliver_order",{p_order_id:b.dataset.deliver});toast("تم التسليم وإنشاء الفاتورة");render()}catch(x){fail(x)}});
  }
  async function samples(){
    const [ss,cs,ps]=await Promise.all([rows("samples"),rows("cafes"),rows("products")]);
    const cn=Object.fromEntries(cs.map(x=>[x.id,x.name]));
    const body=ss.map(s=>`<tr><td>${esc(cn[s.cafe_id]||"")}</td><td>${esc(s.sample_date)}</td><td>${esc(s.feedback||"-")}</td></tr>`).join("");
    setContent(section("العينات",'<button id="new-sample" class="primary">تسجيل عينة</button>')+table(["الكافيه","التاريخ","التقييم"],body));
    $("new-sample").onclick=()=>{showForm(formPanel("sample-form","تسجيل عينة",selectField("الكافيه","cafe_id",cs.map(x=>({value:x.id,label:x.name})))+selectField("الصنف","product_id",ps.map(x=>({value:x.id,label:x.name})))+field("الكمية بالكيلو","quantity","number",'step="0.001" min="0.001"')+field("ملاحظات / Feedback","feedback")));
      $("sample-form").onsubmit=async e=>{e.preventDefault();let f=new FormData(e.target);try{await rpc("record_sample",{p_cafe_id:f.get("cafe_id"),p_product_id:f.get("product_id"),p_quantity:Number(f.get("quantity")),p_feedback:f.get("feedback")||null});toast("تم تسجيل العينة وخصمها من المخزون");render()}catch(x){fail(x)}}};
  }
  async function returnsPage(){
    const [rs,refunds,items,inv,ds,ps]=await Promise.all([
      rows("sales_returns"),rows("sales_return_refunds"),rows("sales_return_items"),
      rows("sales_invoices"),profile.role==="admin"?rows("distributors"):Promise.resolve([distributor]),rows("products")
    ]);
    const dn=Object.fromEntries(ds.map(x=>[x.id,x.name])),pn=Object.fromEntries(ps.map(x=>[x.id,x.name]));
    const refundByReturn=Object.fromEntries(refunds.map(x=>[x.return_id,x]));
    const body=rs.map(r=>{const rf=refundByReturn[r.id];return `<tr><td>#${r.return_number}</td><td>${money(items.filter(i=>i.return_id===r.id).reduce((a,i)=>a+Number(i.refund_amount),0))}</td><td>${esc(r.inspection_status)}</td><td>${rf?(rf.delivered_at?"تم التسليم":rf.funded_at?"تم التمويل":"بانتظار التمويل"):"-"}</td><td>${profile.role==="admin"&&!rf?`<button data-allocate="${r.id}" class="secondary">تخصيص مبلغ الرد</button>`: ""}${profile.role==="admin"&&rf&&!rf.funded_at?`<button data-fund="${rf.id}" class="primary">تأكيد التمويل</button>`: ""}${profile.role==="admin"&&rf&&rf.funded_at&&!rf.delivered_at?`<button data-refund-delivered="${rf.id}" class="primary">تأكيد التسليم</button>`:""}</td></tr>`}).join("");
    setContent(section("المرتجعات",'<button id="new-return" class="primary">تسجيل مرتجع</button>')+table(["رقم المرتجع","قيمة الاسترداد","الفحص","حالة رد المبلغ","إجراء"],body)+
      (profile.role==="admin"?section("فحص المرتجعات",""):"")+
      (profile.role==="admin"?table(["الصنف","الكمية المرتجعة","المرتجع","إجراء"],items.map(i=>{const r=rs.find(x=>x.id===i.return_id);return `<tr><td>${esc(pn[i.product_id]||"")}</td><td>${qty(i.quantity)}</td><td>#${r?.return_number||""}</td><td><button data-inspect="${i.id}" class="secondary">تسوية المخزون</button></td></tr>`}).join("")):""));
    $("new-return").onclick=async()=>{
      const invOptions=inv.map(x=>({value:x.id,label:"#"+x.invoice_number+" · "+money(x.total_amount)}));
      showForm(formPanel("return-form","تسجيل مرتجع",selectField("الفاتورة","invoice_id",invOptions)+field("سبب المرتجع","reason")+field("ملاحظات","notes")));
      const form=$("return-form");
      form.insertAdjacentHTML("beforeend",'<div id="return-lines" class="form-grid"></div>');
      form.querySelector('[name="invoice_id"]').onchange=async e=>{
        try{const lines=await rows("sales_invoice_items");const selected=lines.filter(x=>x.invoice_id===e.target.value);$("return-lines").innerHTML=selected.map((x,i)=>`<label class="field">${esc(pn[x.product_id]||"صنف")} · مباع ${qty(x.quantity)} كجم<input type="number" min="0" max="${x.quantity}" step="0.001" name="return_qty_${x.id}" placeholder="كمية المرتجع"></label>`).join("");form.dataset.lineIds=selected.map(x=>x.id).join(",")}catch(x){fail(x)}
      };
      form.onsubmit=async e=>{e.preventDefault();const fd=new FormData(form);const ids=(form.dataset.lineIds||"").split(",").filter(Boolean);const payload=ids.map(id=>({invoice_item_id:id,quantity:Number(fd.get("return_qty_"+id)||0)})).filter(x=>x.quantity>0);if(!payload.length)return toast("حدد كمية مرتجعة واحدة على الأقل");try{const returnId=await rpc("record_sales_return",{p_invoice_id:fd.get("invoice_id"),p_items:payload,p_reason:fd.get("reason")||null,p_notes:fd.get("notes")||null});toast(profile.role==="admin"?"تم تسجيل المرتجع":"تم تسجيل المرتجع وإرساله للإدارة لتخصيص رد المبلغ");render()}catch(x){fail(x)}};
    };
    $("content").querySelectorAll("[data-allocate]").forEach(b=>b.onclick=async()=>{try{await rpc("fund_sales_return_refund",{p_return_id:b.dataset.allocate,p_notes:null});toast("تم تخصيص مبلغ رد المرتجع");render()}catch(x){fail(x)}});
    $("content").querySelectorAll("[data-fund]").forEach(b=>b.onclick=async()=>{try{await rpc("confirm_sales_return_refund_funding",{p_refund_id:b.dataset.fund});toast("تم تأكيد تمويل رد المبلغ");render()}catch(x){fail(x)}});
    $("content").querySelectorAll("[data-refund-delivered]").forEach(b=>b.onclick=async()=>{try{await rpc("confirm_sales_return_refund_delivery",{p_refund_id:b.dataset.refundDelivered});toast("تم تأكيد تسليم المبلغ للكافيه");render()}catch(x){fail(x)}});
    $("content").querySelectorAll("[data-inspect]").forEach(b=>b.onclick=()=>{
      const id=b.dataset.inspect;const item=items.find(x=>x.id===id);if(!item)return;
      const activeDistributors=ds.filter(d=>d.active!==false);
      const destinationOptions=activeDistributors.map(d=>({value:d.id,label:d.name}));
      showForm(formPanel("return-settlement-form","تسوية مخزون المرتجع", 
        selectField("مصير البضاعة","disposition",[
          {value:"released_to_company",label:"إرجاع إلى مخزون الشركة"},
          {value:"released_to_distributor",label:"تسليم إلى موزع آخر"},
          {value:"damaged",label:"بضاعة تالفة"}
        ])+
        '<div id="return-destination-wrap" class="hidden">'+selectField("الموزع المستلم","destination_distributor_id",destinationOptions)+'</div>'+
        field("الكمية التي ستتم تسويتها (كجم)","quantity","number",`min="0.001" max="${Number(item.quantity)}" step="0.001" value="${Number(item.quantity)}" required`)+
        '<p class="hint">الكمية المتاحة في هذا البند: '+qty(item.quantity)+' كجم</p>'
      ,"تأكيد التسوية"));
      const form=$("return-settlement-form");
      const dispositionSelect=form.elements.disposition;
      const destinationWrap=$("return-destination-wrap");
      const destinationSelect=form.elements.destination_distributor_id;
      const updateDestination=()=>{
        const needsDistributor=dispositionSelect.value==="released_to_distributor";
        destinationWrap.classList.toggle("hidden",!needsDistributor);
        destinationSelect.required=needsDistributor;
        if(!needsDistributor)destinationSelect.value="";
      };
      dispositionSelect.addEventListener("change",updateDestination);
      updateDestination();
      form.onsubmit=async e=>{
        e.preventDefault();const fd=new FormData(form);const amount=Number(fd.get("quantity"));
        if(!Number.isFinite(amount)||amount<=0||amount>Number(item.quantity))return toast("أدخل كمية صحيحة لا تتجاوز الكمية المرتجعة");
        const disposition=fd.get("disposition");
        const destination=disposition==="released_to_distributor"?fd.get("destination_distributor_id"):null;
        if(disposition==="released_to_distributor"&&!destination)return toast("اختر الموزع المستلم");
        const submit=form.querySelector('button[type="submit"],button:not([type])');
        if(submit){submit.disabled=true;submit.textContent="جارٍ تنفيذ التسوية...";}
        try{
          await rpc("process_return_quarantine",{p_return_item_id:id,p_quantity:amount,p_disposition:disposition,p_destination_distributor_id:destination,p_notes:null});
          toast("تمت تسوية كمية المرتجع");render();
        }catch(x){if(submit){submit.disabled=false;submit.textContent="تأكيد التسوية";}fail(x)}
      };
    });
  }
  async function finance(){
    const [inv,pay,rem]=await Promise.all([rows("sales_invoices"),rows("cafe_payments"),profile.role==="admin"?rows("distributor_remittances"):Promise.resolve([])]);
    const sales=inv.reduce((a,x)=>a+Number(x.total_amount),0),paid=pay.reduce((a,x)=>a+Number(x.amount),0);
    setContent(`<div class="cards"><div class="stat"><span>إجمالي الفواتير</span><strong>${money(sales)}</strong></div><div class="stat"><span>إجمالي تحصيلات الكافيهات</span><strong>${money(paid)}</strong></div><div class="stat"><span>عدد الفواتير</span><strong>${inv.length}</strong></div><div class="stat"><span>توريدات الشركة</span><strong>${money(rem.reduce((a,x)=>a+Number(x.amount),0))}</strong></div></div>
      ${section("الفواتير",'<button id="add-payment" class="primary">تسجيل تحصيل كافيه</button>')}${table(["رقم الفاتورة","الإجمالي","عمولة الموزع","صافي الشركة","التاريخ"],inv.map(i=>`<tr><td>#${i.invoice_number}</td><td>${money(i.total_amount)}</td><td>${money(i.total_commission)}</td><td>${money(i.company_net)}</td><td>${new Date(i.invoice_date).toLocaleDateString("ar-EG")}</td></tr>`).join(""))}
      <p class="hint">هذه شاشة ملخص أولية. سيتم استكمال كشوف الحساب التفصيلية وتوزيع الدفعات على الفواتير في مرحلة الحسابات.</p>`);
    $("add-payment").onclick=async()=>{const cs=await rows("cafes");showForm(formPanel("payment-form","تسجيل تحصيل",selectField("الكافيه","cafe_id",cs.map(x=>({value:x.id,label:x.name})))+field("المبلغ","amount","number",'min="0.01" step="0.01"')+selectField("طريقة الدفع","payment_method",["cash","instapay","bank_transfer","other"].map(x=>({value:x,label:x})))+selectField("تم التحصيل بواسطة","received_by",profile.role==="admin"?[{value:"distributor",label:"الموزع"},{value:"company",label:"الشركة"}]:[{value:"distributor",label:"الموزع"}])));$("payment-form").onsubmit=async e=>{e.preventDefault();let f=new FormData(e.target);try{await rpc("record_cafe_payment",{p_cafe_id:f.get("cafe_id"),p_amount:Number(f.get("amount")),p_payment_method:f.get("payment_method"),p_received_by:f.get("received_by")});toast("تم تسجيل التحصيل");render()}catch(x){fail(x)}}};
    if(profile.role==="admin"){
      const ds=await rows("distributors");
      $("content").insertAdjacentHTML("afterbegin",`<div class="panel-card"><h3>تسجيل توريد من الموزع للشركة</h3><form id="remit-form" class="form-grid">${selectField("الموزع","distributor_id",ds.map(x=>({value:x.id,label:x.name})))+field("المبلغ","amount","number",'min="0.01" step="0.01" required')+selectField("طريقة الدفع","payment_method",[{value:"cash",label:"نقدي"},{value:"instapay",label:"InstaPay"},{value:"bank_transfer",label:"تحويل بنكي"}])+field("رقم مرجعي","reference")}</form><button id="save-remit" class="primary">حفظ التوريد</button></div>`);
      $("save-remit").onclick=async()=>{const f=new FormData($("remit-form"));try{await rpc("record_distributor_remittance",{p_distributor_id:f.get("distributor_id"),p_amount:Number(f.get("amount")),p_payment_method:f.get("payment_method"),p_reference:f.get("reference")||null,p_notes:null});toast("تم تسجيل التوريد");render()}catch(x){fail(x)}};
    } else {
      $("content").insertAdjacentHTML("afterbegin",`<div class="panel-card"><h3>تسليم تحصيلات الشركة</h3><form id="remit-form" class="form-grid">${field("المبلغ","amount","number",'min="0.01" step="0.01" required')+selectField("طريقة الدفع","payment_method",[{value:"cash",label:"نقدي"},{value:"instapay",label:"InstaPay"},{value:"bank_transfer",label:"تحويل بنكي"}])+field("رقم مرجعي","reference")}</form><button id="save-remit" class="primary">تسجيل التوريد</button></div>`);
      $("save-remit").onclick=async()=>{const f=new FormData($("remit-form"));try{await rpc("record_distributor_remittance",{p_distributor_id:null,p_amount:Number(f.get("amount")),p_payment_method:f.get("payment_method"),p_reference:f.get("reference")||null,p_notes:null});toast("تم تسجيل التوريد");render()}catch(x){fail(x)}};
    }
  }
  $("login-form").onsubmit=async e=>{e.preventDefault();$("login-error").textContent="";let {error}=await sb.auth.signInWithPassword({email:$("email").value,password:$("password").value});if(error){$("login-error").textContent=error.message;return}location.reload()};
  boot().catch(fail);
})();