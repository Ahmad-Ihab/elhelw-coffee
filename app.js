/* Elhelw Coffee distributor workspace. Sensitive business operations are executed by SQL RPCs. */
(() => {
  const cfg = window.APP_CONFIG || {};
  const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("YOUR_PROJECT") &&
    cfg.SUPABASE_PUBLISHABLE_KEY && !cfg.SUPABASE_PUBLISHABLE_KEY.includes("YOUR_SUPABASE");
  const $ = (id) => document.getElementById(id);
  let sb, sessionUser, profile, distributor, activeTab = "dashboard";
  const adminTabs = [["dashboard","الرئيسية"],["people","دليل الأفراد"],["distributors","الموزعون"],["commissions","العمولات"],["products","المنتجات والأسعار"],["inventory","المخزون"],["cafes","الكافيهات"],["orders","الطلبيات"],["finance","الحسابات"],["returns","المرتجعات"],["productionCalculator","حاسبة الإنتاج"],["adminTools","أدوات الإدارة"],["profile","ملفي الشخصي"]];
  const distTabs = [["dashboard","الرئيسية"],["inventory","مخزوني"],["cafes","الكافيهات"],["orders","الطلبيات"],["samples","العينات"],["finance","حساباتي"],["returns","المرتجعات"],["profile","ملفي الشخصي"]];
  const money = n => new Intl.NumberFormat("ar-EG",{style:"currency",currency:"EGP",maximumFractionDigits:2}).format(Number(n||0));
  const qty = n => `${Number(n||0).toLocaleString("en-US",{maximumFractionDigits:3})}`;
  const esc = s => String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function toast(msg){let el=document.createElement("div");el.className="toast";el.textContent=msg;document.body.append(el);setTimeout(()=>el.remove(),3000)}
  function fail(e){console.error(e);toast(e?.message||"حدث خطأ. راجع البيانات وحاول مرة أخرى.");}
  async function rows(table, query){let q=sb.from(table).select(query||"*");let {data,error}=await q; if(error)throw error;return data||[]}
  async function rpc(name,args){let {data,error}=await sb.rpc(name,args);if(error)throw error;return data}
  function setContent(html){$("content").innerHTML=html}
  const bagFields = p => [["50","50 جرام"],["100","100 جرام"],["200","200 جرام"],["500","500 جرام"],["1000","1 كيلو"]].map(([k,l])=>field("عدد أكياس "+l,p+k,"number",'min="0" step="1" value="0" required')).join("");
  const readBags = (f,p) => Object.fromEntries(["50","100","200","500","1000"].map(k=>[k,Number(f.elements[p+k].value||0)]));
  const bagsKg = b => (50*b["50"]+100*b["100"]+200*b["200"]+500*b["500"]+1000*b["1000"])/1000;
  const bagsLabel = b => b ? ["50","100","200","500","1000"].map(k=>Number(b[k]||0)?k+"جم: "+b[k]:"").filter(Boolean).join(" · ") : "تفاصيل الأكياس غير متاحة";
  function table(headers, body){return `<div class="table-wrap"><table><thead><tr>${headers.map(x=>`<th>${x}</th>`).join("")}</tr></thead><tbody>${body||`<tr><td colspan="${headers.length}" class="empty">لا توجد بيانات حتى الآن</td></tr>`}</tbody></table></div>`}
  function section(title,action=""){return `<div class="section-head"><h2>${title}</h2>${action}</div>`}
  function field(label,name,type="text",extra=""){return `<label class="field">${label}<input name="${name}" type="${type}" ${extra}></label>`}
  function selectField(label,name,options){return `<label class="field">${label}<select name="${name}" required><option value="">اختر</option>${options.map(o=>`<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("")}</select></label>`}
  function formPanel(id,title,fields,submitLabel="حفظ"){return `<form id="${id}" class="form-panel"><h3>${title}</h3><div class="form-grid">${fields}</div><div class="form-actions"><button class="primary">${submitLabel}</button><button type="button" class="secondary" data-cancel>إلغاء</button></div></form>`}
  function showForm(html){$("content").insertAdjacentHTML("afterbegin",html);$("content").querySelector("[data-cancel]")?.addEventListener("click",e=>e.target.closest("form").remove())}
  function profileComplete(){const nameOk=(profile?.full_name||"").trim().split(/\s+/).filter(Boolean).length>=3;const photoOk=!!profile?.avatar_path;const idOk=profile?.role==="distributor"?/^\d{14}$/.test(profile?.national_id||""):(!profile?.national_id||/^\d{14}$/.test(profile.national_id));return nameOk&&photoOk&&idOk;}
  async function signedAvatarUrl(path){if(!path)return "";const {data,error}=await sb.storage.from("profile-avatars").createSignedUrl(path,3600);if(error)throw error;return data?.signedUrl||"";}
  async function refreshUserArea(){const url=await signedAvatarUrl(profile.avatar_path).catch(()=> "");const photo=url?`<img class="user-avatar" src="${url}" alt="الصورة الشخصية">`:"";$("user-area").innerHTML=`${photo}<span>${esc(profile.full_name)} · ${profile.role==="admin"?"إدارة":"موزع"}</span><button id="logout" class="secondary">خروج</button>`;$("logout").onclick=()=>sb.auth.signOut();}
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
    if(!profileComplete())activeTab="profile";
    await refreshUserArea();
    $("role-label").textContent=profile.role==="admin"?"ADMIN WORKSPACE":"DISTRIBUTOR WORKSPACE";
    $("welcome-title").textContent=`أهلاً ${profile.full_name}`;
    $("welcome-subtitle").textContent=profile.role==="admin"?"إدارة شبكة الموزعين والمبيعات والمخزون.":"متابعة مخزونك وكافيهاتك وطلبياتك.";
    $("refresh-btn").onclick=render;
    renderTabs();await render();
  }
  function renderTabs(){
    const tabs=profile.role==="admin"?adminTabs:distTabs;
    $("tabs").innerHTML=tabs.map(([id,label])=>`<button class="tab ${activeTab===id?"active":""}" data-tab="${id}">${label}</button>`).join("");
    $("tabs").querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{if(!profileComplete() && b.dataset.tab!=="profile")return toast("أكمل الاسم الثلاثي والصورة الشخصية"+(profile.role==="distributor"?" ورقم البطاقة":"")+" أولاً");activeTab=b.dataset.tab;renderTabs();render()});
  }
  async function render(){
    if(profile && !profileComplete() && activeTab!=="profile"){activeTab="profile";renderTabs();return profilePage();}
    try{
      if(activeTab==="dashboard")return dashboard();
      if(activeTab==="products")return products();
      if(activeTab==="commissions")return commissions();
      if(activeTab==="distributors")return distributors();
      if(activeTab==="people")return peopleDirectory();
      if(activeTab==="inventory")return inventory();
      if(activeTab==="cafes")return cafes();
      if(activeTab==="orders")return orders();
      if(activeTab==="samples")return samples();
      if(activeTab==="finance")return finance();
      if(activeTab==="returns")return returnsPage();
      if(activeTab==="productionCalculator")return productionCalculator();
      if(activeTab==="adminTools")return adminTools();
      if(activeTab==="profile")return profilePage();
    }catch(e){fail(e);setContent(`<div class="panel-card error">${esc(e.message)}</div>`)}
  }
  async function productionCalculator(){
    if(profile.role!=="admin")return setContent('<div class="panel-card error">غير مصرح لك باستخدام حاسبة الإنتاج.</div>');
    setContent('<div id="production-calculator"></div>');
    if(typeof window.renderElhelwProductionCalculator!=="function")throw new Error("ملف حاسبة الإنتاج لم يتم تحميله. حدّث التطبيق وحاول مرة أخرى.");
    window.renderElhelwProductionCalculator(sessionUser.id,sb);
  }
  async function adminTools(){
    if(profile.role!=="admin")return setContent("غير مصرح.");
    setContent(section("أدوات الإدارة","")+
      '<div class="panel-card"><h3>تصفير بيانات التشغيل التجريبية</h3><p class="muted">يمسح كل العمليات والبيانات التشغيلية التجريبية، بما فيها الطلبيات والفواتير والتحصيلات والمرتجعات والعينات والمخزون والكافيهات والموزعين التشغيليين.</p><p class="hint">لن يتم حذف حسابات الدخول أو أدوار المستخدمين أو المنتجات والأسعار وقواعد العمولات.</p><button id="reset-demo-data" class="danger">مسح كل العمليات التجريبية</button></div>');
    $("reset-demo-data").onclick=async()=>{
      if(!confirm("تحذير نهائي: سيتم حذف كل العمليات والبيانات التشغيلية التجريبية نهائياً. هل تريد المتابعة؟"))return;
      const typed=prompt('لتأكيد المسح اكتب RESET');
      if(typed!=="RESET")return toast("تم إلغاء العملية. نص التأكيد غير مطابق.");
      const btn=$("reset-demo-data");btn.disabled=true;btn.textContent="جارٍ مسح البيانات...";
      try{await rpc("admin_reset_demo_data",{});toast("تم تصفير بيانات التجربة بنجاح");activeTab="dashboard";renderTabs();await render();}
      catch(e){btn.disabled=false;btn.textContent="مسح كل العمليات التجريبية";fail(e)}
    };
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
    const body=ps.map(p=>"<tr><td>"+esc(p.name)+"</td><td>"+(p.active?"نشط":"موقوف")+"</td><td>"+money(latest[p.id]?.price)+"</td><td><button class='secondary' data-edit-product='"+p.id+"'>تعديل</button></td></tr>").join("");
    setContent(section("المنتجات والأسعار",'<button id="add-product" class="primary">إضافة منتج</button>')+table(["المنتج","الحالة","السعر الحالي / كجم","إدارة"],body));
    $("add-product").onclick=()=>{showForm(formPanel("product-form","منتج جديد",field("اسم المنتج","name")+field("سعر البيع / كجم","price","number",'step="0.01" min="0" required')+field("تكلفة المنتج / كجم","cost_per_unit","number",'step="0.01" min="0" required')));
      $("product-form").onsubmit=async e=>{e.preventDefault();let f=new FormData(e.target);try{let {data,error}=await sb.from("products").insert({name:String(f.get("name")).trim(),cost_per_unit:Number(f.get("cost_per_unit"))}).select().single();if(error)throw error;let r=await sb.from("product_prices").insert({product_id:data.id,price:Number(f.get("price"))});if(r.error)throw r.error;toast("تمت إضافة المنتج");render()}catch(x){fail(x)}}};
    $("content").querySelectorAll("[data-edit-product]").forEach(btn=>btn.onclick=()=>{const p=ps.find(x=>x.id===btn.dataset.editProduct),price=latest[p.id]?.price??0;
      showForm(formPanel("product-edit-form","تعديل بيانات الصنف",field("اسم الصنف","name")+field("تكلفة الكيلو","cost_per_unit","number",'step="0.01" min="0" required')+field("سعر البيع / كجم","price","number",'step="0.01" min="0" required')+selectField("الحالة","active",[{value:"true",label:"نشط"},{value:"false",label:"موقوف"}])));
      const form=$("product-edit-form");form.elements.name.value=p.name;form.elements.cost_per_unit.value=p.cost_per_unit;form.elements.price.value=price;form.elements.active.value=String(p.active);
      form.onsubmit=async e=>{e.preventDefault();const d=new FormData(form);try{const {error}=await sb.from("products").update({name:String(d.get("name")).trim(),cost_per_unit:Number(d.get("cost_per_unit")),active:d.get("active")==="true"}).eq("id",p.id);if(error)throw error;
        if(Number(d.get("price"))!==Number(price)){const pr=await sb.from("product_prices").insert({product_id:p.id,price:Number(d.get("price"))});if(pr.error)throw pr.error}
        toast("تم تحديث الصنف. الفواتير القديمة لم تتغير.");render();
      }catch(x){fail(x)}};
    });
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
    const body=ds.map(d=>"<tr><td>"+esc(d.name)+"</td><td>"+esc(d.phone||"-")+"</td><td>"+(d.active?"نشط":"موقوف")+"</td><td><button class='secondary' data-edit-dist='"+d.id+"'>تعديل البيانات</button></td></tr>").join("");
    setContent(section("الموزعون",'<button id="add-dist" class="primary">إضافة موزع / حساب إداري</button>')+table(["الاسم","الهاتف","الحالة","إدارة"],body));
    $("content").querySelectorAll("[data-edit-dist]").forEach(btn=>btn.onclick=()=>{
      const d=ds.find(x=>x.id===btn.dataset.editDist);
      showForm(formPanel("dist-edit-form","تعديل بيانات الموزع",field("اسم الموزع","name")+field("رقم الهاتف","phone")+selectField("الحالة","active",[{value:"true",label:"نشط"},{value:"false",label:"موقوف"}])));
      const form=$("dist-edit-form");form.elements.name.value=d.name||"";form.elements.phone.value=d.phone||"";form.elements.active.value=String(d.active);
      form.onsubmit=async e=>{e.preventDefault();const f=new FormData(form);try{
        const {error}=await sb.from("distributors").update({name:String(f.get("name")).trim(),phone:String(f.get("phone")||"").trim()||null,active:f.get("active")==="true"}).eq("id",d.id);
        if(error)throw error;
        const {error:profileError}=await sb.from("profiles").update({full_name:String(f.get("name")).trim()}).eq("id",d.user_id);
        if(profileError)throw profileError;
        toast("تم تحديث بيانات الموزع");render();
      }catch(x){fail(x)}};
    });
    $("add-dist").onclick=()=>{showForm(formPanel("account-form","إنشاء حساب جديد",field("الاسم الثلاثي","full_name")+field("البريد الإلكتروني","email","email")+field("كلمة المرور","password","password",'minlength="8" required')+selectField("نوع الحساب","role",[{value:"distributor",label:"موزع"},{value:"admin",label:"مدير"}])+field("رقم البطاقة الشخصية (إجباري للموزع)","national_id","text",'inputmode="numeric" maxlength="14" minlength="14" pattern="[0-9]{14}"')+field("رقم الهاتف (للموزع)","phone")+field("الصورة الشخصية (اختياري للموزع)","avatar_file","file",'accept="image/jpeg,image/png,image/webp"')));
      const form=$("account-form"),idInput=form.elements.national_id,roleInput=form.elements.role,avatarInput=form.elements.avatar_file;
      const syncRole=()=>{idInput.required=roleInput.value==="distributor";avatarInput.closest("label").hidden=roleInput.value!=="distributor";};roleInput.addEventListener("change",syncRole);syncRole();
      form.onsubmit=async e=>{e.preventDefault();const d=new FormData(form),submit=form.querySelector("button"),name=String(d.get("full_name")||"").trim(),nationalId=String(d.get("national_id")||"").trim(),role=String(d.get("role")||"");
        if(name.split(/\s+/).filter(Boolean).length<3)return toast("اكتب الاسم الثلاثي كاملًا");
        if(role==="distributor"&&!/^\d{14}$/.test(nationalId))return toast("رقم البطاقة للموزع يجب أن يتكون من 14 رقمًا");
        if(nationalId&&!/^\d{14}$/.test(nationalId))return toast("رقم البطاقة يجب أن يتكون من 14 رقمًا");
        const avatar=d.get("avatar_file");if(avatar?.size>3*1024*1024)return toast("حجم الصورة يجب ألا يتجاوز 3 ميجابايت");
        if(avatar?.size&&!["image/jpeg","image/png","image/webp"].includes(avatar.type))return toast("اختر صورة JPG أو PNG أو WebP");
        submit.disabled=true;
        try{const {data:{session}}=await sb.auth.getSession();if(!session)throw new Error("انتهت الجلسة. سجل الدخول مرة أخرى.");
          const response=await fetch(cfg.SUPABASE_URL+"/functions/v1/admin-create-user",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+session.access_token,"apikey":cfg.SUPABASE_PUBLISHABLE_KEY},body:JSON.stringify({full_name:name,national_id:nationalId||null,email:String(d.get("email")).trim(),password:d.get("password"),role,phone:String(d.get("phone")||"").trim()})});
          const result=await response.json();if(!response.ok)throw new Error(result.error||"تعذر إنشاء الحساب");
          let identityWarning="";const {error:identityError}=await sb.from("profiles").update({national_id:nationalId||null}).eq("id",result.user_id);if(identityError){console.error(identityError);identityWarning=" لكن تعذر حفظ رقم البطاقة؛ راجع بيانات الحساب قبل تسليمه للموزع."}
          let photoWarning="";
          if(avatar?.size){try{const ext={"image/jpeg":"jpg","image/png":"png","image/webp":"webp"}[avatar.type],path=result.user_id+"/"+Date.now()+"."+ext;
            const {error:uploadError}=await sb.storage.from("profile-avatars").upload(path,avatar,{cacheControl:"3600",upsert:false,contentType:avatar.type});if(uploadError)throw uploadError;
            const {error:updateError}=await sb.from("profiles").update({avatar_path:path}).eq("id",result.user_id);if(updateError){await sb.storage.from("profile-avatars").remove([path]);throw updateError;}
          }catch(photoError){console.error(photoError);photoWarning=" لكن تعذر رفع الصورة؛ سيُطلب من المستخدم رفعها عند أول دخول."}}
          toast("تم إنشاء الحساب وربطه بنجاح"+identityWarning+photoWarning);render();
        }catch(x){fail(x);submit.disabled=false}};
    };
  }
  async function peopleDirectory(){
    if(profile.role!=="admin")return setContent('<div class="panel-card error">غير مصرح لك بعرض دليل الأفراد.</div>');
    const [people,ds]=await Promise.all([rows("profiles","id,full_name,role,national_id,avatar_path,created_at"),rows("distributors","user_id,phone")]);
    const phoneByUser=Object.fromEntries(ds.map(d=>[d.user_id,d.phone||""]));
    const prepared=await Promise.all(people.map(async p=>({...p,avatarUrl:await signedAvatarUrl(p.avatar_path).catch(()=>""),phone:phoneByUser[p.id]||""})));
    const card=p=>'<article class="panel-card person-card"><div class="person-summary">'+(p.avatarUrl?'<img class="profile-photo" src="'+p.avatarUrl+'" alt="صورة '+esc(p.full_name)+'">':'<div class="profile-photo profile-photo-empty">👤</div>')+'<div><h3>'+esc(p.full_name||"بدون اسم")+'</h3><p class="muted">'+(p.role==="admin"?"أدمن":"موزع")+' · '+(p.phone?esc(p.phone):"لا يوجد هاتف")+'</p><p class="hint">معرّف الحساب: '+esc(p.id.slice(0,8))+'…</p></div><button class="secondary" data-person="'+p.id+'">عرض التفاصيل</button></div></article>';
    const bindDetails=()=>{$("people-list").querySelectorAll("[data-person]").forEach(btn=>btn.onclick=()=>{const p=prepared.find(x=>x.id===btn.dataset.person);$("person-details").innerHTML='<section class="panel-card person-details">'+(p.avatarUrl?'<img class="profile-photo" src="'+p.avatarUrl+'" alt="الصورة الشخصية">':'<div class="profile-photo profile-photo-empty">👤</div>')+'<h3>'+esc(p.full_name||"بدون اسم")+'</h3><p><b>نوع الحساب:</b> '+(p.role==="admin"?"أدمن":"موزع")+'</p><p><b>معرّف الحساب الكامل:</b> <code>'+esc(p.id)+'</code> <button class="secondary" id="copy-person-id">نسخ المعرّف</button></p><p><b>رقم البطاقة:</b> '+esc(p.national_id||"غير مسجل")+'</p><p><b>الهاتف:</b> '+esc(p.phone||"غير مسجل")+'</p><p><b>تاريخ إنشاء الحساب:</b> '+new Date(p.created_at).toLocaleString("ar-EG")+'</p><p><b>حالة الملف:</b> '+((p.avatar_path&&(p.full_name||"").trim().split(/\s+/).length>=3&&(p.role!=="distributor"||/^\d{14}$/.test(p.national_id||"")) )?"مكتمل":"غير مكتمل")+'</p></section>';$("copy-person-id").onclick=()=>navigator.clipboard?.writeText(p.id).then(()=>toast("تم نسخ معرّف الحساب")).catch(()=>toast("تعذر النسخ من هذا الجهاز"));});};
    const renderList=(term="",role="all")=>{const filtered=prepared.filter(p=>(role==="all"||p.role===role)&&[p.full_name,p.national_id,p.id,p.phone].some(v=>String(v||"").toLowerCase().includes(term.toLowerCase())));$("people-list").innerHTML=filtered.map(card).join("")||'<div class="panel-card empty">لا توجد نتائج مطابقة.</div>';bindDetails();};
    setContent(section("دليل الأفراد","")+'<div class="panel-card"><div class="form-grid"><label class="field">بحث بالاسم أو البطاقة أو المعرّف أو الهاتف<input id="people-search" type="search" placeholder="اكتب للبحث..."></label><label class="field">نوع الحساب<select id="people-role"><option value="all">كل الحسابات</option><option value="admin">الأدمنز</option><option value="distributor">الموزعون</option></select></label></div><p class="hint">إجمالي الحسابات: '+prepared.length+'</p></div><div id="people-list" class="people-list"></div><div id="person-details"></div>');
    const update=()=>renderList($("people-search").value,$("people-role").value);$("people-search").oninput=update;$("people-role").onchange=update;update();
  }
  async function inventory(){
    const [bs,ps,ds]=await Promise.all([rows("stock_balances","distributor_id,product_id,quantity,bag_counts"),rows("products"),profile.role==="admin"?rows("distributors"):Promise.resolve([distributor])]);
    const pn=Object.fromEntries(ps.map(p=>[p.id,p.name])),dn=Object.fromEntries(ds.map(d=>[d.id,d.name]));
    const body=bs.map(b=>`<tr><td>${esc(dn[b.distributor_id]||"")}</td><td>${esc(pn[b.product_id]||"")}</td><td>${qty(b.quantity)} كجم</td><td>${esc(bagsLabel(b.bag_counts))}</td></tr>`).join("");
    setContent(section(profile.role==="admin"?"مخزون الموزعين":"مخزوني",profile.role==="admin"?'<button id="receive-stock" class="primary">تسجيل استلام بضاعة</button>':'')+table(["الموزع","الصنف","إجمالي الوزن","توزيع الأكياس"],body));
    if(profile.role==="admin")$("content").querySelector("h2")?.insertAdjacentHTML("afterend",'<button id="adjust-stock" class="secondary">تصحيح رصيد المخزون (زيادة / خصم)</button>');
    if($("adjust-stock"))$("adjust-stock").onclick=async()=>{
      const [dlist,plist]=await Promise.all([rows("distributors"),rows("products")]);
      showForm(formPanel("adjust-form","تصحيح رصيد المخزون (زيادة / خصم)",selectField("الموزع","distributor_id",dlist.map(x=>({value:x.id,label:x.name})))+selectField("الصنف","product_id",plist.map(x=>({value:x.id,label:x.name})))+selectField("نوع التصحيح","direction",[{value:"out",label:"خصم أكياس من رصيد الموزع"},{value:"in",label:"إضافة أكياس إلى الرصيد"}])+bagFields("bags_")+field("سبب التسوية","notes")));
      const form=$("adjust-form");
      form.onsubmit=async e=>{e.preventDefault();const d=new FormData(form);const bags=readBags(form,"bags_");if(bagsKg(bags)<=0||Object.values(bags).some(n=>!Number.isInteger(n)||n<0))return toast("أدخل أعداد أكياس صحيحة");try{await rpc("admin_adjust_stock_bags",{p_distributor_id:d.get("distributor_id"),p_product_id:d.get("product_id"),p_bags:bags,p_direction:d.get("direction"),p_notes:d.get("notes")||null});toast("تم تسجيل حركة التسوية");render()}catch(x){fail(x)}};
    };
    if($("receive-stock"))$("receive-stock").onclick=async()=>{
      const [ds2,ps2]=await Promise.all([rows("distributors"),rows("products")]);
      showForm(formPanel("receive-form","تسجيل استلام بضاعة",selectField("اسم الصنف","product_id",ps2.map(x=>({value:x.id,label:x.name})))+selectField("الموزع","distributor_id",ds2.map(x=>({value:x.id,label:x.name})))+bagFields("bags_")+'<div class="field"><span>إجمالي الوزن</span><strong id="stock-total-kg">0.000 كجم</strong></div>'+field("ملاحظات","notes")));
      const form=$("receive-form");const update=()=>{const v=readBags(form,"bags_");const ok=Object.values(v).every(n=>Number.isInteger(n)&&n>=0);const kg=bagsKg(v);$("stock-total-kg").textContent=ok?kg.toFixed(3)+" كجم":"راجع الأعداد";return ok?kg:NaN};
      ["50","100","200","500","1000"].forEach(k=>form.elements["bags_"+k].addEventListener("input",update));
      form.onsubmit=async e=>{e.preventDefault();const f=new FormData(form);const kg=update();if(!Number.isFinite(kg)||kg<=0)return toast("أدخل أعداد أكياس صحيحة");try{await rpc("admin_receive_stock_bags",{p_distributor_id:f.get("distributor_id"),p_product_id:f.get("product_id"),p_bags:readBags(form,"bags_"),p_notes:f.get("notes")||null});toast("تم الاستلام: "+kg.toFixed(3)+" كجم");render()}catch(x){fail(x)}};
    };
  }
  async function cafes(){
    const cs=await rows("cafes");
    const body=cs.map(c=>"<tr><td>"+esc(c.name)+"</td><td>"+esc(c.contact_name||"-")+"</td><td>"+esc(c.phone||"-")+"</td><td>"+esc(c.status)+"</td><td>"+(profile.role==="admin"?"<button data-edit-cafe=\""+c.id+"\" class=\"secondary\">تعديل</button> <select data-cafe-status=\""+c.id+"\"><option value=\"prospect\">محتمل</option><option value=\"active\">نشط</option><option value=\"inactive\">أرشيف</option></select>":"")+"</td></tr>").join("");
    setContent(section("الكافيهات",'<button id="add-cafe" class="primary">إضافة كافيه</button>')+table(["الكافيه","المسؤول","الهاتف","الحالة","إدارة"],body));
    if(profile.role==="admin"){
      $("content").querySelectorAll("[data-cafe-status]").forEach(sel=>{const c=cs.find(x=>x.id===sel.dataset.cafeStatus);sel.value=c?.status||"active";sel.onchange=async()=>{try{const {error}=await sb.from("cafes").update({status:sel.value,active:sel.value!=="inactive"}).eq("id",c.id);if(error)throw error;toast("تم تحديث حالة الكافيه");render()}catch(x){fail(x)}}});
        $("content").querySelectorAll("[data-edit-cafe]").forEach(btn=>btn.insertAdjacentHTML("afterend",'<button data-delete-cafe="'+btn.dataset.editCafe+'" class="danger">حذف / أرشفة</button>'));
      $("content").querySelectorAll("[data-delete-cafe]").forEach(btn=>btn.onclick=async()=>{if(!confirm("حذف الكافيه إن لم يكن له سجل معاملات، وإلا سيتم أرشفته؟"))return;try{const result=await rpc("admin_delete_cafe",{p_cafe_id:btn.dataset.deleteCafe});toast(result==="deleted"?"تم حذف الكافيه":"للكافيه سجل سابق؛ تم أرشفته للحفاظ على التاريخ");render()}catch(x){fail(x)}});
    $("content").querySelectorAll("[data-edit-cafe]").forEach(btn=>btn.onclick=()=>{const c=cs.find(x=>x.id===btn.dataset.editCafe);showForm(formPanel("cafe-edit-form","تعديل بيانات الكافيه",field("اسم الكافيه","name")+field("اسم المسؤول","contact_name")+field("الهاتف","phone")+field("العنوان","address")+field("ملاحظات","notes")));const form=$("cafe-edit-form");for(const k of ["name","contact_name","phone","address","notes"])if(form.elements[k])form.elements[k].value=c[k]||"";form.onsubmit=async e=>{e.preventDefault();const d=new FormData(form);try{const {error}=await sb.from("cafes").update({name:d.get("name"),contact_name:d.get("contact_name"),phone:d.get("phone"),address:d.get("address"),notes:d.get("notes")}).eq("id",c.id);if(error)throw error;toast("تم تعديل بيانات الكافيه");render()}catch(x){fail(x)}}});
    }
    $("add-cafe").onclick=async()=>{const ds=profile.role==="admin"?await rows("distributors"):[];showForm(formPanel("cafe-form","كافيه جديد",(profile.role==="admin"?selectField("الموزع المسؤول","distributor_id",ds.map(x=>({value:x.id,label:x.name}))):"")+field("اسم الكافيه","name")+field("اسم المسؤول","contact_name")+field("الهاتف","phone")+field("العنوان","address")));$("cafe-form").onsubmit=async e=>{e.preventDefault();let d=new FormData(e.target);try{let p={name:d.get("name"),contact_name:d.get("contact_name"),phone:d.get("phone"),address:d.get("address"),distributor_id:distributor?.id||d.get("distributor_id")};let {error}=await sb.from("cafes").insert(p);if(error)throw error;toast("تمت إضافة الكافيه");render()}catch(x){fail(x)}}};
  }
  async function orders(){
    const [os,cs,ds]=await Promise.all([rows("orders"),rows("cafes"),profile.role==="admin"?rows("distributors"):Promise.resolve([distributor])]);
    const cn=Object.fromEntries(cs.map(c=>[c.id,c.name])),dn=Object.fromEntries(ds.map(d=>[d.id,d.name]));
    const body=os.map(o=>`<tr><td>#${o.order_number}</td><td>${esc(cn[o.cafe_id]||"")}</td><td>${esc(dn[o.distributor_id]||"")}</td><td>${esc(o.expected_delivery||"-")}</td><td><span class="pill">${esc(o.status)}</span>${o.status==="cancelled"?'<small class="muted">ملغاة</small>':""}</td><td>${o.status==="confirmed"||o.status==="preparing"?`<button class="primary" data-deliver="${o.id}">تأكيد التسليم</button> <button class="danger" data-cancel-order="${o.id}">إلغاء الطلبية</button>`:""}</td></tr>`).join("");
    setContent(section("الطلبيات",'<button id="new-order" class="primary">طلبية جديدة</button>')+table(["رقم","الكافيه","الموزع","موعد التسليم","الحالة","إجراء"],body));
    $("new-order").onclick=async()=>{const [cs2,ps2,ds2]=await Promise.all([rows("cafes"),rows("products"),profile.role==="admin"?rows("distributors"):Promise.resolve([distributor])]);showForm(formPanel("order-form","طلبية جديدة",selectField("الكافيه","cafe_id",cs2.map(x=>({value:x.id,label:x.name})))+(profile.role==="admin"?selectField("الموزع","distributor_id",ds2.map(x=>({value:x.id,label:x.name}))):"")+field("موعد التسليم","expected_delivery","date")+selectField("المنتج","product_id",ps2.map(x=>({value:x.id,label:x.name})))+bagFields("bags_")+'<div class="field"><span>إجمالي الوزن</span><strong id="order-total-kg">0.000 كجم</strong></div>'+field("ملاحظات","notes")));
      const form=$("order-form");const update=()=>{const v=readBags(form,"bags_");const ok=Object.values(v).every(n=>Number.isInteger(n)&&n>=0);const kg=bagsKg(v);$("order-total-kg").textContent=ok?kg.toFixed(3)+" كجم":"راجع الأعداد";return ok?kg:NaN};["50","100","200","500","1000"].forEach(k=>form.elements["bags_"+k].addEventListener("input",update));
      form.onsubmit=async e=>{e.preventDefault();const f=new FormData(form);const kg=update();if(!Number.isFinite(kg)||kg<=0)return toast("أدخل أعداد أكياس صحيحة");try{await rpc("create_distributor_order_bags",{p_cafe_id:f.get("cafe_id"),p_distributor_id:distributor?.id||f.get("distributor_id"),p_product_id:f.get("product_id"),p_bags:readBags(form,"bags_"),p_expected_delivery:f.get("expected_delivery")||null,p_notes:f.get("notes")||null});toast("تم إنشاء الطلبية · "+kg.toFixed(3)+" كجم");render()}catch(x){fail(x)}}};
    $("content").querySelectorAll("[data-deliver]").forEach(b=>b.onclick=async()=>{if(!confirm("تأكيد تسليم الطلبية وخصمها من المخزون؟"))return;try{await rpc("deliver_order",{p_order_id:b.dataset.deliver});toast("تم التسليم وإنشاء الفاتورة");render()}catch(x){fail(x)}});
    $("content").querySelectorAll("[data-cancel-order]").forEach(b=>b.onclick=async()=>{
      const reason=prompt("سبب إلغاء الطلبية (اختياري):")||null;
      if(!confirm("إلغاء الطلبية نهائيًا؟ لن يمكن تسليمها بعد الإلغاء."))return;
      b.disabled=true;
      try{await rpc("cancel_undelivered_order",{p_order_id:b.dataset.cancelOrder,p_reason:reason});toast("تم إلغاء الطلبية بنجاح");render()}
      catch(x){b.disabled=false;fail(x)}
    });
  }
  async function samples(){
    const [ss,cs,ps]=await Promise.all([rows("samples"),rows("cafes"),rows("products")]);
    const cn=Object.fromEntries(cs.map(x=>[x.id,x.name]));
    const body=ss.map(s=>`<tr><td>${esc(cn[s.cafe_id]||"")}</td><td>${esc(s.sample_date)}</td><td>${esc(s.feedback||"-")}</td></tr>`).join("");
    setContent(section("العينات",'<button id="new-sample" class="primary">تسجيل عينة</button>')+table(["الكافيه","التاريخ","التقييم"],body));
    $("new-sample").onclick=()=>{showForm(formPanel("sample-form","تسجيل عينة",selectField("الكافيه","cafe_id",cs.map(x=>({value:x.id,label:x.name})))+selectField("الصنف","product_id",ps.map(x=>({value:x.id,label:x.name})))+bagFields("bags_")+'<div class="field"><span>إجمالي الوزن</span><strong id="sample-total-kg">0.000 كجم</strong></div>'+field("ملاحظات / Feedback","feedback")));
      const form=$("sample-form");const update=()=>{const v=readBags(form,"bags_");const ok=Object.values(v).every(n=>Number.isInteger(n)&&n>=0);const kg=bagsKg(v);$("sample-total-kg").textContent=ok?kg.toFixed(3)+" كجم":"راجع الأعداد";return ok?kg:NaN};["50","100","200","500","1000"].forEach(k=>form.elements["bags_"+k].addEventListener("input",update));
      form.onsubmit=async e=>{e.preventDefault();const f=new FormData(form);const kg=update();if(!Number.isFinite(kg)||kg<=0)return toast("أدخل أعداد أكياس صحيحة");try{await rpc("record_sample_bags",{p_cafe_id:f.get("cafe_id"),p_product_id:f.get("product_id"),p_bags:readBags(form,"bags_"),p_feedback:f.get("feedback")||null});toast("تم تسجيل العينة وخصم "+kg.toFixed(3)+" كجم");render()}catch(x){fail(x)}}};
  }
  async function returnsPage(){
    const [rs,refunds,items,inv,ds,ps,qmov]=await Promise.all([
      rows("sales_returns"),rows("sales_return_refunds"),rows("sales_return_items"),
      rows("sales_invoices"),profile.role==="admin"?rows("distributors"):Promise.resolve([distributor]),rows("products"),rows("return_quarantine_movements")
    ]);
    const dn=Object.fromEntries(ds.map(x=>[x.id,x.name])),pn=Object.fromEntries(ps.map(x=>[x.id,x.name]));
    const refundByReturn=Object.fromEntries(refunds.map(x=>[x.return_id,x]));
    const remainingKg=(item)=>{const ms=qmov.filter(m=>m.return_item_id===item.id);const received=ms.filter(m=>m.movement_type==="received").reduce((a,m)=>a+Number(m.quantity),0);const done=ms.filter(m=>["released_to_company","released_to_distributor","damaged"].includes(m.movement_type)).reduce((a,m)=>a+Number(m.quantity),0);return Math.max(0,received-done)};
    const remainingBags=(item)=>{const ms=qmov.filter(m=>m.return_item_id===item.id),keys=["50","100","200","500","1000"],out={};keys.forEach(k=>{const got=ms.filter(m=>m.movement_type==="received").reduce((a,m)=>a+Number(m.bag_counts?.[k]||0),0),used=ms.filter(m=>["released_to_company","released_to_distributor","damaged"].includes(m.movement_type)).reduce((a,m)=>a+Number(m.bag_counts?.[k]||0),0);out[k]=Math.max(0,got-used)});return out};

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
        try{
          const lines=await rows("sales_invoice_items");
          const selected=lines.filter(x=>x.invoice_id===e.target.value);
          $("return-lines").innerHTML=selected.map(x=>x.bag_counts
            ? `<div class="field"><strong>${esc(pn[x.product_id]||"صنف")} · مباع ${qty(x.quantity)} كجم</strong><div class="form-grid">${bagFields("return_"+x.id+"_")}</div><small>أدخل أعداد الأكياس المرتجعة بكل مقاس.</small></div>`
            : `<label class="field">${esc(pn[x.product_id]||"صنف")} · مباع ${qty(x.quantity)} كجم<input type="number" min="0" max="${x.quantity}" step="0.001" name="return_qty_${x.id}" placeholder="كمية المرتجع بالكجم"></label>`
          ).join("");
          form.dataset.lineIds=selected.map(x=>x.id).join(",");
          form.dataset.bagLineIds=selected.filter(x=>x.bag_counts).map(x=>x.id).join(",");
        }catch(x){fail(x)}
      };
      form.onsubmit=async e=>{
        e.preventDefault();const fd=new FormData(form);
        const ids=(form.dataset.lineIds||"").split(",").filter(Boolean);
        const bagIds=new Set((form.dataset.bagLineIds||"").split(",").filter(Boolean));
        const payload=ids.map(id=>bagIds.has(id)
          ? {invoice_item_id:id,bag_counts:readBags(form,"return_"+id+"_")}
          : {invoice_item_id:id,quantity:Number(fd.get("return_qty_"+id)||0)}
        ).filter(x=>x.bag_counts?bagsKg(x.bag_counts)>0:x.quantity>0);
        if(!payload.length)return toast("حدد كمية مرتجعة واحدة على الأقل");
        try{await rpc("record_sales_return",{p_invoice_id:fd.get("invoice_id"),p_items:payload,p_reason:fd.get("reason")||null,p_notes:fd.get("notes")||null});toast(profile.role==="admin"?"تم تسجيل المرتجع":"تم تسجيل المرتجع وإرساله للإدارة لتخصيص رد المبلغ");render()}catch(x){fail(x)}
      };
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
        (item.bag_counts
          ? bagFields("settle_")+'<p class="hint">التسوية تتم بأعداد الأكياس حسب المقاس، وليس بالوزن التقريبي.</p>'
          : field("الكمية المتبقية للتسوية (كجم)","quantity","number",`min="0.001" max="${remainingKg(item)}" step="0.001" value="${remainingKg(item)}" required`)+
            '<p class="hint">الكمية المتاحة في هذا البند: '+qty(item.quantity)+' كجم</p>')
      ,"تأكيد التسوية"));
      const form=$("return-settlement-form");
      if(item.bag_counts){const left=remainingBags(item);["50","100","200","500","1000"].forEach(k=>{form.elements["settle_"+k].value=left[k]})}
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
        e.preventDefault();const fd=new FormData(form);
        const bags=item.bag_counts?readBags(form,"settle_"):null;
        const amount=bags?bagsKg(bags):Number(fd.get("quantity"));
        if(!Number.isFinite(amount)||amount<=0||amount>remainingKg(item)|| (bags&&(Object.values(bags).some(n=>!Number.isInteger(n)||n<0)||["50","100","200","500","1000"].some(k=>bags[k]>remainingBags(item)[k]))))return toast("أدخل أعدادًا لا تتجاوز المتبقي في العزل لكل مقاس");
        const disposition=fd.get("disposition");
        const destination=disposition==="released_to_distributor"?fd.get("destination_distributor_id"):null;
        if(disposition==="released_to_distributor"&&!destination)return toast("اختر الموزع المستلم");
        const submit=form.querySelector('button[type="submit"],button:not([type])');
        if(submit){submit.disabled=true;submit.textContent="جارٍ تنفيذ التسوية...";}
        try{
          if(bags) await rpc("process_return_quarantine_bags",{p_return_item_id:id,p_bags:bags,p_disposition:disposition,p_destination_distributor_id:destination,p_notes:null});
          else await rpc("process_return_quarantine",{p_return_item_id:id,p_quantity:amount,p_disposition:disposition,p_destination_distributor_id:destination,p_notes:null});
          toast("تمت تسوية كمية المرتجع");render();
        }catch(x){if(submit){submit.disabled=false;submit.textContent="تأكيد التسوية";}fail(x)}
      };
    });
  }
  async function finance(){
    const [inv,pay,rem,cs,ds,ps,lines,rsFinance,returnLinesFinance,refundRecords]=await Promise.all([rows("sales_invoices"),rows("cafe_payments"),profile.role==="admin"?rows("distributor_remittances"):Promise.resolve([]),rows("cafes"),rows("distributors"),rows("products"),rows("sales_invoice_items"),rows("sales_returns"),rows("sales_return_items"),profile.role==="admin"?rows("sales_return_refunds"):Promise.resolve([])]);
    const returnTotals=Object.fromEntries(rsFinance.map(r=>[r.id,returnLinesFinance.filter(x=>x.return_id===r.id).reduce((a,x)=>a+Number(x.refund_amount||0),0)]));
    const sales=inv.reduce((a,x)=>a+Number(x.total_amount),0),paid=pay.reduce((a,x)=>a+Number(x.amount),0);
    const grossRemitted=rem.reduce((a,x)=>a+Number(x.amount),0);
    const companyRefundOutflow=refundRecords.filter(x=>x.funded_at).reduce((a,x)=>a+Number(x.company_funded_amount||0),0);
    const netCompanyRemittances=grossRemitted-companyRefundOutflow;
    const cn=Object.fromEntries(cs.map(x=>[x.id,x])),dn=Object.fromEntries(ds.map(x=>[x.id,x.name])),pn=Object.fromEntries(ps.map(x=>[x.id,x.name]));
    setContent('<div class="cards"><div class="stat"><span>إجمالي فواتير البيع</span><strong>'+money(sales)+'</strong></div><div class="stat"><span>تحصيلات الكافيهات</span><strong>'+money(paid)+'</strong></div><div class="stat"><span>عدد الفواتير</span><strong>'+inv.length+'</strong></div><div class="stat"><span>توريدات الشركة الإجمالية</span><strong>'+money(grossRemitted)+'</strong></div><div class="stat"><span>تمويل رد المرتجعات</span><strong>'+money(companyRefundOutflow)+'</strong></div><div class="stat"><span>صافي توريدات الشركة بعد المرتجعات</span><strong>'+money(netCompanyRemittances)+'</strong></div></div>'+
      section("فواتير البيع",'<button id="add-payment" class="primary">تسجيل تحصيل كافيه</button>')+
      table(["رقم الفاتورة","الكافيه","الإجمالي","عمولة الموزع","صافي الشركة","التاريخ","PDF"],inv.map(i=>'<tr><td>#'+i.invoice_number+'</td><td>'+esc(cn[i.cafe_id]?.name||"-")+'</td><td>'+money(i.total_amount)+'</td><td>'+money(i.total_commission)+'</td><td>'+money(i.company_net)+'</td><td>'+new Date(i.invoice_date).toLocaleDateString("ar-EG")+'</td><td><button class="secondary" data-print-invoice="'+i.id+'">تحميل PDF</button></td></tr>').join(""))+
      section("فواتير المرتجعات","")+
      table(["رقم المرتجع","الكافيه","قيمة الاسترداد","التاريخ","PDF"],rsFinance.map(r=>'<tr><td>#'+r.return_number+'</td><td>'+esc(cn[r.cafe_id]?.name||"-")+'</td><td>'+money(returnTotals[r.id]||0)+'</td><td>'+new Date(r.return_date).toLocaleDateString("ar-EG")+'</td><td><button class="secondary" data-print-return="'+r.id+'">تحميل PDF</button></td></tr>').join("")));
    $("add-payment").onclick=async()=>{const cafes=await rows("cafes");showForm(formPanel("payment-form","تسجيل تحصيل",selectField("الكافيه","cafe_id",cafes.map(x=>({value:x.id,label:x.name})))+field("المبلغ","amount","number",'min="0.01" step="0.01"')+selectField("طريقة الدفع","payment_method",["cash","instapay","bank_transfer","other"].map(x=>({value:x,label:x})))+selectField("تم التحصيل بواسطة","received_by",profile.role==="admin"?[{value:"distributor",label:"الموزع"},{value:"company",label:"الشركة"}]:[{value:"distributor",label:"الموزع"}])));$("payment-form").onsubmit=async e=>{e.preventDefault();let f=new FormData(e.target);try{await rpc("record_cafe_payment",{p_cafe_id:f.get("cafe_id"),p_amount:Number(f.get("amount")),p_payment_method:f.get("payment_method"),p_received_by:f.get("received_by")});toast("تم تسجيل التحصيل");render()}catch(x){fail(x)}}};
    const downloadInvoicePdf=async(html,filename)=>{
      const buttons=[...$("content").querySelectorAll("[data-print-invoice],[data-print-return]")];
      buttons.forEach(b=>b.disabled=true);
      let host;
      try{
        if(window.Capacitor?.isNativePlatform?.()){
          const nativePdf=window.APP_INVOICE_PDF||window.Capacitor?.Plugins?.InvoicePdf;
          if(!nativePdf?.print)throw new Error("مكوّن الطباعة الأصلي غير متاح. أعد تثبيت النسخة الأحدث من التطبيق.");
          await nativePdf.print({html,filename});
          toast("تم فتح نافذة طباعة أندرويد. اختر Save as PDF ثم احفظ الفاتورة.");
          return;
        }
        if(typeof html2pdf!=="function")throw new Error("مكتبة إنشاء PDF لم يتم تحميلها. تحقق من اتصال الإنترنت ثم أعد المحاولة.");
        host=document.createElement("div");host.id="pdf-render-host";host.innerHTML=html;
        host.style.cssText="position:fixed;left:0;top:0;width:780px;background:#fff;z-index:99999;opacity:1;pointer-events:none";
        document.body.appendChild(host);
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        if(document.fonts?.ready)await document.fonts.ready;
        await Promise.all([...host.querySelectorAll("img")].map(img=>{
          if(img.complete)return Promise.resolve();
          return new Promise(resolve=>{img.onload=img.onerror=resolve;});
        }));
        const worker=html2pdf().set({filename,margin:8,image:{type:"jpeg",quality:.98},html2canvas:{
          scale:2,useCORS:true,allowTaint:false,backgroundColor:"#ffffff",logging:false,windowWidth:900,
          onclone:clonedDoc=>{
            const clonedHost=clonedDoc.querySelector("#pdf-render-host");
            const clonedInvoice=clonedHost?.firstElementChild;
            if(clonedHost)clonedHost.style.cssText="position:fixed;left:0;top:0;width:780px;background:#fff;z-index:99999;opacity:1;visibility:visible";
            if(clonedInvoice)clonedInvoice.style.cssText+=";display:block;visibility:visible;opacity:1;background:#fff;color:#222";
          }
        },jsPDF:{unit:"mm",format:"a4",orientation:"portrait"}}).from(host.firstElementChild).toCanvas();
        const canvas=await worker.get("canvas");
        if(!canvas||!canvas.width||!canvas.height)throw new Error("تعذر رسم الفاتورة إلى صورة. لم يتم إنشاء PDF.");
        const ctx=canvas.getContext("2d",{willReadFrequently:true});
        if(!ctx)throw new Error("تعذر فحص صورة الفاتورة قبل إنشاء PDF.");
        const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
        const stride=Math.max(4,Math.floor((canvas.width*canvas.height)/12000)*4);
        let visiblePixels=0;
        for(let p=0;p<pixels.length;p+=stride){
          if(pixels[p]<245||pixels[p+1]<245||pixels[p+2]<245){visiblePixels++;if(visiblePixels>=8)break;}
        }
        if(visiblePixels<8)throw new Error("مرحلة تحويل الفاتورة إلى صورة أنتجت صفحة بيضاء. أوقفنا إنشاء PDF حتى لا نحفظ فاتورة فارغة.");
        await worker.toPdf();
        const pdf=await worker.get("pdf");
        if(!pdf||pdf.getNumberOfPages()<1)throw new Error("ملف PDF الناتج فارغ.");
        if(window.Capacitor?.isNativePlatform?.()){
          await window.APP_PDF_READY;
          if(!window.APP_FILESYSTEM?.writeFile)throw new Error("إضافة حفظ الملفات غير جاهزة. أغلق التطبيق وافتحه مجدداً.");
          const uri=pdf.output("datauristring"),base64=uri.substring(uri.indexOf(",")+1);
          if(!base64)throw new Error("تعذر تجهيز بيانات ملف PDF.");
          const saved=await window.APP_FILESYSTEM.writeFile({path:"ELHELW-COFFEE/"+filename,data:base64,directory:window.APP_FILESYSTEM_DIRECTORY.Cache,recursive:true});
          if(window.APP_SHARE?.share){
            await window.APP_SHARE.share({title:filename,text:"فاتورة بن الحلو - اختر تطبيق الملفات لحفظ نسخة على الجهاز",url:saved.uri,dialogTitle:"حفظ أو مشاركة الفاتورة"});
            toast("تم تجهيز الفاتورة. اختر تطبيق الملفات لحفظها على الجهاز.");
          }else{
            throw new Error("تم إنشاء الفاتورة داخل التطبيق لكن قائمة المشاركة غير متاحة. حدّث التطبيق ثم أعد المحاولة.");
          }
        }else{
          const blob=pdf.output("blob");
          if(!blob||blob.size<100)throw new Error("ملف PDF الناتج غير صالح.");
          const url=URL.createObjectURL(blob),a=document.createElement("a");
          a.href=url;a.download=filename;a.target="_blank";a.rel="noopener";
          document.body.appendChild(a);a.click();a.remove();
          setTimeout(()=>URL.revokeObjectURL(url),60000);
          toast("تم تجهيز تنزيل ملف PDF");
        }
      }catch(err){console.error("Invoice PDF error:",err);toast("فشل تحميل PDF: "+(err?.message||"خطأ غير معروف"))}
      finally{host?.remove();buttons.forEach(b=>b.disabled=false)}
    };
    $("content").querySelectorAll("[data-print-invoice]").forEach(btn=>btn.onclick=async()=>{const i=inv.find(x=>x.id===btn.dataset.printInvoice),cafe=cn[i.cafe_id]||{},detail=lines.filter(x=>x.invoice_id===i.id);
      const itemRows=detail.map(x=>'<tr><td>'+esc(pn[x.product_id]||"-")+'</td><td>'+(x.bag_counts?esc(bagsLabel(x.bag_counts)):"تفاصيل الأكياس غير متاحة")+'</td><td>'+qty(x.quantity)+' كجم</td><td>'+money(x.unit_price)+'</td><td>'+money(x.line_total)+'</td><td>'+money(x.commission_amount)+'</td><td>'+money(x.company_net)+'</td></tr>').join("");
      const html='<div dir="rtl" style="font-family:Arial,sans-serif;color:#222;background:#fff;padding:24px;width:740px"><div style="text-align:center;margin-bottom:18px"><img src="data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20906%20669%22%3E%3Cpath%20fill%3D%22%23F9A51A%22%20fill-rule%3D%22evenodd%22%20d%3D%22M636%2C176%20L626%2C180%20L617%2C188%20L612%2C198%20L611%2C212%20L615%2C223%20L622%2C231%20L628%2C235%20L634%2C237%20L648%2C238%20L658%2C235%20L669%2C226%20L674%2C216%20L675%2C202%20L671%2C191%20L663%2C182%20L650%2C176ZM475%2C44%20L463%2C49%20L453%2C60%20L450%2C68%20L450%2C82%20L455%2C93%20L465%2C102%20L477%2C106%20L487%2C106%20L500%2C101%20L508%2C93%20L513%2C83%20L514%2C72%20L512%2C64%20L509%2C58%20L503%2C51%20L492%2C45ZM365%2C24%20L365%2C208%20L366%2C209%20L366%2C216%20L367%2C217%20L368%2C227%20L372%2C239%20L380%2C254%20L392%2C266%20L406%2C274%20L427%2C280%20L453%2C281%20L454%2C282%20L528%2C281%20L529%2C280%20L541%2C279%20L554%2C275%20L572%2C265%20L581%2C256%20L589%2C243%20L596%2C220%20L597%2C205%20L598%2C204%20L598%2C165%20L602%2C160%20L670%2C160%20L676%2C157%20L678%2C153%20L678%2C25%20L677%2C23%20L673%2C20%20L617%2C20%20L612%2C24%20L612%2C55%20L617%2C60%20L635%2C60%20L636%2C61%20L636%2C115%20L632%2C119%20L603%2C119%20L599%2C116%20L598%2C111%20L598%2C26%20L592%2C20%20L563%2C20%20L557%2C25%20L557%2C34%20L556%2C35%20L556%2C170%20L557%2C171%20L557%2C197%20L556%2C198%20L556%2C210%20L550%2C223%20L539%2C234%20L522%2C241%20L508%2C241%20L507%2C242%20L453%2C241%20L433%2C236%20L423%2C231%20L415%2C223%20L411%2C216%20L407%2C204%20L407%2C197%20L406%2C196%20L406%2C27%20L400%2C20%20L369%2C20ZM903%2C22%20L896%2C17%20L862%2C17%20L859%2C18%20L855%2C22%20L853%2C27%20L853%2C146%20L829%2C163%20L826%2C162%20L803%2C146%20L803%2C26%20L802%2C23%20L795%2C17%20L760%2C17%20L756%2C19%20L752%2C25%20L752%2C170%20L753%2C173%20L756%2C176%20L781%2C194%20L756%2C211%20L752%2C216%20L752%2C443%20L754%2C446%20L781%2C466%20L778%2C470%20L766%2C478%20L700%2C478%20L699%2C477%20L699%2C381%20L698%2C380%20L697%2C365%20L693%2C352%20L685%2C337%20L678%2C329%20L664%2C320%20L651%2C316%20L393%2C316%20L392%2C317%20L381%2C318%20L366%2C324%20L360%2C328%20L349%2C340%20L344%2C350%20L344%2C353%20L341%2C360%20L340%2C373%20L339%2C374%20L339%2C393%20L341%2C393%20L341%2C386%20L346%2C377%20L350%2C373%20L359%2C368%20L627%2C368%20L636%2C373%20L640%2C377%20L645%2C387%20L645%2C460%20L643%2C465%20L636%2C473%20L627%2C478%20L287%2C478%20L284%2C475%20L284%2C28%20L281%2C22%20L275%2C18%20L242%2C18%20L239%2C19%20L234%2C24%20L232%2C30%20L232%2C89%20L233%2C90%20L233%2C473%20L232%2C476%20L229%2C478%20L160%2C478%20L159%2C477%20L159%2C344%20L158%2C343%20L158%2C332%20L154%2C318%20L151%2C312%20L144%2C304%20L136%2C299%20L126%2C296%20L38%2C296%20L23%2C300%20L13%2C306%20L8%2C311%20L3%2C320%20L0%2C334%20L0%2C492%20L1%2C493%20L2%2C504%20L7%2C515%20L18%2C525%20L35%2C530%20L107%2C530%20L108%2C531%20L108%2C596%20L111%2C606%20L118%2C618%20L128%2C627%20L135%2C631%20L144%2C634%20L158%2C635%20L158%2C531%20L159%2C530%20L779%2C530%20L787%2C527%20L824%2C500%20L828%2C499%20L849%2C514%20L854%2C516%20L854%2C572%20L857%2C585%20L862%2C595%20L873%2C606%20L884%2C612%20L894%2C615%20L904%2C615%20L904%2C492%20L903%2C489%20L873%2C466%20L902%2C445%20L904%2C441%20L904%2C221%20L899%2C210%20L876%2C195%20L879%2C191%20L901%2C176%20L904%2C171%20L904%2C24ZM69%2C347%20L92%2C347%20L103%2C355%20L107%2C363%20L108%2C368%20L108%2C478%20L107%2C479%20L52%2C479%20L51%2C478%20L51%2C367%20L53%2C360%20L56%2C355%20L62%2C350ZM827%2C225%20L829%2C225%20L853%2C242%20L853%2C416%20L829%2C434%20L826%2C434%20L806%2C419%20L803%2C418%20L803%2C242Z%22%2F%3E%3C%2Fsvg%3E" style="max-width:240px;max-height:110px;object-fit:contain"><h2 style="color:#603b24">فاتورة مبيعات</h2></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:18px 0;padding:14px;background:#f7f3ef"><div><b>رقم الفاتورة:</b> #'+i.invoice_number+'</div><div><b>التاريخ:</b> '+new Date(i.invoice_date).toLocaleString("ar-EG")+'</div><div><b>الكافيه:</b> '+esc(cafe.name||"-")+'</div><div><b>رقم الكافيه:</b> '+esc(cafe.phone||"-")+'</div><div><b>العنوان:</b> '+esc(cafe.address||"-")+'</div><div><b>الموزع:</b> '+esc(dn[i.distributor_id]||"-")+'</div></div><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr><th>الصنف</th><th>الأكياس</th><th>الوزن</th><th>سعر الكيلو</th><th>الإجمالي</th><th>العمولة</th><th>صافي الشركة</th></tr></thead><tbody>'+itemRows+'</tbody></table><div style="margin-top:18px;width:300px;margin-right:auto"><div>إجمالي الفاتورة: '+money(i.total_amount)+'</div><div>عمولة الموزع: '+money(i.total_commission)+'</div><div>صافي الشركة: '+money(i.company_net)+'</div></div><p style="text-align:center;margin-top:35px">شكراً لثقتكم في بن الحلو</p></div>';
      await downloadInvoicePdf(html,"ELHELW-SALES-INVOICE-"+i.invoice_number+".pdf");
    });
    $("content").querySelectorAll("[data-print-return]").forEach(btn=>btn.onclick=async()=>{
      const r=rsFinance.find(x=>x.id===btn.dataset.printReturn),cafe=cn[r.cafe_id]||{},detail=returnLinesFinance.filter(x=>x.return_id===r.id);
      const trs=detail.map(x=>'<tr><td>'+esc(pn[x.product_id]||"-")+'</td><td>'+(x.bag_counts?esc(bagsLabel(x.bag_counts)):"تفاصيل الأكياس غير متاحة")+'</td><td>'+qty(x.quantity)+' كجم</td><td>'+money(x.refund_amount)+'</td></tr>').join("");
      const html='<div dir="rtl" style="font-family:Arial,sans-serif;color:#222;background:#fff;padding:24px;width:740px"><div style="text-align:center;margin-bottom:18px"><img src="data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20906%20669%22%3E%3Cpath%20fill%3D%22%23F9A51A%22%20fill-rule%3D%22evenodd%22%20d%3D%22M636%2C176%20L626%2C180%20L617%2C188%20L612%2C198%20L611%2C212%20L615%2C223%20L622%2C231%20L628%2C235%20L634%2C237%20L648%2C238%20L658%2C235%20L669%2C226%20L674%2C216%20L675%2C202%20L671%2C191%20L663%2C182%20L650%2C176ZM475%2C44%20L463%2C49%20L453%2C60%20L450%2C68%20L450%2C82%20L455%2C93%20L465%2C102%20L477%2C106%20L487%2C106%20L500%2C101%20L508%2C93%20L513%2C83%20L514%2C72%20L512%2C64%20L509%2C58%20L503%2C51%20L492%2C45ZM365%2C24%20L365%2C208%20L366%2C209%20L366%2C216%20L367%2C217%20L368%2C227%20L372%2C239%20L380%2C254%20L392%2C266%20L406%2C274%20L427%2C280%20L453%2C281%20L454%2C282%20L528%2C281%20L529%2C280%20L541%2C279%20L554%2C275%20L572%2C265%20L581%2C256%20L589%2C243%20L596%2C220%20L597%2C205%20L598%2C204%20L598%2C165%20L602%2C160%20L670%2C160%20L676%2C157%20L678%2C153%20L678%2C25%20L677%2C23%20L673%2C20%20L617%2C20%20L612%2C24%20L612%2C55%20L617%2C60%20L635%2C60%20L636%2C61%20L636%2C115%20L632%2C119%20L603%2C119%20L599%2C116%20L598%2C111%20L598%2C26%20L592%2C20%20L563%2C20%20L557%2C25%20L557%2C34%20L556%2C35%20L556%2C170%20L557%2C171%20L557%2C197%20L556%2C198%20L556%2C210%20L550%2C223%20L539%2C234%20L522%2C241%20L508%2C241%20L507%2C242%20L453%2C241%20L433%2C236%20L423%2C231%20L415%2C223%20L411%2C216%20L407%2C204%20L407%2C197%20L406%2C196%20L406%2C27%20L400%2C20%20L369%2C20ZM903%2C22%20L896%2C17%20L862%2C17%20L859%2C18%20L855%2C22%20L853%2C27%20L853%2C146%20L829%2C163%20L826%2C162%20L803%2C146%20L803%2C26%20L802%2C23%20L795%2C17%20L760%2C17%20L756%2C19%20L752%2C25%20L752%2C170%20L753%2C173%20L756%2C176%20L781%2C194%20L756%2C211%20L752%2C216%20L752%2C443%20L754%2C446%20L781%2C466%20L778%2C470%20L766%2C478%20L700%2C478%20L699%2C477%20L699%2C381%20L698%2C380%20L697%2C365%20L693%2C352%20L685%2C337%20L678%2C329%20L664%2C320%20L651%2C316%20L393%2C316%20L392%2C317%20L381%2C318%20L366%2C324%20L360%2C328%20L349%2C340%20L344%2C350%20L344%2C353%20L341%2C360%20L340%2C373%20L339%2C374%20L339%2C393%20L341%2C393%20L341%2C386%20L346%2C377%20L350%2C373%20L359%2C368%20L627%2C368%20L636%2C373%20L640%2C377%20L645%2C387%20L645%2C460%20L643%2C465%20L636%2C473%20L627%2C478%20L287%2C478%20L284%2C475%20L284%2C28%20L281%2C22%20L275%2C18%20L242%2C18%20L239%2C19%20L234%2C24%20L232%2C30%20L232%2C89%20L233%2C90%20L233%2C473%20L232%2C476%20L229%2C478%20L160%2C478%20L159%2C477%20L159%2C344%20L158%2C343%20L158%2C332%20L154%2C318%20L151%2C312%20L144%2C304%20L136%2C299%20L126%2C296%20L38%2C296%20L23%2C300%20L13%2C306%20L8%2C311%20L3%2C320%20L0%2C334%20L0%2C492%20L1%2C493%20L2%2C504%20L7%2C515%20L18%2C525%20L35%2C530%20L107%2C530%20L108%2C531%20L108%2C596%20L111%2C606%20L118%2C618%20L128%2C627%20L135%2C631%20L144%2C634%20L158%2C635%20L158%2C531%20L159%2C530%20L779%2C530%20L787%2C527%20L824%2C500%20L828%2C499%20L849%2C514%20L854%2C516%20L854%2C572%20L857%2C585%20L862%2C595%20L873%2C606%20L884%2C612%20L894%2C615%20L904%2C615%20L904%2C492%20L903%2C489%20L873%2C466%20L902%2C445%20L904%2C441%20L904%2C221%20L899%2C210%20L876%2C195%20L879%2C191%20L901%2C176%20L904%2C171%20L904%2C24ZM69%2C347%20L92%2C347%20L103%2C355%20L107%2C363%20L108%2C368%20L108%2C478%20L107%2C479%20L52%2C479%20L51%2C478%20L51%2C367%20L53%2C360%20L56%2C355%20L62%2C350ZM827%2C225%20L829%2C225%20L853%2C242%20L853%2C416%20L829%2C434%20L826%2C434%20L806%2C419%20L803%2C418%20L803%2C242Z%22%2F%3E%3C%2Fsvg%3E" style="max-width:240px;max-height:110px;object-fit:contain"><h2 style="color:#603b24">فاتورة مرتجع</h2></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:14px;background:#f7f3ef"><div><b>رقم المرتجع:</b> #'+r.return_number+'</div><div><b>التاريخ:</b> '+new Date(r.return_date).toLocaleString("ar-EG")+'</div><div><b>الكافيه:</b> '+esc(cafe.name||"-")+'</div><div><b>الهاتف:</b> '+esc(cafe.phone||"-")+'</div><div><b>العنوان:</b> '+esc(cafe.address||"-")+'</div><div><b>الموزع:</b> '+esc(dn[r.distributor_id]||"-")+'</div><div><b>السبب:</b> '+esc(r.reason||"-")+'</div></div><table style="width:100%;border-collapse:collapse;margin-top:18px;font-size:12px"><thead><tr><th>الصنف</th><th>الأكياس</th><th>الوزن</th><th>قيمة الاسترداد</th></tr></thead><tbody>'+trs+'</tbody></table><h3 style="text-align:left">إجمالي الاسترداد: '+money(returnTotals[r.id]||0)+'</h3></div>';
      await downloadInvoicePdf(html,"ELHELW-RETURN-INVOICE-"+r.return_number+".pdf");
    });
    if(profile.role==="admin"){
      $("content").insertAdjacentHTML("afterbegin",'<div class="panel-card"><h3>تسجيل توريد من الموزع للشركة</h3><form id="remit-form" class="form-grid">'+selectField("الموزع","distributor_id",ds.map(x=>({value:x.id,label:x.name})))+field("المبلغ","amount","number",'min="0.01" step="0.01" required')+selectField("طريقة الدفع","payment_method",[{value:"cash",label:"نقدي"},{value:"instapay",label:"InstaPay"},{value:"bank_transfer",label:"تحويل بنكي"}])+field("رقم مرجعي","reference")+'</form><button id="save-remit" class="primary">حفظ التوريد</button></div>');
      $("save-remit").onclick=async()=>{const f=new FormData($("remit-form"));try{await rpc("record_distributor_remittance",{p_distributor_id:f.get("distributor_id"),p_amount:Number(f.get("amount")),p_payment_method:f.get("payment_method"),p_reference:f.get("reference")||null,p_notes:null});toast("تم تسجيل التوريد");render()}catch(x){fail(x)}};
    }else{
      $("content").insertAdjacentHTML("afterbegin",'<div class="panel-card"><h3>تسليم تحصيلات الشركة</h3><form id="remit-form" class="form-grid">'+field("المبلغ","amount","number",'min="0.01" step="0.01" required')+selectField("طريقة الدفع","payment_method",[{value:"cash",label:"نقدي"},{value:"instapay",label:"InstaPay"},{value:"bank_transfer",label:"تحويل بنكي"}])+field("رقم مرجعي","reference")+'</form><button id="save-remit" class="primary">تسجيل التوريد</button></div>');
      $("save-remit").onclick=async()=>{const f=new FormData($("remit-form"));try{await rpc("record_distributor_remittance",{p_distributor_id:null,p_amount:Number(f.get("amount")),p_payment_method:f.get("payment_method"),p_reference:f.get("reference")||null,p_notes:null});toast("تم تسجيل التوريد");render()}catch(x){fail(x)}};
    }
  }

  async function profilePage(){
    const avatarUrl=await signedAvatarUrl(profile.avatar_path).catch(()=> "");
    const photo=avatarUrl?'<img class="profile-photo" src="'+avatarUrl+'" alt="الصورة الشخصية">':'<div class="profile-photo profile-photo-empty">👤</div>';
    const required=profile.role==="distributor";
    setContent(section("الملف الشخصي","")+
      '<div class="profile-grid">'+
        '<section class="panel-card profile-avatar-card"><h3>الصورة الشخصية</h3>'+photo+
          '<p class="hint">الصيغ المدعومة JPG وPNG وWebP، بحد أقصى 3 ميجابايت.</p>'+
          '<input id="avatar-file" type="file" accept="image/jpeg,image/png,image/webp">'+
          '<button id="upload-avatar" class="primary" type="button">رفع / تغيير الصورة</button>'+
          ''+
        '</section>'+
        '<section class="panel-card"><h3>البيانات الشخصية</h3>'+
          formPanel("profile-details-form","تعديل بيانات الحساب",
            field("الاسم الثلاثي","full_name","text",'required maxlength="120" autocomplete="name"')+
            field("رقم البطاقة الشخصية"+(required?" (إجباري)":" (اختياري)"),"national_id","text",'inputmode="numeric" maxlength="14" minlength="14" pattern="[0-9]{14}" autocomplete="off" '+(required?"required":""))+
            '<p class="hint">'+(required?"الموزع لازم يسجل الاسم الثلاثي ورقم بطاقة مكوّن من 14 رقمًا.":"يمكنك إضافة رقم البطاقة اختياريًا.")+'</p>'
          )+
        '</section>'+
        '<section class="panel-card profile-password-card"><h3>تغيير كلمة المرور</h3>'+
          formPanel("profile-password-form","تحديث كلمة مرور الحساب",
            field("كلمة المرور الحالية","current_password","password",'required autocomplete="current-password"')+
            field("كلمة المرور الجديدة","new_password","password",'required minlength="8" autocomplete="new-password"')+
            field("تأكيد كلمة المرور الجديدة","confirm_password","password",'required minlength="8" autocomplete="new-password"')
          ,"تغيير كلمة المرور")+
          '<p class="hint">سيتم التحقق من كلمة المرور الحالية قبل حفظ الجديدة.</p>'+
        '</section>'+
      '</div>');
    const details=$("profile-details-form");
    details.elements.full_name.value=profile.full_name||"";
    details.elements.national_id.value=profile.national_id||"";
    details.onsubmit=async e=>{
      e.preventDefault();
      const data=new FormData(details);
      const fullName=String(data.get("full_name")||"").trim();
      const nationalId=String(data.get("national_id")||"").trim();
      if(fullName.split(/\s+/).filter(Boolean).length<3)return toast("اكتب الاسم الثلاثي كاملًا");
      if(required && !/^\d{14}$/.test(nationalId))return toast("رقم البطاقة يجب أن يتكون من 14 رقمًا");
      if(nationalId && !/^\d{14}$/.test(nationalId))return toast("رقم البطاقة يجب أن يتكون من 14 رقمًا");
      const btn=details.querySelector('button[type="submit"],button:not([type])');if(btn)btn.disabled=true;
      try{
        const {error}=await sb.rpc("update_my_profile",{p_full_name:fullName,p_national_id:nationalId||null});
        if(error)throw error;
        profile.full_name=fullName;profile.national_id=nationalId||null;
        if(distributor)distributor.name=fullName;
        $("welcome-title").textContent="أهلاً "+fullName;
        await refreshUserArea();
        toast("تم حفظ بيانات الملف الشخصي");
        await render();
      }catch(error){if(btn)btn.disabled=false;fail(error)}
    };
    const passwordForm=$("profile-password-form");
    passwordForm.onsubmit=async e=>{
      e.preventDefault();
      const data=new FormData(passwordForm);
      const current=String(data.get("current_password")||"");
      const next=String(data.get("new_password")||"");
      const confirmPassword=String(data.get("confirm_password")||"");
      if(next.length<8)return toast("كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف");
      if(next!==confirmPassword)return toast("تأكيد كلمة المرور غير مطابق");
      if(next===current)return toast("اختر كلمة مرور مختلفة عن الحالية");
      const btn=passwordForm.querySelector('button[type="submit"],button:not([type])');if(btn)btn.disabled=true;
      try{
        const {error:verifyError}=await sb.auth.signInWithPassword({email:sessionUser.email,password:current});
        if(verifyError)throw new Error("كلمة المرور الحالية غير صحيحة");
        const {error:updateError}=await sb.auth.updateUser({password:next});
        if(updateError)throw updateError;
        passwordForm.reset();
        toast("تم تغيير كلمة المرور بنجاح");
      }catch(error){fail(error)}
      finally{if(btn)btn.disabled=false}
    };
    $("upload-avatar").onclick=async()=>{
      const file=$("avatar-file").files?.[0];
      if(!file)return toast("اختر صورة أولاً");
      const allowed=["image/jpeg","image/png","image/webp"];
      if(!allowed.includes(file.type))return toast("اختر صورة JPG أو PNG أو WebP");
      if(file.size>3*1024*1024)return toast("حجم الصورة يجب ألا يتجاوز 3 ميجابايت");
      const ext={"image/jpeg":"jpg","image/png":"png","image/webp":"webp"}[file.type];
      const path=sessionUser.id+"/"+Date.now()+"."+ext;
      const button=$("upload-avatar");button.disabled=true;
      try{
        const {error:uploadError}=await sb.storage.from("profile-avatars").upload(path,file,{cacheControl:"3600",upsert:false,contentType:file.type});
        if(uploadError)throw uploadError;
        const oldPath=profile.avatar_path;
        const {error:updateError}=await sb.from("profiles").update({avatar_path:path}).eq("id",sessionUser.id);
        if(updateError){await sb.storage.from("profile-avatars").remove([path]);throw updateError}
        profile.avatar_path=path;
        if(oldPath)await sb.storage.from("profile-avatars").remove([oldPath]);
        await refreshUserArea();
        renderTabs();
        toast("تم تحديث الصورة الشخصية");
        await render();
      }catch(error){button.disabled=false;fail(error)}
    };
    // الصورة إلزامية؛ يمكن تغييرها فقط ولا يمكن إزالتها.
  }

  async function checkForAppUpdate(){
    const nativeUpdater = window.Capacitor?.Plugins?.AppUpdater;
    if(!nativeUpdater || window.__ELHELW_UPDATE_CHECKED)return;
    window.__ELHELW_UPDATE_CHECKED=true;
    try{
      const current=await nativeUpdater.getAppInfo();
      const response=await fetch("https://api.github.com/repos/Ahmad-Ihab/elhelw-coffee/releases/latest",{cache:"no-store",headers:{Accept:"application/vnd.github+json"}});
      if(!response.ok)throw new Error("تعذر التحقق من وجود تحديث.");
      const release=await response.json();
      const match=String(release.body||"").match(/versionCode\s*:\s*(\d+)/i);
      const latestCode=match?Number(match[1]):0;
      const apk=(release.assets||[]).find(a=>/\.apk$/i.test(a.name));
      if(!apk||!latestCode||latestCode<=Number(current.versionCode))return;
      const version=String(release.tag_name||"").replace(/^v/i,"");
      if(!confirm("يتوفر تحديث جديد لتطبيق Elhelw Distribution\nالإصدار الحالي: "+current.versionName+"\nالإصدار الجديد: "+version+"\n\nهل تريد تنزيل التحديث الآن؟"))return;
      toast("جارٍ تنزيل التحديث...");
      await nativeUpdater.downloadUpdate({url:apk.browser_download_url,filename:"elhelw-distribution-"+version+".apk"});
      let status="running";
      const started=Date.now();
      while(status==="running"||status==="paused"){
        await new Promise(resolve=>setTimeout(resolve,1500));
        if(Date.now()-started>15*60*1000)throw new Error("استغرق التنزيل وقتاً طويلاً. يمكنك متابعة التنزيل من إشعارات الهاتف.");
        const state=await nativeUpdater.getDownloadStatus();
        status=state.status;
        if(status==="failed")throw new Error("فشل تنزيل التحديث. كود الخطأ: "+state.reason);
      }
      if(status!=="success")return;
      toast("اكتمل تنزيل التحديث.");
      if(confirm("تم تنزيل الإصدار "+version+" بنجاح. هل تريد تثبيته الآن؟")){
        const result=await nativeUpdater.installUpdate();
        if(result.permissionRequired){
          window.__ELHELW_INSTALL_PERMISSION_PENDING=true;
          toast("اسمح بالتثبيت من هذا المصدر في إعدادات أندرويد، ثم ارجع للتطبيق.");
        }
      }
    }catch(error){console.warn("App update check:",error);if(error?.message)toast(error.message)}
  }
  document.addEventListener("visibilitychange",async()=>{
    if(document.visibilityState!=="visible"||!window.__ELHELW_INSTALL_PERMISSION_PENDING)return;
    window.__ELHELW_INSTALL_PERMISSION_PENDING=false;
    try{await nativeUpdaterInstallPending()}catch(error){console.warn(error);fail(error)}
  });
  async function nativeUpdaterInstallPending(){
    const updater=window.Capacitor?.Plugins?.AppUpdater;
    if(!updater)return;
    const result=await updater.installUpdate();
    if(result.permissionRequired)window.__ELHELW_INSTALL_PERMISSION_PENDING=true;
  }
  checkForAppUpdate();
  $("login-form").onsubmit=async e=>{e.preventDefault();$("login-error").textContent="";let {error}=await sb.auth.signInWithPassword({email:$("email").value,password:$("password").value});if(error){$("login-error").textContent=error.message;return}location.reload()};
  boot().catch(fail);
})();
// Android build trigger: invoice/admin/product/stock updates.
