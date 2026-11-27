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
      fn("purchase_new","إنشاء أمر شراء","purchases.manage",[code,supplier,many("lines","بنود الشراء",[item,choice("unit","وحدة الشراء (الافتراضي وحدة الصنف)",units,true),field("qty","الكمية بوحدة الشراء","number"),field("price","سعر وحدة الشراء","number")])]),
      fn("purchase_submit","إرسال أمر للاعتماد","purchases.manage",[choice("order","أمر الشراء","purchase_drafts")]),
      fn("purchase_decide","مراجعة اعتماد","purchases.approve",[choice("order","أمر الشراء","approvals"),choice("decision","القرار",fixed(["approved","اعتماد"],["rejected","إعادة للمراجعة"]))]),
      fn("purchase_receive","استلام تشغيلة","purchases.receive",[choice("line","البند والكمية المتبقية","purchase_lines"),lotCode,location,qty,date,field("expiry","تاريخ الصلاحية","date",true)]),
      fn("purchase_bill","تسجيل فاتورة مورّد","purchases.manage",[supplier,code,date,many("lines","الاستلامات",[choice("receipt","الاستلام","billable")])])
    ]],
    ["التصنيع",[
      fn("linked_order","أمر تشغيل متعدد المراحل","manufacturing.post",[code,qty,many("steps","تسلسل المراحل",[choice("recipe","الوصفة","recipes"),field("direct","تكلفة مباشرة","number",true)])]),
      fn("operation_new","فتح عملية تصنيع","manufacturing.post",[choice("recipe","الوصفة المعتمدة","recipes"),field("code","رقم أمر التشغيل (اختياري)","text",true),qty,field("direct","التكلفة المباشرة","number")]),
      fn("operation_finish","تسجيل الإنتاج الفعلي","manufacturing.post",[choice("operation","العملية","operations"),lotCode,location,field("qty","كمية الناتج","number"),date,field("abnormal","قيمة الفاقد غير الطبيعي","number"),many("inputs","الخامات المستهلكة",[choice("lot","التشغيلة","released"),location,qty])])
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
      setup("item","صنف",[code,name,choice("kind","نوع الصنف",fixed(["RM","خامة"],["ADD","إضافة"],["GB","خلطة خضراء"],["RB","بن محمص"],["GC","بن مطحون"],["FB","بن منكه"],["PK","مادة تغليف"],["FG","منتج تام"])),choice("unit","الوحدة الأساسية",fixed(["KG","كجم"],["G","جم"],["EA","قطعة"],["L","لتر"],["ML","مل"])),field("weight","وزن الوحدة بالكيلو","number",true),field("days","مدة الصلاحية بالأيام","number",true),account]),
      setup("item_unit","معامل تحويل وحدة صنف",[item,choice("unit","الوحدة البديلة",units),field("factor","عدد الوحدات الأساسية لكل وحدة بديلة","number")]),
      setup("mapping","ربط كود قديم بصنف",[field("source_table","مصدر الكود"),field("source_key","الكود القديم"),item]),
      setup("supplier","مورّد",[code,name,field("legacy_id","معرّف المورّد القديم","text",true)]),setup("customer","عميل",[code,name,field("legacy_id","معرّف الكافيه القديم","text",true)]),
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
    wrap.append(t);return wrap;
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
        for(const opt of options)control.add(new Option(opt.label,opt.id));
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
  async function requestKey(actor,action,payload) {
    const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify([actor,action,payload])));
    const key="erp-pending-"+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
    const id=localStorage.getItem(key)||crypto.randomUUID();localStorage.setItem(key,id);return {key,id};
  }
  window.renderElhelwERP=async function(root,client,actor){
    const status=el("p","جارٍ تحميل عمليات الشركة…"),menu=el("div",null,"erp-menu"),work=el("div");
    status.setAttribute("role","status");root.replaceChildren(status,menu,work);
    async function refresh(message=""){
      menu.replaceChildren(); status.textContent="جارٍ تحميل عمليات الشركة…";
      const {data,error}=await client.rpc("elhelw_erp_workspace");
      if(!root.isConnected)return;
      if(error){status.textContent="تعذّر تحميل العمليات. "+error.message;menu.replaceChildren(button("إعادة المحاولة",()=>refresh(message)));return;}
      status.textContent=message;menu.replaceChildren();work.replaceChildren();
      for(const [key,label] of reports)if(data.records[key])menu.append(button(label,()=>work.replaceChildren(el("h3",label),table(data.records[key]))));
      for(const [title,actions] of groups){
        const allowed=actions.filter(a=>data.permissions.includes(a.perm));if(!allowed.length)continue;
        const section=el("details");section.append(el("summary",title));menu.append(section);
        for(const a of allowed)section.append(button(a.title,()=>open(a,data.choices)));
      }
      if(!menu.childElementCount)status.textContent="لا توجد صلاحيات تشغيل لهذا الحساب.";
    }
    function open(action,choices){
      const form=el("form",null,"form-panel");work.replaceChildren(form);
      form.append(el("h3",action.title));const grid=el("div",null,"form-grid");form.append(grid);
      const read=readFields(grid,action.fields,choices),submit=el("button",action.title,"primary");submit.type="submit";form.append(submit);
      const feedback=el("div");feedback.setAttribute("role","status");form.append(feedback);
      form.scrollIntoView({block:"start"});form.addEventListener("submit",async event=>{
        event.preventDefault();if(submit.disabled)return;submit.disabled=true;feedback.textContent="جارٍ التنفيذ…";
        try{
          let payload=await read();if(["opening_stage","cutover_review"].includes(action.action))payload=payload.file;
          const request=await requestKey(actor,action.action,payload);
          const {data,error}=await client.rpc("elhelw_erp_command",{p_action:action.action,p_payload:payload,p_request:request.id});
          if(error)throw error;
          localStorage.removeItem(request.key);
          if(action.action==="cutover_review"){
            feedback.replaceChildren(el("p",data.matches?"مطابقة الأرصدة ناجحة":"توجد فروق تستدعي المراجعة"),el("p","فروق دفاتر المخزون "+data.stock_mismatches),table(data.differences));submit.disabled=false;
          }else if(action.action==="component_plan"){
            feedback.replaceChildren(table(data));submit.disabled=false;
          }else if(action.action==="opening_review"){
            feedback.replaceChildren(el("p",data.matches?"الأرصدة مطابقة":"يوجد فرق في المطابقة"),el("p","عدد البنود "+data.lines+" · إجمالي القيمة "+data.value),table(data.problems));
            submit.disabled=false;
          }else{
            form.remove();await refresh(action.action==="inspect_record"?(data==="passed"?"نجح الفحص. التشغيلة في انتظار الإفراج.":"فشل الفحص. التشغيلة في الحجر."):"تم تنفيذ العملية.");
          }
        }catch(err){feedback.textContent="تعذّر تنفيذ العملية. "+(err.message||err);submit.disabled=false;}
      });
    }
    await refresh();
  };
})();
