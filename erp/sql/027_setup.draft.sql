begin;
create unique index approval_threshold on erp.approval_rules(document_type,minimum_amount) where active;
create function erp.configure(p_action text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare obj uuid; part record; recipe uuid; version0 uuid; line jsonb; pos integer:=0;
begin
 perform erp.require_permission('setup.configure');
 case p_action
 when 'account' then
  insert into erp.accounts(code,name,kind) values(p->>'code',p->>'name',p->>'kind') returning id into obj;
 when 'posting_account' then
  if (p->>'purpose') not in ('opening_equity','goods_received_unbilled','payables','cogs','receivables','sales','direct_absorption','overhead_absorption','abnormal_loss') then raise exception 'Invalid account purpose'; end if;
  insert into erp.posting_accounts values(p->>'purpose',(p->>'account')::uuid) on conflict(purpose) do update set account_id=excluded.account_id;
 when 'period' then
  insert into erp.fiscal_periods(starts_on,ends_on) values((p->>'start')::date,(p->>'end')::date) returning id into obj;
 when 'location' then
  insert into erp.locations(code,name,kind) values(p->>'code',p->>'name',p->>'kind') returning id into obj;
 when 'item' then
  insert into erp.items(sku,name,kind,base_unit,net_weight_kg,inventory_account_id,shelf_life_days)
   values(p->>'code',p->>'name',p->>'kind',p->>'unit',(p->>'weight')::numeric,(p->>'account')::uuid,(p->>'days')::integer) returning id into obj;
 when 'mapping' then
  insert into erp.legacy_item_map values(p->>'source_table',p->>'source_key',(p->>'item')::uuid);
 when 'supplier' then
  insert into erp.suppliers(code,name) values(p->>'code',p->>'name') returning id into obj;
 when 'customer' then
  insert into erp.customers(code,name) values(p->>'code',p->>'name') returning id into obj;
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
 when 'approval_rule' then
  if jsonb_typeof(p->'steps') is distinct from 'array' or jsonb_array_length(p->'steps')=0 then raise exception 'Approval steps required'; end if;
  insert into erp.approval_rules(document_type,minimum_amount) values('purchase',(p->>'minimum')::numeric) returning id into obj;
  for line in select * from jsonb_array_elements(p->'steps') loop
   pos:=pos+1;
   insert into erp.approval_rule_steps values(obj,pos,(line->>'role')::uuid);
  end loop;
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

create function erp.configure_access(p_action text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare obj uuid;
begin
 perform erp.require_permission('roles.manage');
 case p_action
 when 'role' then insert into erp.roles(code,name) values(p->>'code',p->>'name') returning id into obj;
 when 'role_permission' then insert into erp.role_permissions values((p->>'role')::uuid,p->>'permission') on conflict do nothing;
 when 'assign_role' then insert into erp.user_roles values((p->>'user')::uuid,(p->>'role')::uuid) on conflict do nothing;
 when 'remove_role' then delete from erp.user_roles where user_id=(p->>'user')::uuid and role_id=(p->>'role')::uuid;
 when 'user_override' then insert into erp.user_permissions values((p->>'user')::uuid,p->>'permission',(p->>'allowed')::boolean)
  on conflict(user_id,permission_code) do update set allowed=excluded.allowed;
 else raise exception 'Unknown permission operation';
 end case;
 return jsonb_build_object('id',obj);
end $$;
revoke all on all functions in schema erp from public,anon,authenticated;
commit;
