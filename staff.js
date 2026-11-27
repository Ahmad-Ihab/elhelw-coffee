(() => {
  "use strict";
  const departments = [
    ["الحسابات","finance",[["finance.read","عرض الحسابات وميزان المراجعة"],["finance.post","القيود والتحصيل والسداد والتحويلات"],["finance.close","إقفال الفترة المالية"],["costing.manage","إدارة التكاليف والتسويات"],["finance.setup","إعداد الحسابات والخزائن والفترات"]]],
    ["التوريد والمشتريات","buy",[["purchases.catalog","إضافة الموردين والخامات وتحديد أسعارهم"],["purchases.manage","إنشاء طلبيات الشراء وإرسالها وتسجيل فواتير الموردين"],["purchases.receive","استلام الخامات في المخزن"],["purchases.approve","مراجعة واعتماد طلبيات التوريد المسندة إليه"]]],
    ["التصنيع","factory",[["manufacturing.recipes","إعداد أصناف ووصفات الإنتاج"],["manufacturing.post","فتح أوامر التشغيل وتسجيل الإنتاج"],["planning.run","حساب الاحتياجات والتخطيط"]]],
    ["الجودة","quality",[["quality.read","عرض سجل فحوص الجودة"],["quality.configure","تحديد مواصفات الفحص"],["quality.inspect","فحص التشغيلات وتسجيل النتائج"],["quality.release","الإفراج عن تشغيلات اجتازت الفحص"]]],
    ["المخازن","stock",[["inventory.read","عرض أرصدة المخازن"],["inventory.transfer","تحويل التشغيلات بين المخازن"]]],
    ["المبيعات والتوزيع","delivery",[["sales.manage","البيع المباشر والتسليم والمرتجعات"],["distribution.manage","التوزيع وعهد المناديب"]]],
    ["الأفراد والرواتب","hr",[["hr.manage","إدارة العاملين والعقود والحضور والإجازات"],["payroll.prepare","إعداد مسير الرواتب"],["payroll.approve","اعتماد وترحيل الرواتب"]]],
    ["الأصول والصيانة","asset",[["assets.manage","إدارة الأصول والإهلاك"],["maintenance.manage","إدارة الصيانة"]]]
  ];
  const presets={"محاسب":["finance.read","finance.post","finance.close","costing.manage","finance.setup"],"مسؤول توريد":["purchases.catalog","purchases.manage","purchases.receive"],"مسؤول تصنيع":["manufacturing.recipes","manufacturing.post"]};
  const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node};
  function btn(text,handler,cls="secondary"){const b=el("button",text);b.type="button";b.className=cls;b.onclick=handler;return b}
  async function invoke(sb,body){
    const {data,error}=await sb.functions.invoke("staff-access",{body});
    if(error){let msg=error.message;try{msg=(await error.context.json()).error||msg}catch{}throw Error(msg)}
    if(data?.error)throw Error(data.error);return data.data;
  }
  window.ElhelwStaff={
    async request(sb,op,args={}){return invoke(sb,{op,args})},
    async manage(root,sb){
      let generation=0;
      const rpc=async(op,p={})=>{const {data,error}=await sb.rpc("elhelw_staff_manage",{p_op:op,p});if(error)throw error;return data};
      async function list(message=""){
        const epoch=++generation;root.replaceChildren(el("p","جارٍ تحميل الموظفين…"));
        let staff;try{staff=await rpc("list")}catch(e){if(root.isConnected&&generation===epoch)root.replaceChildren(el("p",e.message),btn("إعادة المحاولة",()=>list()));return}
        if(!root.isConnected||generation!==epoch)return;root.replaceChildren();
        if(message){const note=el("p",message);note.className="guide-notice";note.setAttribute("role","status");root.append(note)}
        root.append(btn("＋ إضافة موظف",()=>edit(null),"primary"));
        if(!staff.length){root.append(el("p","ابدأ بإضافة موظف، وبعدها اختار العمليات اللي يقدر يعملها."));return}
        for(const person of staff){
          const card=el("article");card.className="staff-card";const text=el("div");text.append(el("strong",person.name),el("small",person.email),el("small",person.enabled?(person.permissions.length+" صلاحيات محددة"):"الوصول موقوف"));
          card.append(text,btn("تعديل الصلاحيات",()=>edit(person)));root.append(card);
        }
      }
      function edit(person){
        ++generation;root.replaceChildren(btn("→ قائمة الموظفين",()=>list(),"back-link"));
        const form=el("form");form.className="form-panel staff-form";root.append(form);
        form.append(el("h3",person?"صلاحيات "+person.name:"إضافة موظف"));
        const inputs={};
        if(!person){
          for(const [name,label,type] of [["name","اسم الموظف","text"],["email","بريد تسجيل الدخول","email"],["password","كلمة مرور الموظف (١٠ أحرف على الأقل)","password"]]){
            const wrap=el("label",label),i=el("input");wrap.className="field";i.name=name;i.type=type;i.required=true;i.maxLength=name==="password"?128:120;
            if(name==="password"){i.minLength=10;i.autocomplete="new-password"}if(name==="email")i.dir="ltr";
            wrap.append(i);form.append(wrap);inputs[name]=i;
          }
        }
        const selected=new Set(person?.permissions||[]),checks=new Map(),groups=[];
        const sync=()=>{for(const [key,input] of checks)input.checked=selected.has(key);for(const [all,keys] of groups){all.checked=keys.every(k=>selected.has(k));all.indeterminate=!all.checked&&keys.some(k=>selected.has(k))}};
        const presetsBar=el("div");presetsBar.className="inline-actions";form.append(el("h4","ابدأ بمسؤولية وعدّل تفاصيلها"),presetsBar);
        for(const [label,keys] of Object.entries(presets))presetsBar.append(btn(label,()=>{for(const k of keys)selected.add(k);sync()}));
        form.append(el("p","تقدر تجمع أكتر من مسؤولية، وتشيل أو تضيف أي صلاحية قبل الحفظ."));
        function toggle(text){const lab=el("label");lab.className="staff-toggle";const box=el("input");box.type="checkbox";lab.append(box,document.createTextNode(text));return [lab,box]}
        for(const [name,,perms] of departments){
          const group=el("fieldset"),legend=el("legend");const [label,all]=toggle(name);legend.append(label);group.append(legend);const keys=perms.map(p=>p[0]);groups.push([all,keys]);all.onchange=()=>{for(const k of keys)all.checked?selected.add(k):selected.delete(k);sync()};
          for(const [key,title] of perms){const [label,input]=toggle(title);checks.set(key,input);input.value=key;input.onchange=()=>{input.checked?selected.add(key):selected.delete(key);sync()};group.append(label)}form.append(group);
        }
        sync();let enabled;
        if(person){const [label,box]=toggle("السماح لهذا الموظف بالدخول");enabled=box;enabled.checked=person.enabled;form.append(label);}
        const submit=el("button",person?"حفظ التغييرات":"إنشاء حساب الموظف");submit.type="submit";submit.className="primary";
        const feedback=el("p");feedback.setAttribute("role","status");form.append(submit,feedback);let lastKey="",request="";
        form.onsubmit=async e=>{
          e.preventDefault();if(submit.disabled)return;const permissions=[...selected].sort();
          if(!person&&!permissions.length){feedback.textContent="اختار صلاحية واحدة على الأقل للموظف.";return}
          submit.disabled=true;feedback.textContent="جارٍ الحفظ…";
          try{
            if(person)await rpc("update",{id:person.id,revision:person.revision,enabled:enabled.checked,permissions});
            else{
              const info={name:inputs.name.value.trim(),email:inputs.email.value.trim().toLowerCase(),permissions};
              const key=JSON.stringify(info);if(key!==lastKey){request=crypto.randomUUID();lastKey=key}
              await invoke(sb,{op:"create",...info,password:inputs.password.value,request});
            }
            await list(person?"تم تحديث صلاحيات الموظف.":"تم إنشاء الحساب. يقدر الموظف يدخل بالبريد وكلمة المرور اللي حددتهم.");
          }catch(err){feedback.textContent=err.message||"تعذّر الحفظ";submit.disabled=false;}
        };
      }
      await list();
    }
  };
})();
