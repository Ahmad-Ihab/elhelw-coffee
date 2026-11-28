(() => {
  "use strict";
  const choice = (key, label, source, optional = false) => ({key,label,source,optional});
  const field = (key, label, type = "text", optional = false) => ({key,label,type,optional});
  const many = (key,label,fields) => ({key,label,fields});
  const fixed = (...pairs) => pairs.map(([id,label])=>({id,label}));
  const yesNo = fixed(["true","نعم"],["false","لا"]);
  const stages = fixed(["receipt","الاستلام"],["blend","الخلط"],["roast","التحميص"],["grind","الطحن"],["flavor","إضافة النكهة"],["pack","التعبئة"]);
  const units = fixed(["KG","كجم"],["G","جم"],["EA","قطعة"],["L","لتر"],["ML","مل"]);
  const item = choice("item","الصنف","items"), qty = field("qty","الكمية بالوحدة الأساسية","number");
  const code = field("code","الرقم المرجعي"), name = field("name","الاسم"), date = field("date","تاريخ الترحيل","date");
  const location = choice("location","الموقع","locations"), account = choice("account","الحساب","accounts");
  const lotCode = field("lot_code","رقم التشغيلة"), supplier = choice("supplier","المورّد","suppliers");
  const role = choice("role","الدور","roles"), permission = choice("permission","الصلاحية","permissions");
  const user = field("user","معرّف حساب الموظف"), amount = field("amount","المبلغ","number");
  const fn = (action, title, perm, fields) => ({action,title,perm,fields});
  const setup = (action,title,fields) => fn("setup."+action,title,"setup.configure",fields);
  const access = (action,title,fields) => fn("access."+action,title,"roles.manage",fields);
  const treasury = choice("treasury","الخزينة","treasuries");
  const employee = choice("employee","الموظف","employees"), period = choice("period","الفترة المالية","periods");
  const asset = choice("asset","المعدة أو الأصل","assets"), notes = field("notes","وصف العمل");
  const groups = [
    ["المشتريات",[
      fn("supplier_quote","تسجيل سعر مورد","setup.configure",[supplier,choice("item","الخامة ووحدة التسعير","catalog"),field("price","سعر الوحدة بالجنيه","number")]),
      fn("quote_book","دليل أسعار الموردين","purchases.manage",[]),
      fn("purchase_quoted","إنشاء طلبية شراء","purchases.manage",[code,supplier,many("lines","الخامات المطلوبة",[item,field("qty","الكمية بالوحدة المعروضة","number"),field("price","سعر الوحدة بالجنيه","number")])]),
      fn("purchase_submit","إرسال أمر للاعتماد","purchases.manage",[choice("order","أمر الشراء","purchase_drafts")]),
      fn("purchase_decide","مراجعة اعتماد","purchases.approve",[choice("order","أمر الشراء","approvals"),choice("decision","القرار",fixed(["approved","اعتماد"],["rejected","إعادة للمراجعة"]))]),
      fn("purchase_receive","استلام تشغيلة","purchases.receive",[choice("line","البند والكمية المتبقية","purchase_lines"),lotCode,location,qty,date,field("expiry","تاريخ الصلاحية","date",true)]),
      fn("purchase_bill","تسجيل فاتورة مورّد","purchases.manage",[supplier,code,date,many("lines","الاستلامات",[choice("receipt","الاستلام","billable")])]),
      fn("supplier_profiles","ملفات الموردين","purchases.manage",[])
    ]],
    ["التصنيع",[
      fn("linked_order","أمر تشغيل متعدد المراحل","manufacturing.post",[code,qty,many("steps","تسلسل المراحل",[choice("recipe","الوصفة","recipes"),field("direct","تكلفة مباشرة","number",true)])]),
      fn("operation_new","فتح عملية تصنيع","manufacturing.post",[choice("recipe","الوصفة المعتمدة","recipes"),field("code","رقم أمر التشغيل (اختياري)","text",true),qty,field("direct","التكلفة المباشرة","number")]),
      fn("operation_finish","تسجيل الإنتاج الفعلي","manufacturing.post",[choice("operation","العملية","operations"),many("outputs","تشغيلات الناتج",[lotCode,location,qty]),date,field("abnormal","قيمة الفاقد غير الطبيعي","number"),many("inputs","الخامات المستهلكة",[choice("lot","التشغيلة","released"),location,qty])])
    ]],
    ["الجودة",[
      fn("inspect_start","فتح فحص","quality.inspect",[choice("lot","التشغيلة","pending_lots")]),
      fn("inspect_record","تسجيل نتائج الفحص","quality.inspect",[choice("inspection","الفحص المفتوح","pending_inspections"),field("values","نتائج القياس","checks")]),
      fn("inspect_release","الإفراج عن تشغيلة","quality.release",[choice("inspection","الفحص الناجح","passed")]),
      fn("spec_retire","إيقاف مواصفة للفحوص الجديدة","quality.configure",[choice("spec","المواصفة","active_specs")]),
      fn("spec","إضافة مواصفة فحص","quality.configure",[choice("item","الصنف (اتركه فارغًا لكل الأصناف)","items",true),choice("stage","المرحلة",stages),name,choice("kind","نوع القياس",fixed(["numeric","رقمي"],["boolean","نعم أو لا"],["text","نص مطابق"])),field("min","الحد الأدنى","number",true),field("max","الحد الأقصى","number",true),field("unit","وحدة القياس","text",true),field("expected","النص المطلوب","text",true),choice("mandatory","فحص إلزامي",yesNo)])
    ]],
    ["المخزون",[
      fn("component_plan","حساب احتياجات وصفة","planning.run",[item,location,qty]),
      fn("plan","اقتراح احتياجات التوريد","planning.run",[field("horizon","تاريخ الاحتياج","date")]),
      fn("transfer","تحويل تشغيلة","inventory.transfer",[choice("lot","التشغيلة","released"),choice("from","من موقع","locations"),choice("to","إلى موقع","locations"),qty])
    ]],
    ["المبيعات المباشرة",[
      fn("sale_new","تأكيد طلب بيع","sales.manage",[code,choice("channel","قناة البيع","channels"),choice("customer","العميل","customers"),many("lines","بنود البيع",[item,choice("list_id","قائمة الأسعار","lists"),qty,field("discount","خصم البند","number",true)])]),
      fn("sale_cancel","إلغاء طلب وفك الحجز","sales.manage",[choice("order","طلب البيع","open_sales")]),
      fn("sale_deliver","تسليم وإصدار فاتورة","sales.manage",[choice("line","بند البيع","sale_lines"),choice("lot","التشغيلة","released"),qty,date]),
      fn("sale_return","استلام مرتجع وإصدار إشعار دائن","sales.manage",[choice("line","بند الفاتورة","return_lines"),qty,choice("location","موقع الحجر","locations"),choice("treasury","خزينة رد المبلغ المحصّل","treasuries",true),field("reason","سبب المرتجع"),date])
    ]],
    ["توزيع المناديب",[
      fn("distribution_new","طلب توزيع وحجز مخزونه","distribution.manage",[code,choice("distributor","المندوب","routes"),choice("customer","العميل","customers"),many("lines","البنود",[item,choice("list_id","قائمة الأسعار","lists"),qty,field("discount","الخصم","number",true)])]),
      fn("sale_deliver","تسليم طلب توزيع","distribution.manage",[choice("line","بند الطلب","sale_lines"),choice("lot","التشغيلة المحجوزة","released"),qty,date]),
      fn("sale_cancel","إلغاء طلب المندوب وفك الحجز","distribution.manage",[choice("order","طلب التوزيع","open_sales")]),
      fn("distribution_collect","تحصيل في عهدة المندوب","distribution.manage",[choice("invoice","فاتورة التوزيع","distribution_invoices"),amount,date]),
      fn("distribution_remit","توريد عهدة للشركة","distribution.manage",[choice("distributor","المندوب","routes"),treasury,amount,date]),
      fn("sale_return","مرتجع توزيع ورد النقد من خزينة الشركة","distribution.manage",[choice("line","بند الفاتورة","return_lines"),qty,choice("location","موقع الحجر","locations"),treasury,field("reason","السبب"),date])
    ]],
    ["الخزينة",[
      fn("settle","سداد فاتورة مورّد","finance.post",[choice("invoice","فاتورة المورّد","supplier_invoices"),treasury,amount,date,field("kind","","constant:payment")]),
      fn("settle","تحصيل فاتورة عميل","finance.post",[choice("invoice","فاتورة العميل","sales_invoices"),treasury,amount,date,field("kind","","constant:receipt")])
    ]],
    ["الحسابات والتكاليف",[
      fn("freight_bill","توزيع فاتورة نقل بالوزن","costing.manage",[supplier,code,date,amount,many("lines","التشغيلات المستلمة",[choice("receipt","الاستلام","freight_receipts")])]),
      fn("finance.journal","ترحيل قيد يدوي","finance.post",[date,field("reason","البيان"),many("lines","طرفا القيد",[account,field("debit","مدين","number",true),field("credit","دائن","number",true)])]),
      fn("finance.reverse","عكس قيد يدوي","finance.post",[date,choice("entry","القيد","journals"),field("reason","سبب العكس")]),
      fn("finance.treasury_transfer","تحويل بين الخزائن","finance.post",[date,choice("from","من خزينة","treasuries"),choice("to","إلى خزينة","treasuries"),amount]),
      fn("finance.open_cost","فتح فترة تكاليف","costing.manage",[period,field("capacity","الطاقة العادية بالكيلو","number"),field("initial_rate","معدل الافتتاح المعتمد لأول فترة فقط","number",true)]),
      fn("finance.overhead","تسجيل تكلفة غير مباشرة","costing.manage",[choice("cost_period","فترة التكاليف","cost_periods"),date,choice("category","البند",fixed(["labor","أجور"],["energy","طاقة"],["depreciation","إهلاك"],["maintenance","صيانة"],["rent","إيجار"],["other","أخرى"])),choice("behavior","السلوك",fixed(["fixed","ثابت"],["variable","متغير"])),amount,choice("account","الحساب المقابل","accounts")]),
      fn("finance.close_cost","تسوية فرق التحميل","costing.manage",[choice("cost_period","فترة التكاليف","cost_periods"),{...many("lines","توزيع الفروق",[choice("destination","الوجهة",fixed(["inventory","مخزون تام"],["wip","تحت التشغيل"],["cogs","تكلفة مبيعات"],["abnormal_expense","مصروف غير طبيعي"])),choice("lot","التشغيلة عند التحميل للمخزون","cost_lots",true),choice("location","موقع المخزون","locations",true),field("amount","الفرق بإشارته","signed")]),optional:true}]),
      fn("finance.close","إقفال فترة مالية","finance.close",[period])
    ]],
    ["الأرصدة الافتتاحية",[
      fn("cutover_review","مطابقة أرصدة الشركة","migration.stage",[field("file","ملف الأرصدة الرقابية بصيغة JSON","file")]),
      fn("opening_stage","قراءة ملف الجرد","migration.stage",[field("file","ملف الجرد بصيغة JSON","file")]),
      fn("opening_review","مطابقة ملف الجرد","migration.stage",[choice("run","الجرد","runs")]),
      fn("opening_post","ترحيل الجرد المطابق","migration.stage",[choice("run","الجرد","runs")])
    ]],
    ["شؤون العاملين",[
      fn("hr.employee","إضافة موظف","hr.manage",[code,name,date]),
      fn("hr.contract","تسجيل شروط التعاقد","hr.manage",[employee,field("start","ساري من","date"),field("end","ساري حتى","date",true),field("salary","الأجر الأساسي","number")]),
      fn("hr.attendance","تسجيل حضور","hr.manage",[employee,field("start","الدخول","datetime-local"),field("end","الخروج","datetime-local",true)]),
      fn("hr.clock_out","تسجيل انصراف","hr.manage",[employee,field("end","الخروج","datetime-local")]),
      fn("hr.leave","تسجيل إجازة","hr.manage",[employee,field("start","من","date"),field("end","إلى","date"),field("kind","نوع الإجازة")]),
      fn("hr.leave_decide","مراجعة إجازة","hr.manage",[choice("leave","طلب الإجازة","leave"),choice("decision","القرار",fixed(["approved","موافقة"],["rejected","رفض"]))]),
      fn("hr.payroll_prepare","إعداد مسير رواتب","payroll.prepare",[period,many("lines","بنود الرواتب المعتمدة",[employee,choice("component","البند","components"),amount])]),
      fn("hr.payroll_post","اعتماد وترحيل الرواتب","payroll.approve",[choice("run","مسير الرواتب","payruns")])
    ]],
    ["الأصول والصيانة",[
      fn("asset.asset","تسجيل أصل","assets.manage",[code,name,location,date,field("cost","تكلفة الاقتناء","number"),field("residual","قيمة الخردة","number"),field("months","العمر الإنتاجي بالشهور","number"),account,choice("expense","حساب مصروف الإهلاك","accounts"),choice("accumulated","حساب مجمع الإهلاك","accounts")]),
      fn("asset.depreciate","ترحيل إهلاك الفترة","assets.manage",[asset,period,field("amount","قسط الإهلاك المعتمد","number")]),
      fn("asset.plan","خطة صيانة دورية","maintenance.manage",[asset,notes,field("days","التكرار بالأيام","number"),field("date","الاستحقاق القادم","date")]),
      fn("asset.open","فتح صيانة وقائية","maintenance.manage",[choice("plan","الخطة","maintenance_plans"),notes]),
      fn("asset.open","فتح صيانة تصحيحية","maintenance.manage",[asset,notes]),
      fn("asset.complete","إقفال أمر صيانة","maintenance.manage",[choice("ticket","أمر الصيانة","tickets"),field("amount","إجمالي تكلفة الصيانة","number"),date])
    ]],
    ["تهيئة الشركة",[
      setup("route","ربط عهدة مندوب",[field("distributor","معرّف المندوب في التطبيق الحالي"),name,choice("channel","قناة التوزيع","distribution_channels"),choice("treasury","خزينة عهدة المندوب","treasuries")]),
      setup("commission","عمولة صنف بقناة توزيع",[choice("channel","قناة التوزيع","distribution_channels"),item,choice("kind","طريقة العمولة",fixed(["percentage","نسبة مئوية"],["per_kg","قيمة لكل كجم"],["per_unit","قيمة لكل وحدة"])),field("rate","معدل العمولة","number")]),
      setup("pay_component","قاعدة ترحيل بند راتب",[name,choice("kind","نوع البند",fixed(["earning","استحقاق"],["deduction","استقطاع"],["employer_cost","تكلفة صاحب العمل"])),account,choice("payable","حساب مقابل لتكلفة صاحب العمل","accounts",true)]),
      setup("account","حساب بدليل الحسابات",[code,name,choice("kind","طبيعة الحساب",fixed(["asset","أصل"],["liability","التزام"],["equity","حقوق ملكية"],["revenue","إيراد"],["expense","مصروف"]))]),
      setup("posting_account","ربط حساب للترحيل",[account,choice("purpose","الاستخدام",fixed(["opening_equity","مقابل الأرصدة الافتتاحية"],["goods_received_unbilled","بضاعة مستلمة غير مفوترة"],["payables","المورّدون"],["freight_clearing","وسيط مصاريف النقل"],["receivables","العملاء"],["sales","إيراد المبيعات"],["cogs","تكلفة المبيعات"],["direct_absorption","تحميل تكلفة مباشرة"],["overhead_absorption","تحميل تكلفة غير مباشرة"],["abnormal_loss","فاقد غير طبيعي"],["payroll_payable","رواتب مستحقة"],["commission_expense","مصروف العمولة"],["commission_payable","عمولات مستحقة"],["maintenance_expense","مصروف صيانة"],["maintenance_clearing","مقابل مصروف الصيانة"]))]),
      setup("period","فترة مالية",[field("start","بداية الفترة","date"),field("end","نهاية الفترة","date")]),
      setup("location","موقع مخزني",[code,name,choice("kind","النوع",fixed(["warehouse","مخزن رئيسي"],["storage","تخزين"],["channel","قناة بيع"],["custody","عهدة"],["quarantine","حجر"]))]),
      setup("item","إضافة خامة أو صنف",[name,field("code","كود الصنف"),choice("kind","نوع الصنف",fixed(["RM","خامة"],["ADD","إضافة"],["GB","خلطة خضراء"],["RB","بن محمص"],["GC","بن مطحون"],["FB","بن منكه"],["PK","مادة تغليف"],["FG","منتج تام"])),choice("unit","الوحدة الأساسية",fixed(["KG","كجم"],["G","جم"],["EA","قطعة"],["L","لتر"],["ML","مل"])),field("weight","وزن الوحدة بالكيلو","number",true),field("days","مدة الصلاحية بالأيام","number",true),account]),
      setup("item_unit","معامل تحويل وحدة صنف",[item,choice("unit","الوحدة البديلة",units),field("factor","عدد الوحدات الأساسية لكل وحدة بديلة","number")]),
      setup("mapping","ربط كود قديم بصنف",[field("source_table","مصدر الكود"),field("source_key","الكود القديم"),item]),
      setup("supplier","إضافة مورد",[name,field("code","كود المورد")]),setup("customer","عميل",[code,name,field("legacy_id","معرّف الكافيه القديم","text",true)]),
      setup("channel","قناة بيع",[code,name,location,choice("kind","تنفيذ الطلبات",fixed(["direct","بيع مباشر"],["external","المتجر المركزي"],["distributor","توزيع"]))]),
      setup("price_list","قائمة أسعار",[code,name,choice("channel","قناة البيع","channels",true)]),
      setup("price","تسعير صنف",[item,choice("list_id","قائمة الأسعار","lists"),field("price","سعر الوحدة","number")]),
      setup("treasury","خزينة",[name,account,choice("kind","النوع",fixed(["cash","نقدية"],["bank","بنك"],["wallet","محفظة"],["gateway","بوابة دفع"],["advance","عهدة مندوب"]))]),
      setup("replenishment","حدود إعادة الطلب",[item,location,field("safety","مخزون الأمان","number"),field("reorder","نقطة الطلب","number"),field("target","الرصيد المستهدف","number"),field("maximum","الحد الأقصى","number"),field("lead","مهلة التوريد بالأيام","number")]),
      setup("approval_rule","مسار اعتماد شراء",[field("minimum","الحد الأدنى لقيمة الأمر","number"),many("steps","خطوات الاعتماد بالترتيب",[role])]),
      setup("planning_recipe","وصفة التخطيط لمخزن",[item,location,choice("recipe","الوصفة","recipes")]),
      setup("recipe","اعتماد وصفة مرحلة",[code,name,choice("item","صنف الناتج","items"),qty,choice("stage","المرحلة",stages.slice(1)),field("loss","أقصى نسبة فاقد (من 0 إلى 1)","number"),choice("overhead","تحميل غير مباشر لهذه المرحلة",yesNo),many("components","مكونات الوصفة",[item,qty])])
    ]],
    ["صلاحيات الموظفين",[
      access("role","دور جديد",[code,name]),access("role_permission","إضافة صلاحية لدور",[role,permission]),
      access("revoke_role_permission","سحب صلاحية من دور",[role,permission]),access("clear_override","إلغاء استثناء والرجوع لصلاحيات الدور",[user,permission]),
      access("assign_role","إسناد دور لموظف",[user,role]),access("remove_role","سحب دور من موظف",[user,role]),
      access("user_override","استثناء صلاحية لموظف",[user,permission,choice("allowed","السماح",yesNo)])
    ]]
  ];
  const headings = {expected:"الرصيد المعتمد",actual:"رصيد النظام",stock_value:"قيمة المخزون",gl_value:"الرصيد الدفتري",difference:"الفرق",required:"الاحتياج",available:"المتاح",shortage:"صافي العجز",required_on:"تاريخ الاحتياج",kind:"النوع",sku:"كود الصنف",lot_code:"التشغيلة",location:"الموقع",quality_status:"حالة الجودة",quantity:"الرصيد",base_unit:"الوحدة",unreserved:"غير المحجوز",starts_on:"بداية الفترة",code:"كود الحساب",name:"اسم الحساب",debit:"مدين",credit:"دائن",net:"الصافي",stage:"المرحلة",status:"حالة الفحص",inspected_at:"تاريخ الفحص"};
  const states = {pending:"قيد الفحص",passed:"ناجح",failed:"راسب",released:"مفرج عنه",quarantine:"محجور",rejected:"مرفوض",...Object.fromEntries(stages.map(x=>[x.id,x.label]))};
  const reports = [["inventory_gl","مطابقة المخزون بالأستاذ العام"],["plan","احتياجات التوريد"],["inventory","رصيد المخزون"],["trial","ميزان المراجعة"],["quality","سجل فحوص الجودة"]];
  function el(tag,text,cls) {
    const node=document.createElement(tag);
    if(text!=null)node.textContent=text;
    if(cls)node.className=cls;
    return node;
  }
  function button(label,handler) {
    const b=el("button",label,"secondary"); b.type="button"; b.addEventListener("click",handler); return b;
  }
  function table(rows) {
    if(!rows.length)return el("p","لا توجد سجلات.","muted");
    const wrap=el("div",null,"table-wrap"), t=el("table"), tr=el("tr");
    const keys=Object.keys(rows[0]);
    for(const key of keys)tr.append(el("th",headings[key]||key));
    t.createTHead().append(tr);
    const body=t.createTBody();
    for(const row of rows){
      const cells=el("tr");
      for(const key of keys)cells.append(el("td",["status","stage","quality_status"].includes(key)?states[row[key]]||row[key]||"—":row[key]??"—"));
      body.append(cells);
    }
    wrap.append(t);window.elhelwMobileRecords(wrap);return wrap;
  }
  function readFields(parent,fields,choices) {
    const readers=new Map(), controls=new Map();
    function bind(def) {
      if(def.type?.startsWith("constant:"))return ()=>def.type.slice(9);
      if(def.fields){
        const group=el("fieldset"),list=el("div");group.append(el("legend",def.label),list);parent.append(group);
        const rows=new Map();
        function add(){
          const row=el("div",null,"erp-line");list.append(row);
          const read=readFields(row,def.fields,choices);rows.set(row,read);
          row.append(button("إزالة السطر",()=>{if(rows.size>1||def.optional){rows.delete(row);row.remove();}}));
        }
        if(!def.optional)add();group.append(button("إضافة سطر",add));return async()=>Promise.all([...rows.values()].map(read=>read()));
      }
      if(def.type==="checks"){
        const area=el("fieldset");parent.append(area);let read=async()=>({});
        const select=controls.get("inspection");
        function display(){
          area.replaceChildren(el("legend","القراءات"));
          const checks=(choices.pending_inspections||[]).find(x=>x.id===select.value)?.checks||[];
          read=readFields(area,checks.map(c=>{
            const limits=[c.min!=null?"من "+c.min:"",c.max!=null?"إلى "+c.max:"",c.unit||""].filter(Boolean).join(" ");
            const label=[c.name,limits].filter(Boolean).join(" · ");
            return c.kind==="boolean"?choice(c.id,label,yesNo,!c.mandatory):field(c.id,label,c.kind==="numeric"?"reading":"text",!c.mandatory);
          }),choices);
        }
        select.addEventListener("change",display);display();
        return async()=>{const values=await read();for(const k of Object.keys(values))if(values[k]===undefined)delete values[k];return values;};
      }
      const label=el("label",def.label,"field"), control=el(def.source?"select":"input");
      controls.set(def.key,control);control.name=def.key;control.required=!def.optional;label.append(control);parent.append(label);
      if(def.source){
        const options=typeof def.source==="string"?choices[def.source]||[]:def.source;
        control.add(new Option("اختر",""));
        for(const opt of options)control.add(new Option(def.source==="catalog"?opt.label+" · "+prettyUnit(opt.unit):opt.label,opt.id));
      }else{
        control.type=["reading","signed"].includes(def.type)?"number":def.type;
        if(control.type==="number"){control.step="any";if(!["reading","signed"].includes(def.type)&& !["min","max"].includes(def.key))control.min="0";}
        if(control.type==="file")control.accept=".json,application/json";
        if(control.type==="date"&&!def.optional){
          const now=new Date();control.value=new Date(now-now.getTimezoneOffset()*60000).toISOString().slice(0,10);
        }
      }
      return async()=>{
        if(control.type==="file")return JSON.parse(await control.files[0].text());
        if(control.value==="")return undefined;
        if(def.type==="datetime-local")return new Date(control.value).toISOString();
        if(["reading","number","signed"].includes(def.type))return Number(control.value);
        if(def.source===yesNo)return control.value==="true";
        return control.value;
      };
    }
    for(const def of fields)readers.set(def.key,bind(def));
    return async()=>{const payload={};for(const [key,read] of readers){const value=await read();if(value!==undefined)payload[key]=value;}return payload;};
  }
  function prepareDefaults(form,action,choices){
    const controls=form.elements;
    if(["setup.supplier","setup.item","purchase_quoted"].includes(action)){
      const prefix={"setup.supplier":"SUP","setup.item":"MAT","purchase_quoted":"PO"}[action];
      controls.code.value=prefix+"-"+crypto.randomUUID().slice(0,8).toUpperCase();
    }
    if(action==="setup.item"){
      controls.kind.value="RM";controls.unit.value="KG";
      const defaults={RM:"raw_inventory",ADD:"raw_inventory",PK:"pack_inventory",FG:"finished_inventory"};
      const sync=()=>{const key=defaults[controls.kind.value]||"wip_inventory";const match=choices.accounts.find(a=>a.label.startsWith(key+" ·"));if(match)controls.account.value=match.id;};
      controls.kind.onchange=sync;sync();
    }
    if(action==="setup.approval_rule")controls.minimum.value="0";
    if(action==="spec"){
      const lot=choices.inspection_lots?.find(l=>!choices.spec_coverage?.some(s=>s.stage===l.stage&&(!s.item||s.item===l.item)));
      if(lot){controls.stage.value=lot.stage;controls.item.value=lot.item;}
      controls.mandatory.value="true";
    }
  }
  async function requestKey(actor,action,payload) {
    const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify([actor,action,payload])));
    const key="erp-pending-"+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
    const id=localStorage.getItem(key)||crypto.randomUUID();localStorage.setItem(key,id);return {key,id};
  }
  const guideStages=[
    ["supplier","الموردين","مين بيورّد لك؟",["supplier_profiles","setup.supplier"]],
    ["materials","الخامات","سجّل البن ومواد التعبئة بوحداتها.",["setup.item","setup.item_unit"]],
    ["prices","أسعار الموردين","حدّد سعر كل خامة عند المورد.",["supplier_quote","quote_book"]],
    ["buy","طلبية الشراء","اختار المورد والخامات اللي هتطلبها.",["purchase_quoted","setup.approval_rule","purchase_submit","purchase_decide"]],
    ["receive","الاستلام","استلم كل بند في مخزنه برقم تشغيلة.",["setup.period","purchase_receive","purchase_bill"]],
    ["quality","فحص الجودة","حدّد المواصفة، افحص، وبعدها افرج عن التشغيلة.",["spec","inspect_start","inspect_record","inspect_release"]],
    ["recipe","وصفة الإنتاج","سجّل صنف الناتج، ومكوّناته ونسبة الفاقد.",["setup.item","setup.recipe","component_plan"]],
    ["factory","التصنيع","افتح أمر التشغيل وسجّل الكميات الفعلية.",["operation_new","linked_order","operation_finish"]],
    ["goods","المخزون التام","افحص الناتج وانقله لموقع البيع.",["inspect_start","inspect_record","inspect_release","transfer","report:inventory"]]
  ];
  const symbols={"المشتريات":"buy","التصنيع":"factory","الجودة":"quality","المخزون":"stock","المبيعات المباشرة":"sales","توزيع المناديب":"delivery","الخزينة":"payment","الحسابات والتكاليف":"finance","الأرصدة الافتتاحية":"audit","شؤون العاملين":"hr","الأصول والصيانة":"asset","تهيئة الشركة":"setup","صلاحيات الموظفين":"access","التقارير":"reports"};
  const normalize=s=>String(s).normalize("NFKD").replace(/[\u064B-\u065F\u0670]/g,"").replace(/[إأآٱ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه").toLowerCase().trim();
  const prettyUnit=key=>units.find(u=>u.id===key)?.label||key;
  const guideActions=()=>{
    const list=groups.flatMap(([group,actions])=>actions.map((a,i)=>({...a,group,uid:group+"."+i,art:symbols[group]})));
    for(const [key,label] of reports)list.push({action:"report:"+key,title:label,report:key,group:"التقارير",uid:"report:"+key,art:"reports"});
    return list;
  };
  function entries(w){
    const delegated={"setup.supplier":["purchases.catalog"],"supplier_quote":["purchases.catalog"],"quote_book":["purchases.catalog"],"setup.item":["purchases.catalog","manufacturing.recipes"],"setup.item_unit":["purchases.catalog","manufacturing.recipes"],"setup.recipe":["manufacturing.recipes"],"setup.planning_recipe":["manufacturing.recipes"],"setup.account":["finance.setup"],"setup.treasury":["finance.setup"],"setup.period":["finance.setup"],"setup.posting_account":["finance.setup"]};
    delegated.supplier_profiles=["purchases.catalog","setup.configure"];
    return guideActions().filter(a=>a.report?w.records[a.report]!==undefined:w.permissions.includes(a.perm)||delegated[a.action]?.some(k=>w.permissions.includes(k)));
  }
  const pick=(list,id)=>list.find(a=>a.action===id||a.uid===id);
  function nextStep(w,actions){
    const c=w.choices, flow=w.flow||{}, has=k=>Boolean(c[k]?.length);
    const candidate=(id,stage)=>{const action=pick(actions,id);return action?{action,stage}:null};
    // Outstanding work takes precedence over creating another order.
    const uncovered=c.inspection_lots?.filter(l=>!c.spec_coverage?.some(s=>s.stage===l.stage&&(!s.item||s.item===l.item)))||[];
    const needsSpec=uncovered.length>0&&uncovered.length===c.inspection_lots.length;
    const priorities=[
      [has("approvals"),"purchase_decide",3],[has("passed"),"inspect_release",5],[has("pending_inspections"),"inspect_record",5],
      [has("pending_lots")&&needsSpec,"spec",5],[has("pending_lots"),"inspect_start",5],
      [has("purchase_lines")&&!flow.period,"setup.period",4],[has("purchase_lines"),"purchase_receive",4],
      [has("purchase_drafts")&&!flow.rules,"setup.approval_rule",3],[has("purchase_drafts"),"purchase_submit",3],
      [has("operations")&&has("released"),"operation_finish",7],
      [has("released")&&!has("recipes"),"setup.recipe",6],[has("released")&&has("recipes")&&!flow.produced,"operation_new",7],
      [!has("suppliers"),"setup.supplier",0],[!has("catalog"),"setup.item",1],[!has("quotes"),"supplier_quote",2],
      [flow.produced&&has("released"),"transfer",8],[!flow.pending_approval,"purchase_quoted",3]
    ];
    for(const [when,id,stage] of priorities){const step=when&&candidate(id,stage);if(step)return step}
    return null;
  }
  function entryIndex(w){
    return entries(w).map(a=>({id:a.uid,title:a.title,group:a.group,art:a.art}));
  }
  window.ElhelwGuide={entries:entryIndex,normalize,next(w){const s=nextStep(w,entries(w));return s?{id:s.action.uid,title:s.action.title,art:guideStages[s.stage][0],stage:guideStages[s.stage][1],hint:guideStages[s.stage][2]}:null;}};
  function illustration(key){
    const span=el("span",null,"scene");span.innerHTML=window.elhelwArt(key);return span;
  }
  function tile(label,key,click,sub=""){
    const b=button("",click);b.className="journey-tile";b.append(illustration(key));
    const copy=el("span",null,"tile-copy");copy.append(el("strong",label));if(sub)copy.append(el("small",sub));b.append(copy);return b;
  }
  function inputSearch(oninput){
    const bar=el("input",null,"task-search");bar.type="search";bar.placeholder="ابحث عن عملية أو قسم";bar.setAttribute("aria-label",bar.placeholder);bar.oninput=()=>oninput(normalize(bar.value));return bar;
  }
  function quotedLines(form,c){
    const supplier=form.elements.namedItem("supplier"), fieldset=form.querySelector("fieldset");
    const known=c.quotes||[];
    const options=(select,values,placeholder)=>{
      const previous=select.value;select.replaceChildren(new Option(placeholder,""));
      for(const [id,label] of values)select.add(new Option(label,id));
      select.value=values.some(([id])=>id===previous)?previous:values.length===1?values[0][0]:"";
    };
    options(supplier,(c.suppliers||[]).filter(s=>known.some(q=>q.supplier===s.id)).map(s=>[s.id,s.label]),"اختر المورد");
    const update=()=>{
      const quotes=known.filter(q=>q.supplier===supplier.value);
      for(const row of fieldset.querySelectorAll(".erp-line")){
        const item=row.querySelector("[name=item]"), price=row.querySelector("[name=price]");
        options(item,quotes.map(q=>[q.item,q.name+" · "+prettyUnit(q.unit)]),"اختر الخامة");
        const fill=()=>{price.value=quotes.find(q=>q.item===item.value)?.price??"";price.readOnly=true;};fill();item.onchange=fill;
      }
    };
    supplier.onchange=update;fieldset.addEventListener("click",event=>{if(event.target.closest("button"))update()});update();
  }
  const needs={
    rules:["حدد مين بيعتمد طلبية الشراء الأول.","setup.approval_rule"],open_period:["اختار الفترة المالية اللي هيتسجّل فيها الاستلام.","setup.period"],
    suppliers:["أضف أول مورد عشان تقدر تسجل له سعر.","setup.supplier"],items:["أضف الصنف الأول.","setup.item"],catalog:["أضف أول خامة عشان تحدد سعرها.","setup.item"],quotes:["سجّل سعر خامة واحدة على الأقل للمورد قبل إنشاء طلبية.","supplier_quote"],
    purchase_drafts:["أنشئ طلبية شراء الأول.","purchase_quoted"],approvals:["مفيش طلبية مستنية اعتمادك دلوقتي.",""],purchase_lines:["الاستلام بيفتح بعد اعتماد طلبية فيها كمية متبقية.","purchase_decide"],billable:["استلم بندًا من الطلبية قبل تسجيل فاتورته.","purchase_receive"],
    pending_lots:["استلم تشغيلة أو سجّل ناتج تصنيع الأول.","purchase_receive"],pending_inspections:["افتح فحص للتشغيلة الأول.","inspect_start"],passed:["سجّل نتيجة فحص ناجحة قبل الإفراج.","inspect_record"],recipes:["أضف وصفة إنتاج معتمدة الأول.","setup.recipe"],operations:["افتح أمر تشغيل الأول.","operation_new"],released:["تحتاج تشغيلة مفرج عنها وبرصيد متاح.","inspect_release"],roles:["أضف دور المراجعة الأول.","access.role"],accounts:["أضف حسابًا في دليل الحسابات.","setup.account"],locations:["أضف موقع تخزين الأول.","setup.location"],periods:["حدّد البداية والنهاية للفترة المالية.","setup.period"],customers:["أضف العميل الأول.","setup.customer"],lists:["أنشئ قائمة أسعار بيع.","setup.price_list"],channels:["أضف قناة بيع.","setup.channel"],treasuries:["أضف خزينة أولًا.","setup.treasury"]
  };
  function missingChoice(fields,choices){
    for(const f of fields){if(f.optional)continue;if(typeof f.source==="string"&&!choices[f.source]?.length)return f.source;if(f.fields){const nested=missingChoice(f.fields,choices);if(nested)return nested}}
    return null;
  }
  window.renderElhelwERP=async function(root,client,actor,initial="",options={}){
    let snapshot,actions=[],screen={type:"home"},history=[],generation=0;
    const status=el("div","","guide-status"),body=el("div",null,"guide-body");
    status.setAttribute("role","status");root.classList.add("guide");root.replaceChildren(status,body);
    function go(next){history.push(screen);screen=next;draw();root.scrollIntoView({block:"start"});}
    function back(){if(!history.length)return false;screen=history.pop();draw();return true}
    root.guideBack=back;
    function header(title,key,sub){
      const head=el("header",null,"guide-head");head.append(illustration(key));
      const copy=el("div");copy.append(el("h2",title));if(sub)copy.append(el("p",sub));head.append(copy);body.append(head);
    }
    function showAction(a){go({type:"action",uid:a.uid})}
    function section(title){body.append(el("h3",title,"section-title"));const div=el("div",null,"journey-grid");body.append(div);return div}
    function actionTiles(grid,list){for(const a of list)grid.append(tile(a.title,a.art,()=>showAction(a)))}
    function supplierDirectory(){
      const suppliers=snapshot.choices.suppliers||[], quotes=snapshot.choices.quotes||[];
      const add=pick(actions,"setup.supplier");
      if(add)body.append(button("إضافة مورد",()=>go({type:"action",uid:add.uid,fromDirectory:true})));
      if(!suppliers.length){body.append(el("p","لسه مفيش موردين مسجلين.","guide-notice"));return}
      const counts=new Map();
      for(const q of quotes)counts.set(q.supplier,(counts.get(q.supplier)||0)+1);
      const list=el("div",null,"journey-grid supplier-list");
      function filter(query){
        list.replaceChildren();
        for(const s of suppliers.filter(s=>normalize(s.label).includes(query))){
          const count=counts.get(s.id)||0;
          list.append(tile(s.label,"supplier",()=>go({type:"supplier",id:s.id}),
            count?"الأصناف المسجلة: "+count.toLocaleString("ar-EG"):"لم تُسجّل أسعار بعد"));
        }
        if(!list.childElementCount)list.append(el("p","مفيش مورد بالاسم ده.","muted"));
      }
      if(suppliers.length>1){
        const search=inputSearch(filter);search.placeholder="ابحث باسم المورد";search.setAttribute("aria-label",search.placeholder);body.append(search);
      }
      body.append(list);filter("");
    }
    function supplierProfile(){
      const c=snapshot.choices, vendor=c.suppliers?.find(s=>s.id===screen.id);
      if(!vendor||!pick(actions,"supplier_profiles")){body.append(el("p","ملف المورد غير متاح.","guide-notice"));return}
      header(vendor.label,"supplier","ملف المورد");
      const quotes=(c.quotes||[]).filter(q=>q.supplier===vendor.id);
      const editor=pick(actions,"supplier_quote"), addItem=pick(actions,"setup.item");
      const edit=q=>go({type:"action",uid:editor.uid,supplierId:vendor.id,itemId:q?.item});
      body.append(el("h3","الأصناف وأسعار الوحدة","section-title"));
      if(!quotes.length)body.append(el("p","لسه مفيش أسعار مسجلة للمورد ده.","guide-notice"));
      const number=new Intl.NumberFormat("ar-EG",{maximumFractionDigits:8});
      for(const q of quotes){
        const row=el("div",null,"supplier-price-row"),copy=el("div");
        copy.append(el("strong",q.name),el("span",number.format(q.price)+" ج.م / "+prettyUnit(q.unit)));
        row.append(copy);
        if(editor){const change=button("تعديل السعر",()=>edit(q));change.setAttribute("aria-label","تعديل سعر "+q.name);row.append(change)}
        body.append(row);
      }
      if(editor){
        const used=new Set(quotes.map(q=>q.item));
        if(c.catalog?.some(i=>!used.has(i.id)))body.append(button("إضافة صنف بسعره",()=>edit(null)));
        if(addItem)body.append(button("تعريف صنف جديد",()=>go({type:"action",uid:addItem.uid,supplierId:vendor.id})));
      }
    }
    function draw(){
      body.replaceChildren();if(!snapshot)return;
      if(history.length){const b=button("→  رجوع",back);b.className="back-link";body.append(b)}
      if(screen.type==="supplier"){supplierProfile();return}
      if(screen.type==="action"){
        const a=actions.find(x=>x.uid===screen.uid);if(!a)return;
        const vendor=screen.supplierId&&snapshot.choices.suppliers?.find(s=>s.id===screen.supplierId);
        header(vendor&&a.action==="supplier_quote"?(screen.itemId?"تعديل السعر":"إضافة صنف بسعره"):a.title,a.action==="supplier_profiles"?"supplier":a.art,vendor?vendor.label:a.group);
        if(a.action==="supplier_profiles"){supplierDirectory();return}
        if(a.report){body.append(table(snapshot.records[a.report]));return}
        if(a.action==="quote_book"){
          body.append(table((snapshot.choices.quotes||[]).map(q=>({"المورد":q.supplier_name,"الخامة":q.name,"الوحدة":prettyUnit(q.unit),"سعر الوحدة (ج.م)":q.price}))));return;
        }
        const c=snapshot.choices, f=snapshot.flow||{};
        const missing=(a.action==='purchase_submit'&&f.rules===false)?'rules':(a.action==='purchase_receive'&&c.purchase_lines?.length&&f.period===false)?'open_period':(a.action==="purchase_quoted"&&!snapshot.choices.quotes?.length)?"quotes":missingChoice(a.fields,snapshot.choices);
        if(missing){
          const [message,fix]=needs[missing]||["لسه مفيش بيانات متاحة للعملية دي.",""];
          body.append(el("p",message,"guide-notice"));const prior=pick(actions,fix);
          if(prior)body.append(tile(prior.title,prior.art,()=>showAction(prior)));return;
        }
        open(a,snapshot.choices);return;
      }
      if(screen.type==="stage"){
        const [key,title,sub,ids]=guideStages[screen.index];header(title,key,sub);
        const grid=section("خطوات المرحلة");actionTiles(grid,ids.map(id=>pick(actions,id)).filter(Boolean));return;
      }
      if(screen.type==="group"){
        header(screen.title,symbols[screen.title]);actionTiles(section("العمليات"),actions.filter(a=>a.group===screen.title));return;
      }
      if(!actions.length){body.append(el("p","حسابك نشط. لسه مفيش عمليات مسموح بها، راجع مسؤول النظام.","guide-notice"));return}
      const next=nextStep(snapshot,actions);
      const result=el("div",null,"journey-grid");const contents=el("div");const search=inputSearch(q=>{
        result.replaceChildren();contents.hidden=Boolean(q);
        if(q){const matches=actions.filter(a=>normalize(a.title+" "+a.group).includes(q));actionTiles(result,matches);if(!matches.length)result.append(el("p","مفيش نتيجة بالاسم ده."));}
      });
      body.append(search,result,contents);
      if(next){const hero=tile(next.action.title,guideStages[next.stage][0],()=>showAction(next.action),"الخطوة التالية · "+guideStages[next.stage][1]);hero.className="guide-next";contents.append(hero)}
      else if(snapshot.flow?.pending_approval)contents.append(el("p","الطلبية في انتظار اعتماد مسؤول تاني.","guide-notice"));
      const availableStages=guideStages.map((stage,i)=>({stage,i})).filter(({stage})=>stage[3].some(id=>pick(actions,id)));
      if(availableStages.length){
        contents.append(el("h3","دورة الإنتاج","section-title"));const grid=el("div",null,"journey-grid");contents.append(grid);
        for(const {stage:[key,title,sub],i} of availableStages)grid.append(tile((i+1).toLocaleString("ar-EG")+" · "+title,key,()=>go({type:"stage",index:i}),sub));
      }
      contents.append(el("h3","كل أقسام الشركة","section-title"));const dirs=el("div",null,"journey-grid");contents.append(dirs);
      for(const title of new Set(actions.map(a=>a.group)))dirs.append(tile(title,symbols[title],()=>go({type:"group",title})));
    }
    async function refresh(message="",saved=false){
      const id=++generation;status.textContent="جارٍ تحميل العمليات…";
      try{
        const {data,error}=await client.rpc("elhelw_erp_workspace");if(error)throw error;if(!root.isConnected||id!==generation)return;
        snapshot=data;actions=entries(data);options.updated?.(data);
        if(initial){const a=pick(actions,initial);initial="";if(a){history=[{type:"home"}];screen={type:"action",uid:a.uid}}}
        if(saved){screen={type:"home"};history=[]}
        status.textContent=message;draw();if(saved)root.scrollIntoView({block:"start"});
      }catch(err){if(!root.isConnected)return;status.textContent="تعذّر تحميل العمليات. "+(err.message||err);body.replaceChildren(button("إعادة المحاولة",()=>refresh(message,saved)));}
    }
    function open(action,choices){
      const origin=screen;
      if(origin.supplierId&&action.action==="supplier_quote"&&!origin.itemId){
        const used=new Set((choices.quotes||[]).filter(q=>q.supplier===origin.supplierId).map(q=>q.item));
        choices={...choices,catalog:choices.catalog.filter(i=>!used.has(i.id))};
      }
      const form=el("form",null,"form-panel");body.append(form);
      const grid=el("div",null,"form-grid");form.append(grid);
      const read=readFields(grid,action.fields,choices),submit=el("button",action.title,"primary");submit.type="submit";form.append(submit);
      if(action.action==="purchase_quoted")quotedLines(form,choices);
      if(action.action==="supplier_quote"){
        const itemControl=form.elements.namedItem("item");
        const refill=()=>{const q=choices.quotes?.find(q=>q.supplier===form.elements.supplier.value&&q.item===itemControl.value);form.elements.price.value=q?.price??"";};
        form.elements.supplier.onchange=refill;itemControl.onchange=refill;
        if(origin.supplierId){
          form.elements.supplier.value=origin.supplierId;form.elements.supplier.disabled=true;
          if(origin.itemId){itemControl.value=origin.itemId;itemControl.disabled=true}
          refill();submit.textContent="حفظ السعر";
        }
      }
      prepareDefaults(form,action.action,choices);
      const feedback=el("div");feedback.setAttribute("role","status");form.append(feedback);
      form.addEventListener("submit",async event=>{
        event.preventDefault();if(submit.disabled)return;submit.disabled=true;feedback.textContent="جارٍ التنفيذ…";
        try{
          let payload=await read();if(["opening_stage","cutover_review"].includes(action.action))payload=payload.file;
          const request=await requestKey(actor,action.action,payload);
          const {data,error}=await client.rpc("elhelw_erp_command",{p_action:action.action,p_payload:payload,p_request:request.id});
          if(error)throw error;
          localStorage.removeItem(request.key);
          if(origin.supplierId||origin.fromDirectory){
            if(screen===origin){
              screen=history.pop();
              if(origin.fromDirectory&&data?.id){history.push(screen);screen={type:"supplier",id:data.id}}
            }
            await refresh(action.action==="supplier_quote"?"تم حفظ سعر المورد":"تم الحفظ");
          }else if(action.action==="cutover_review"){
            feedback.replaceChildren(el("p",data.matches?"مطابقة الأرصدة ناجحة":"توجد فروق تستدعي المراجعة"),el("p","فروق دفاتر المخزون "+data.stock_mismatches),table(data.differences));submit.disabled=false;
          }else if(action.action==="component_plan"){
            feedback.replaceChildren(table(data));submit.disabled=false;
          }else if(action.action==="opening_review"){
            feedback.replaceChildren(el("p",data.matches?"الأرصدة مطابقة":"يوجد فرق في المطابقة"),el("p","عدد البنود "+data.lines+" · إجمالي القيمة "+data.value),table(data.problems));
            submit.disabled=false;
          }else{
            form.remove();await refresh(action.action==="inspect_record"?(data==="passed"?"نجح الفحص. التشغيلة في انتظار الإفراج.":"فشل الفحص. التشغيلة في الحجر."):"تم الحفظ · "+action.title,true);
          }
        }catch(err){feedback.textContent="تعذّر تنفيذ العملية. "+(err.message||err);submit.disabled=false;}
      });
    }
    await refresh();
  };
})();
