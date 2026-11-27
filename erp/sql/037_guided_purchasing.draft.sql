begin;
create table erp.supplier_quotes (
 supplier_id uuid references erp.suppliers, item_id uuid references erp.items,
 unit_price numeric(24,8) not null check(unit_price>=0), updated_at timestamptz not null default now(),
 primary key(supplier_id,item_id)
);
alter table erp.supplier_quotes enable row level security;
revoke all on erp.supplier_quotes from public,anon,authenticated;

create function erp.guided_workspace() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare w jsonb:=erp.workspace(); caps jsonb:=w->'permissions'; c jsonb:=w->'choices'; flow jsonb:='{}';
begin
 if caps ?| array['setup.configure','purchases.manage'] then
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
 return w||jsonb_build_object('choices',c,'flow',flow);
end $$;

create function erp.guided_command(p_action text,p_payload jsonb,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); receipt erp.command_receipts%rowtype; vendor uuid; material uuid; cost numeric; quoted numeric;
 line jsonb; lines jsonb:='[]'; outcome jsonb;
begin
 if p_action not in ('supplier_quote','purchase_quoted') then return erp.command(p_action,p_payload,p_request); end if;
 perform erp.require_permission(case when p_action='supplier_quote' then 'setup.configure' else 'purchases.manage' end);
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
revoke all on function erp.guided_workspace(),erp.guided_command(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function erp.guided_workspace(),erp.guided_command(text,jsonb,uuid) to authenticated;
create or replace function public.elhelw_erp_workspace() returns jsonb language sql stable security invoker set search_path='' as $$select erp.guided_workspace()$$;
create or replace function public.elhelw_erp_command(p_action text,p_payload jsonb,p_request uuid) returns jsonb language sql security invoker set search_path='' as $$select erp.guided_command(p_action,p_payload,p_request)$$;
commit;
