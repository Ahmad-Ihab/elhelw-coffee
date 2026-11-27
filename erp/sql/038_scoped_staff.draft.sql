begin;
-- Staff auth tokens have an application-only role. PostgREST cannot switch to it.
do $$ begin if to_regrole('elhelw_staff') is not null then raise exception 'Reserved staff identity role must not be a database role'; end if; end $$;
insert into erp.permissions values ('purchases.catalog','Manage suppliers, materials and supplier prices'),('manufacturing.recipes','Manage production recipes and items'),('finance.setup','Manage finance accounts, treasuries and periods');
insert into erp.role_permissions select r.id,p.code from erp.roles r cross join erp.permissions p where r.code='ERP_ADMIN' and p.code in ('purchases.catalog','manufacturing.recipes','finance.setup') on conflict do nothing;
insert into erp.roles(code,name) values('STAFF_PURCHASE_REVIEW','مراجعو طلبيات التوريد');

create table erp.staff_requests(
 request_id uuid primary key, manager uuid not null references auth.users, email text not null, full_name text not null,
 permissions text[] not null, created_at timestamptz not null default now()
);
create table erp.staff_accounts(
 user_id uuid primary key references auth.users on delete cascade, request_id uuid not null unique references erp.staff_requests,
 full_name text not null, permissions text[] not null, revision integer not null default 1, enabled boolean not null default true
);
alter table erp.staff_requests enable row level security;
alter table erp.staff_accounts enable row level security;

create function erp.staff_owner(actor uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select from erp.user_roles ur join erp.roles r on r.id=ur.role_id where ur.user_id=actor and r.code='ERP_ADMIN')
 and not exists(select from erp.staff_accounts where user_id=actor)
$$;
create function erp.staff_rights(p jsonb) returns text[] language plpgsql immutable set search_path='' as $$
declare rights text[];
begin
 if jsonb_typeof(p) is distinct from 'array' then raise exception 'اختر صلاحيات الموظف';end if;
 select coalesce(array_agg(distinct value order by value),'{}') into rights from jsonb_array_elements_text(p);
 if array_position(rights,null) is not null or not rights <@ array['finance.read','finance.post','finance.close','finance.setup','costing.manage','purchases.catalog','purchases.manage','purchases.receive','purchases.approve','manufacturing.recipes','manufacturing.post','quality.configure','quality.inspect','quality.release','quality.read','inventory.read','inventory.transfer','planning.run','sales.manage','distribution.manage','hr.manage','payroll.prepare','payroll.approve','assets.manage','maintenance.manage'] then raise exception 'صلاحية غير متاحة لحساب موظف';end if;
 return rights;
end $$;
create function erp.staff_reviewer(actor uuid,rights text[],enabled boolean) returns void language plpgsql set search_path='' as $$
declare rid uuid;
begin
 select id into strict rid from erp.roles where code='STAFF_PURCHASE_REVIEW';
 if enabled and 'purchases.approve'=any(rights) then insert into erp.user_roles values(actor,rid) on conflict do nothing;
 else delete from erp.user_roles where user_id=actor and role_id=rid;end if;
end $$;
create function erp.staff_auth_enrol() returns trigger language plpgsql security definer set search_path='' as $$
declare req erp.staff_requests%rowtype; person auth.users%rowtype;
begin
 select * into strict person from auth.users where id=new.id;
 if person.role is distinct from 'elhelw_staff' then raise exception 'Invalid staff token role';end if;
 if exists(select from erp.staff_accounts where user_id=new.id) then return null;end if;
 select * into strict req from erp.staff_requests where request_id=(person.raw_app_meta_data->>'staff_request')::uuid and email=lower(person.email) for update;
 if not erp.staff_owner(req.manager) or req.created_at<now()-interval '1 day' then raise exception 'Staff invitation expired';end if;
 insert into erp.staff_accounts(user_id,request_id,full_name,permissions) values(person.id,req.request_id,req.full_name,req.permissions);
 perform erp.staff_reviewer(person.id,req.permissions,true);
 insert into erp.audit_log(actor_id,action,entity_type,entity_id,after_data) values(req.manager,'staff.create','staff',person.id::text,to_jsonb(req.permissions));
 return null;
end $$;
create constraint trigger elhelw_enrol_employee after insert or update on auth.users deferrable initially deferred for each row
 when(new.raw_app_meta_data->>'elhelw_staff'='true') execute function erp.staff_auth_enrol();
create function erp.staff_identity_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if new.role is distinct from 'elhelw_staff' or new.raw_app_meta_data->>'elhelw_staff' is distinct from 'true' then raise exception 'Cannot change staff identity type';end if;return new;
end $$;
create trigger elhelw_preserve_staff_identity before update of role,raw_app_meta_data on auth.users for each row when(old.raw_app_meta_data->>'elhelw_staff'='true') execute function erp.staff_identity_guard();

create or replace function erp.has_permission(p_code text) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select enabled and p_code=any(permissions) from erp.staff_accounts where user_id=auth.uid()),
 (select allowed from erp.user_permissions where user_id=auth.uid() and permission_code=p_code),
 exists(select from erp.user_roles ur join erp.role_permissions rp on rp.role_id=ur.role_id where ur.user_id=auth.uid() and rp.permission_code=p_code)) and auth.uid() is not null
$$;
create function erp.setup_capability(task text) returns text language sql immutable set search_path='' as $$
 select case when task in ('supplier','item','item_unit') then 'purchases.catalog' when task in ('recipe','planning_recipe') then 'manufacturing.recipes'
 when task in ('account','treasury','period','posting_account') then 'finance.setup' else 'setup.configure' end
$$;

create or replace function erp.configure(p_action text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare obj uuid; part record; recipe uuid; version0 uuid; line jsonb; pos integer:=0;
begin
 if not erp.has_permission('setup.configure') and not(p_action in ('item','item_unit') and erp.has_permission('manufacturing.recipes')) then perform erp.require_permission(erp.setup_capability(p_action)); end if;
 case p_action
 when 'account' then
  insert into erp.accounts(code,name,kind) values(p->>'code',p->>'name',p->>'kind') returning id into obj;
 when 'route' then
  if not exists(select from erp.channels where id=(p->>'channel')::uuid and fulfillment='distributor')
   or not exists(select from erp.treasuries where id=(p->>'treasury')::uuid and active and kind='advance') then raise exception 'Distributor channel and dedicated custody account required'; end if;
  insert into erp.distributor_routes values((p->>'distributor')::uuid,p->>'name',(p->>'channel')::uuid,(p->>'treasury')::uuid);
 when 'commission' then
  insert into erp.channel_commissions values((p->>'channel')::uuid,(p->>'item')::uuid,now(),p->>'kind',(p->>'rate')::numeric);
 when 'pay_component' then
  insert into erp.payroll_accounts(component,kind,account_id,payable_id) values(p->>'name',p->>'kind',(p->>'account')::uuid,(p->>'payable')::uuid);
 when 'posting_account' then
  if (p->>'purpose') not in ('opening_equity','goods_received_unbilled','freight_clearing','payables','cogs','receivables','sales','direct_absorption','overhead_absorption','abnormal_loss','payroll_payable','commission_expense','commission_payable','maintenance_expense','maintenance_clearing') then raise exception 'Invalid account purpose'; end if;
  insert into erp.posting_accounts values(p->>'purpose',(p->>'account')::uuid) on conflict(purpose) do update set account_id=excluded.account_id;
 when 'period' then
  insert into erp.fiscal_periods(starts_on,ends_on) values((p->>'start')::date,(p->>'end')::date) returning id into obj;
 when 'location' then
  insert into erp.locations(code,name,kind) values(p->>'code',p->>'name',p->>'kind') returning id into obj;
 when 'item' then
  insert into erp.items(sku,name,kind,base_unit,net_weight_kg,inventory_account_id,shelf_life_days)
   values(p->>'code',p->>'name',p->>'kind',p->>'unit',(p->>'weight')::numeric,(p->>'account')::uuid,(p->>'days')::integer) returning id into obj;
 when 'item_unit' then
  if not exists(select from erp.items where id=(p->>'item')::uuid and base_unit<>(p->>'unit') and active) then raise exception 'Conversion must use an alternate unit';end if;
  insert into erp.item_units values((p->>'item')::uuid,p->>'unit',(p->>'factor')::numeric)
   on conflict(item_id,unit_code) do update set factor_to_base=excluded.factor_to_base;
 when 'mapping' then
  insert into erp.legacy_item_map values(p->>'source_table',p->>'source_key',(p->>'item')::uuid);
 when 'supplier' then
  insert into erp.suppliers(code,name,legacy_id) values(p->>'code',p->>'name',(p->>'legacy_id')::uuid) returning id into obj;
 when 'customer' then
  insert into erp.customers(code,name,legacy_cafe_id) values(p->>'code',p->>'name',(p->>'legacy_id')::uuid) returning id into obj;
 when 'channel' then
  if not exists(select from erp.locations where id=(p->>'location')::uuid and kind='channel' and active) then raise exception 'Channel location required'; end if;
  insert into erp.channels(code,name,location_id,fulfillment) values(p->>'code',p->>'name',(p->>'location')::uuid,p->>'kind') returning id into obj;
 when 'price_list' then
  insert into erp.price_lists(code,name,channel_id) values(p->>'code',p->>'name',(p->>'channel')::uuid) returning id into obj;
 when 'price' then
  insert into erp.price_list_lines(list_id,item_id,price,effective_from)
   values((p->>'list_id')::uuid,(p->>'item')::uuid,(p->>'price')::numeric,coalesce((p->>'effective')::timestamptz,now())) returning id into obj;
 when 'treasury' then
  insert into erp.treasuries(account_id,name,kind) values((p->>'account')::uuid,p->>'name',p->>'kind') returning id into obj;
 when 'replenishment' then
  insert into erp.replenishment_rules values((p->>'item')::uuid,(p->>'location')::uuid,(p->>'safety')::numeric,(p->>'reorder')::numeric,(p->>'target')::numeric,(p->>'maximum')::numeric,(p->>'lead')::integer)
   on conflict(item_id,location_id) do update set safety_stock=excluded.safety_stock,reorder_point=excluded.reorder_point,target_stock=excluded.target_stock,maximum_stock=excluded.maximum_stock,lead_days=excluded.lead_days;
 when 'approval_rule' then
  if jsonb_typeof(p->'steps') is distinct from 'array' or jsonb_array_length(p->'steps')=0 then raise exception 'Approval steps required'; end if;
  insert into erp.approval_rules(document_type,minimum_amount) values('purchase',(p->>'minimum')::numeric) returning id into obj;
  for line in select * from jsonb_array_elements(p->'steps') loop
   pos:=pos+1;
   insert into erp.approval_rule_steps values(obj,pos,(line->>'role')::uuid);
  end loop;
 when 'planning_recipe' then
  if not exists(select from erp.bom_versions v join erp.boms b on b.id=v.bom_id where v.id=(p->>'recipe')::uuid and v.status='approved' and b.output_item_id=(p->>'item')::uuid) then raise exception 'Approved recipe for this output required';end if;
  insert into erp.planning_recipes values((p->>'item')::uuid,(p->>'location')::uuid,(p->>'recipe')::uuid)
   on conflict(item_id,location_id) do update set version_id=excluded.version_id;
 when 'recipe' then
  if jsonb_typeof(p->'components') is distinct from 'array' or jsonb_array_length(p->'components')=0 then raise exception 'Components required'; end if;
  insert into erp.boms(code,name,output_item_id) values(p->>'code',p->>'name',(p->>'item')::uuid) returning id into recipe;
  insert into erp.bom_versions(bom_id,version,output_quantity) values(recipe,1,(p->>'qty')::numeric) returning id into version0;
  insert into erp.manufacturing_policy values(version0,p->>'stage',coalesce((p->>'overhead')::boolean,false),(p->>'loss')::numeric);
  insert into erp.bom_components(version_id,item_id,quantity,stage) select version0,item,qty,p->>'stage' from jsonb_to_recordset(p->'components') x(item uuid,qty numeric);
  update erp.bom_versions set status='approved' where id=version0;
  obj:=version0;
 else raise exception 'Unknown setup operation';
 end case;
 return jsonb_build_object('id',obj);
end $$;

create or replace function erp.guided_workspace() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare w jsonb:=erp.workspace(); caps jsonb:=w->'permissions'; c jsonb:=w->'choices'; flow jsonb:='{}';
begin
 if caps ?| array['setup.configure','purchases.manage','purchases.catalog'] then
   c:=c||jsonb_build_object('catalog',coalesce((select jsonb_agg(jsonb_build_object('id',id,'label',name,'unit',base_unit,'kind',kind) order by name,sku) from erp.items where active),'[]'::jsonb),
     'quotes',coalesce((select jsonb_agg(jsonb_build_object('supplier',q.supplier_id,'item',q.item_id,'price',q.unit_price,'name',i.name,'unit',i.base_unit,'supplier_name',s.name) order by s.name,i.name)
       from erp.supplier_quotes q join erp.suppliers s on s.id=q.supplier_id and s.active join erp.items i on i.id=q.item_id and i.active),'[]'::jsonb));
 end if;
 if caps ?| array['purchases.manage','purchases.approve','setup.configure'] then
   flow:=flow||jsonb_build_object('rules',exists(select from erp.approval_rules r join erp.approval_rule_steps s on s.rule_id=r.id where r.active and r.document_type='purchase' and r.minimum_amount=0),
     'pending_approval',exists(select from erp.purchase_orders where status='pending'));
 end if;
 if caps ?| array['purchases.receive','manufacturing.post','setup.configure'] then
   flow:=flow||jsonb_build_object('period',exists(select from erp.fiscal_periods where status='open' and current_date between starts_on and ends_on));
 end if;
 if caps ?| array['quality.configure','quality.inspect'] then
   c:=c||jsonb_build_object('spec_coverage',coalesce((select jsonb_agg(jsonb_build_object('stage',stage,'item',item_id)) from erp.quality_specs where active and mandatory),'[]'::jsonb),
     'inspection_lots',coalesce((select jsonb_agg(jsonb_build_object('lot',l.id,'item',l.item_id,'stage',coalesce(o.stage,'receipt'))) from erp.lots l left join erp.operations o on o.id=l.producing_operation_id where l.quality_status in ('pending','quarantine')),'[]'::jsonb));
 end if;
 if caps ? 'manufacturing.post' then
   flow:=flow||jsonb_build_object('produced',exists(select from erp.operations where status='completed'));
 end if;
 if caps ?| array['purchases.catalog','manufacturing.recipes'] then
   c:=c||jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'label',sku||' · '||name) order by sku) from erp.items where active),'[]'::jsonb));
   if not(c ? 'accounts') then c:=c||jsonb_build_object('accounts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'label',code||' · '||name) order by code) from erp.accounts where active and posting_allowed and kind='asset'),'[]'::jsonb));end if;
 end if;
 if caps ? 'purchases.catalog' and not(c ? 'suppliers') then c:=c||jsonb_build_object('suppliers',coalesce((select jsonb_agg(jsonb_build_object('id',id,'label',name) order by name) from erp.suppliers where active),'[]'::jsonb));end if;
 if caps ? 'manufacturing.recipes' then c:=c||jsonb_build_object('recipes',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'label',b.name||' · v'||v.version) order by b.name) from erp.bom_versions v join erp.boms b on b.id=v.bom_id where v.status='approved'),'[]'::jsonb),'locations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'label',name) order by name) from erp.locations where active),'[]'::jsonb));end if;
 if caps ? 'finance.setup' and not(c ? 'accounts') then c:=c||jsonb_build_object('accounts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'label',code||' · '||name) order by code) from erp.accounts where active and posting_allowed),'[]'::jsonb));end if;
 return w||jsonb_build_object('choices',c,'flow',flow,'can_manage_staff',erp.staff_owner(auth.uid()));
end $$;

create or replace function erp.guided_command(p_action text,p_payload jsonb,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); receipt erp.command_receipts%rowtype; vendor uuid; material uuid; cost numeric; quoted numeric;
 line jsonb; lines jsonb:='[]'; outcome jsonb;
begin
 if p_action not in ('supplier_quote','purchase_quoted') then return erp.command(p_action,p_payload,p_request); end if;
 perform erp.require_permission(case when p_action='supplier_quote' then case when erp.has_permission('setup.configure') then 'setup.configure' else 'purchases.catalog' end else 'purchases.manage' end);
 if p_request is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid request'; end if;
 insert into erp.command_receipts(actor_id,request_id,action,payload) values(actor,p_request,p_action,p_payload) on conflict do nothing;
 select * into strict receipt from erp.command_receipts where actor_id=actor and request_id=p_request for update;
 if receipt.action<>p_action or receipt.payload<>p_payload then raise exception 'Request key belongs to a different command'; end if;
 if receipt.result is not null then return receipt.result; end if;
 vendor:=(p_payload->>'supplier')::uuid;
 perform id from erp.suppliers where id=vendor and active for share;
 if not found then raise exception 'اختر مورّدًا نشطًا'; end if;
 if p_action='supplier_quote' then
   material:=(p_payload->>'item')::uuid; cost:=(p_payload->>'price')::numeric;
   perform id from erp.items where id=material and active for share;
   if not found or cost is null or cost<0 or cost<>round(cost,8) or cost::text in ('Infinity','NaN') then raise exception 'راجع الخامة وسعر الوحدة'; end if;
   insert into erp.supplier_quotes values(vendor,material,cost,now()) on conflict(supplier_id,item_id) do update set unit_price=excluded.unit_price,updated_at=excluded.updated_at;
   outcome:=to_jsonb(true);
 else
   if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines')=0 then raise exception 'أضف خامة إلى الطلبية'; end if;
   for line in select value from jsonb_array_elements(p_payload->'lines') order by value->>'item' loop
     select unit_price into quoted from erp.supplier_quotes where supplier_id=vendor and item_id=(line->>'item')::uuid for share;
     if not found or quoted is distinct from (line->>'price')::numeric then raise exception 'سعر المورد اتغير أو غير مسجل. افتح الطلبية من جديد لمراجعة السعر.'; end if;
     lines:=lines||jsonb_build_array(jsonb_build_object('item',line->>'item','qty',line->>'qty','price',quoted));
   end loop;
   outcome:=to_jsonb(erp.create_purchase(vendor,p_payload->>'code',lines));
 end if;
 update erp.command_receipts set result=outcome where actor_id=actor and request_id=p_request;
 insert into erp.audit_log(actor_id,action,entity_type,entity_id,after_data) values(actor,p_action,'command',p_request::text,outcome);
 return outcome;
end $$;
create function public.elhelw_staff_manage(p_op text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); req erp.staff_requests%rowtype; employee erp.staff_accounts%rowtype; rights text[]; output jsonb;
begin
 if not erp.staff_owner(actor) then raise exception 'إدارة الموظفين لمسؤولي النظام فقط' using errcode='42501';end if;
 if p_op='list' then
  select coalesce(jsonb_agg(jsonb_build_object('id',s.user_id,'name',s.full_name,'email',u.email,'permissions',s.permissions,'enabled',s.enabled,'revision',s.revision) order by s.full_name,s.user_id),'[]') into output from erp.staff_accounts s join auth.users u on u.id=s.user_id;
  return output;
 elsif p_op='prepare' then
  rights:=erp.staff_rights(p->'permissions');
  if cardinality(rights)=0 or nullif(trim(p->>'name'),'') is null or length(trim(p->>'name'))>120 or coalesce(trim(p->>'email'),'')!~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'راجع الاسم والبريد والصلاحيات';end if;
  insert into erp.staff_requests(request_id,manager,email,full_name,permissions) values((p->>'request')::uuid,actor,lower(trim(p->>'email')),trim(p->>'name'),rights) on conflict do nothing;
  select * into strict req from erp.staff_requests where request_id=(p->>'request')::uuid for update;
  if req.manager<>actor or req.email<>lower(trim(p->>'email')) or req.full_name<>trim(p->>'name') or req.permissions<>rights then raise exception 'مفتاح الطلب مستخدم لحساب مختلف';end if;
  return jsonb_build_object('created',exists(select from erp.staff_accounts where request_id=req.request_id));
 elsif p_op='update' then
  rights:=erp.staff_rights(p->'permissions');
  select * into strict employee from erp.staff_accounts where user_id=(p->>'id')::uuid for update;
  if employee.revision is distinct from (p->>'revision')::int then raise exception 'الصلاحيات اتعدلت. حدّث القائمة وافتح الموظف من جديد.';end if;
  update erp.staff_accounts set permissions=rights,enabled=(p->>'enabled')::boolean,revision=revision+1 where user_id=employee.user_id;
  perform erp.staff_reviewer(employee.user_id,rights,(p->>'enabled')::boolean);
  insert into erp.audit_log(actor_id,action,entity_type,entity_id,before_data,after_data) values(actor,'staff.update','staff',employee.user_id::text,to_jsonb(employee.permissions),jsonb_build_object('permissions',rights,'enabled',p->'enabled'));
  return to_jsonb(true);
 end if;
 raise exception 'Unknown staff operation';
end $$;

-- Preflight before loading any document. The posting functions also check the permission for the actual document/channel.
create function erp.staff_command_allowed(task text, rights text[]) returns boolean language sql immutable set search_path='' as $$
select case
 when task in ('sale_cancel','sale_deliver','sale_return') then rights && array['sales.manage','distribution.manage']
 when task in ('setup.item','setup.item_unit') then rights && array['purchases.catalog','manufacturing.recipes']
 when task like 'setup.%' then erp.setup_capability(substr(task,7))=any(rights)
 else (case
  when task='supplier_quote' then 'purchases.catalog'
  when task in ('purchase_quoted','purchase_submit','purchase_bill') then 'purchases.manage'
  when task='purchase_decide' then 'purchases.approve' when task='purchase_receive' then 'purchases.receive'
  when task in ('operation_new','linked_order','operation_finish') then 'manufacturing.post'
  when task in ('component_plan','plan') then 'planning.run'
  when task in ('spec','spec_retire') then 'quality.configure'
  when task in ('inspect_start','inspect_record') then 'quality.inspect'
  when task='inspect_release' then 'quality.release' when task='transfer' then 'inventory.transfer'
  when task='sale_new' then 'sales.manage'
  when task in ('distribution_new','distribution_collect','distribution_remit','distribution_refund') then 'distribution.manage'
  when task in ('settle','finance.journal','finance.reverse','finance.treasury_transfer') then 'finance.post'
  when task='finance.close' then 'finance.close'
  when task in ('freight_bill','finance.open_cost','finance.overhead','finance.close_cost') then 'costing.manage'
  when task in ('hr.employee','hr.contract','hr.attendance','hr.clock_out','hr.leave','hr.leave_decide') then 'hr.manage'
  when task='hr.payroll_prepare' then 'payroll.prepare' when task='hr.payroll_post' then 'payroll.approve'
  when task in ('asset.asset','asset.depreciate') then 'assets.manage'
  when task in ('asset.plan','asset.open','asset.complete') then 'maintenance.manage'
 end)=any(rights) end
$$;
revoke all on function erp.staff_command_allowed(text,text[]) from public,anon,authenticated;

-- Only the edge service may supply the actor, after verifying the Auth access token.
create function public.elhelw_staff_run(p_actor uuid,p_op text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare employee erp.staff_accounts%rowtype; request_key uuid; prior record;
begin
 select * into strict employee from erp.staff_accounts where user_id=p_actor for share;
 if not employee.enabled then raise exception 'تم إيقاف الوصول. راجع مسؤول النظام.' using errcode='42501';end if;
 perform set_config('request.jwt.claim.sub',p_actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor,'role','elhelw_staff')::text,true);
 if p_op='status' then return jsonb_build_object('revision',employee.revision);end if;
 if p_op='workspace' then return erp.guided_workspace()||jsonb_build_object('staff_name',employee.full_name,'staff_revision',employee.revision); end if;
 if p_op='command' then
  if erp.staff_command_allowed(p->>'p_action',employee.permissions) is not true then raise exception 'لا توجد صلاحيات تنفيذ' using errcode='42501';end if;
  request_key:=(p->>'p_request')::uuid;
  -- A retry may use its stored result only while the employee still has the same access revision.
  insert into erp.staff_retries values(p_actor,request_key,employee.revision) on conflict do nothing;
  select revision into prior from erp.staff_retries where user_id=p_actor and request_id=request_key;
  if prior.revision<>employee.revision then raise exception 'تغيرت الصلاحيات. افتح العملية من جديد.' using errcode='42501';end if;
  return erp.guided_command(p->>'p_action',p->'p_payload',request_key);
 end if;
 raise exception 'Unknown staff operation';
end $$;
create table erp.staff_retries(user_id uuid references erp.staff_accounts on delete cascade,request_id uuid,revision int not null,primary key(user_id,request_id));
alter table erp.staff_retries enable row level security;
revoke all on table erp.staff_accounts,erp.staff_requests,erp.staff_retries from public,anon,authenticated;
revoke all on function erp.staff_owner(uuid),erp.staff_rights(jsonb),erp.staff_reviewer(uuid,text[],boolean),erp.staff_auth_enrol(),erp.staff_identity_guard(),erp.setup_capability(text) from public,anon,authenticated;
revoke all on function public.elhelw_staff_manage(text,jsonb),public.elhelw_staff_run(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.elhelw_staff_manage(text,jsonb) to authenticated;
grant execute on function public.elhelw_staff_run(uuid,text,jsonb) to service_role;
commit;
