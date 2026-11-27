begin;
alter table erp.operations add column recipe_version_id uuid references erp.bom_versions;
alter table erp.operations add column loss_kg numeric(18,6) check(loss_kg>=0);
alter table erp.operations add column output_lot_id uuid unique references erp.lots;
create table erp.manufacturing_policy (
  version_id uuid primary key references erp.bom_versions,
  stage text not null check(stage in ('blend','roast','grind','flavor','pack')),
  apply_overhead boolean not null default false,
  maximum_loss_fraction numeric not null check(maximum_loss_fraction between 0 and 1)
);
alter table erp.manufacturing_policy enable row level security;

create function erp.guard_recipe_child() returns trigger language plpgsql set search_path='' as $$
declare v uuid;
begin
  if tg_op='UPDATE' and new.version_id<>old.version_id then raise exception 'Cannot move recipe detail'; end if;
  if tg_op='DELETE' then v:=old.version_id; else v:=new.version_id; end if;
  perform id from erp.bom_versions where id=v and status='draft' for update;
  if not found then raise exception 'Recipe is frozen'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger recipe_component_guard before insert or update or delete on erp.bom_components for each row execute function erp.guard_recipe_child();
create trigger recipe_policy_guard before insert or update or delete on erp.manufacturing_policy for each row execute function erp.guard_recipe_child();
create function erp.guard_recipe_version() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.status<>'draft' then raise exception 'Create draft recipe first'; end if;
    return new;
  end if;
  if old.status<>'draft' then
    if tg_op='UPDATE' and old.status='approved' and new.status='retired' and (to_jsonb(old)-'status')=(to_jsonb(new)-'status') then return new; end if;
    raise exception 'Recipe is frozen';
  end if;
  if tg_op='DELETE' then return old; end if;
  if new.status='approved' and (not exists(select from erp.manufacturing_policy where version_id=new.id)
    or not exists(select from erp.bom_components where version_id=new.id)
    or exists(select from erp.bom_components c join erp.manufacturing_policy p using(version_id) where c.version_id=new.id and c.stage<>p.stage)) then
    raise exception 'Complete the stage recipe and policy before approval';
  end if;
  return new;
end $$;
create trigger recipe_version_guard before insert or update or delete on erp.bom_versions for each row execute function erp.guard_recipe_version();

create function erp.mass_kg(p_item erp.items,p_qty numeric) returns numeric language plpgsql immutable set search_path='' as $$
begin
  if p_item.kind='PK' then return 0; end if;
  if p_item.base_unit='KG' then return p_qty; end if;
  if p_item.base_unit='G' then return p_qty/1000; end if;
  if p_item.net_weight_kg is not null then return p_qty*p_item.net_weight_kg; end if;
  raise exception 'Mass conversion required for %',p_item.sku;
end $$;

-- All component lots are consumed and the resulting lot, genealogy, cost and GL are posted in one transaction.
create function erp.finish_operation(p_op uuid,p_output_code text,p_output_qty numeric,p_location uuid,p_inputs jsonb,p_date date,p_abnormal numeric)
returns uuid language plpgsql set search_path='' as $$
declare
  op erp.operations%rowtype; ver erp.bom_versions%rowtype; policy erp.manufacturing_policy%rowtype;
  wo erp.work_orders%rowtype; out_item erp.items%rowtype; itm erp.items%rowtype; valuation erp.item_valuation%rowtype;
  leg record; period uuid; cp erp.cost_periods%rowtype; doc uuid; output uuid; journal uuid;
  available numeric; issued numeric; material numeric:=0; input_kg numeric:=0; output_kg numeric;
  direct numeric; overhead numeric:=0; total numeric; loss numeric; ledger_account uuid; count_inputs int;
begin
  perform erp.require_permission('manufacturing.post');
  select * into strict op from erp.operations where id=p_op for update;
  if op.status not in ('draft','running') then raise exception 'Operation is not open'; end if;
  if op.work_order_id is not null then
    select * into strict wo from erp.work_orders where id=op.work_order_id and status in ('approved','running') for update;
    if exists(select from erp.operations where work_order_id=wo.id and sequence_no<op.sequence_no and status<>'completed') then raise exception 'Previous operation incomplete'; end if;
  end if;
  select * into strict ver from erp.bom_versions where id=coalesce(op.recipe_version_id,wo.version_id) and status='approved' for share;
  select * into strict policy from erp.manufacturing_policy where version_id=ver.id and stage=op.stage;
  select i.* into strict out_item from erp.boms b join erp.items i on i.id=b.output_item_id where b.id=ver.bom_id and i.active for share of b,i;
  if p_output_qty is null or p_output_qty<=0 or round(p_output_qty,6)<>p_output_qty or nullif(trim(p_output_code),'') is null
    or jsonb_typeof(p_inputs) is distinct from 'array' or jsonb_array_length(p_inputs)=0 or p_abnormal is null or p_abnormal<0 or p_abnormal<>round(p_abnormal,8)
    or (out_item.base_unit='EA' and p_output_qty<>trunc(p_output_qty)) then raise exception 'Invalid production output or inputs'; end if;
  select count(*) into count_inputs from jsonb_to_recordset(p_inputs) x(lot uuid,location uuid,qty numeric)
    join erp.lots l on l.id=x.lot join erp.items i on i.id=l.item_id
    join erp.locations loc on loc.id=x.location and loc.active and loc.kind='storage'
    where x.qty>0 and x.qty=round(x.qty,6) and (i.base_unit<>'EA' or x.qty=trunc(x.qty)) and i.active and i.inventory_account_id is not null
      and l.quality_status='released' and (l.expires_on is null or l.expires_on>=current_date)
      and exists(select from erp.bom_components c where c.version_id=ver.id and c.item_id=i.id);
  if wo.id is not null and exists(select from erp.operations where work_order_id=wo.id and sequence_no<op.sequence_no) and not exists(
    select from jsonb_to_recordset(p_inputs) x(lot uuid) where x.lot=(select output_lot_id from erp.operations where work_order_id=wo.id and sequence_no<op.sequence_no order by sequence_no desc limit 1)
  ) then raise exception 'Linked operation must consume the preceding output lot';end if;
  if count_inputs<>jsonb_array_length(p_inputs) or exists(select from erp.bom_components c where c.version_id=ver.id and
      not exists(select from jsonb_to_recordset(p_inputs) x(lot uuid) join erp.lots l on l.id=x.lot and l.item_id=c.item_id))
     or exists(select from jsonb_to_recordset(p_inputs) x(lot uuid,location uuid) group by x.lot,x.location having count(*)>1) then raise exception 'Invalid or missing recipe component'; end if;
  -- Derive batch size from total consumed quantities relative to the approved formula.
  -- Compare like units per ingredient; actual yield can vary within the separate mass-loss policy.
  if exists(
    with planned as (select item_id,sum(quantity) qty from erp.bom_components where version_id=ver.id group by item_id),
    actual as (select l.item_id,sum(x.qty) qty from jsonb_to_recordset(p_inputs) x(lot uuid,qty numeric) join erp.lots l on l.id=x.lot group by l.item_id),
    scale as (select a.qty actual,p.qty planned from planned p join actual a using(item_id) order by p.item_id limit 1)
    select from planned p join actual a using(item_id) cross join scale s where a.qty<>round(p.qty*s.actual/s.planned,6)
  ) then raise exception 'Consumption differs from approved component proportions'; end if;
  perform id from erp.locations where id=p_location and active and kind in ('storage','quarantine') for share;
  if not found or out_item.inventory_account_id is null then raise exception 'Invalid output location or account'; end if;
  period:=erp.open_period(p_date);
  insert into erp.item_valuation values(out_item.id,0,0) on conflict do nothing;
  perform item_id from erp.item_valuation where item_id=out_item.id or item_id in
    (select l.item_id from jsonb_to_recordset(p_inputs) x(lot uuid) join erp.lots l on l.id=x.lot) order by item_id for update;
  output_kg:=erp.mass_kg(out_item,p_output_qty);
  if output_kg<=0 then raise exception 'Positive output mass required'; end if;
  insert into erp.stock_documents(source_type,source_id,idempotency_key,created_by) values('manufacturing',p_op::text,'operation:'||p_op,auth.uid()) returning id into doc;
  insert into erp.lots(item_id,lot_code,manufactured_on,expires_on,producing_operation_id)
    values(out_item.id,trim(p_output_code),p_date,p_date+out_item.shelf_life_days,p_op) returning id into output;
  insert into erp.journal_entries(period_id,entry_date,source_type,source_id,idempotency_key,description,created_by)
    values(period,p_date,'manufacturing',p_op::text,'operation:'||p_op,'Production '||p_output_code,auth.uid()) returning id into journal;
  for leg in select x.*,l.item_id,l.quality_status,l.expires_on,loc.active,loc.kind from jsonb_to_recordset(p_inputs) x(lot uuid,location uuid,qty numeric)
      join erp.lots l on l.id=x.lot join erp.locations loc on loc.id=x.location order by l.item_id,x.lot,x.location for share of l,loc loop
    if leg.quality_status<>'released' or leg.expires_on<current_date or not leg.active or leg.kind<>'storage' then raise exception 'Input lot unavailable'; end if;
    select * into strict itm from erp.items where id=leg.item_id and active for share;
    select * into strict valuation from erp.item_valuation where item_id=itm.id;
    select quantity into strict available from erp.stock_balances where item_id=itm.id and lot_id=leg.lot and location_id=leg.location for update;
    select available-coalesce(sum(quantity),0) into available from erp.reservations where item_id=itm.id and lot_id=leg.lot and location_id=leg.location and status='active';
    if available<leg.qty then raise exception 'Insufficient unreserved manufacturing stock'; end if;
    select issue_value into issued from erp.calculate_issue_value(valuation.quantity,valuation.total_value,leg.qty);
    update erp.item_valuation set quantity=quantity-leg.qty,total_value=total_value-issued where item_id=itm.id;
    update erp.stock_balances set quantity=quantity-leg.qty where item_id=itm.id and lot_id=leg.lot and location_id=leg.location;
    insert into erp.stock_moves(document_id,item_id,lot_id,location_id,quantity_delta,value_delta) values(doc,itm.id,leg.lot,leg.location,-leg.qty,-issued);
    if issued>0 then insert into erp.journal_lines(entry_id,account_id,credit) values(journal,itm.inventory_account_id,issued); end if;
    material:=material+issued; input_kg:=input_kg+erp.mass_kg(itm,leg.qty);
  end loop;
  insert into erp.lot_genealogy select lot_id,output,doc,-sum(quantity_delta) from erp.stock_moves where document_id=doc group by lot_id;
  loss:=input_kg-output_kg;
  if loss<0 or loss>input_kg*policy.maximum_loss_fraction then raise exception 'Production mass outside approved tolerance'; end if;
  select coalesce(sum(amount),0) into direct from erp.operation_costs where operation_id=p_op;
  if policy.apply_overhead then
    if wo.id is not null and exists(select from erp.overhead_applications a join erp.operations o on o.id=a.operation_id where o.work_order_id=wo.id)
      then raise exception 'Overhead already absorbed for this work order'; end if;
    select * into strict cp from erp.cost_periods where period_id=period and status='open' for share;
    if cp.rate_source_period_id is not null and not exists(select from erp.cost_periods prev join erp.fiscal_periods f on f.id=prev.period_id
      join erp.fiscal_periods cur on cur.id=period where prev.id=cp.rate_source_period_id and prev.status='closed'
        and f.ends_on=cur.starts_on-1) then raise exception 'Approved prior-period overhead rate required'; end if;
    insert into erp.overhead_applications(cost_period_id,operation_id,eligible_output_kg,rate)
      values(cp.id,p_op,output_kg,cp.applied_rate_per_kg) returning applied_amount into overhead;
  end if;
  select output_value into total from erp.calculate_operation_cost(material,direct,overhead,output_kg,p_abnormal);
  if direct>0 then insert into erp.journal_lines(entry_id,account_id,credit) values(journal,erp.posting_account('direct_absorption'),direct); end if;
  if overhead>0 then insert into erp.journal_lines(entry_id,account_id,credit) values(journal,erp.posting_account('overhead_absorption'),overhead); end if;
  if p_abnormal>0 then insert into erp.journal_lines(entry_id,account_id,debit) values(journal,erp.posting_account('abnormal_loss'),p_abnormal); end if;
  if total>0 then insert into erp.journal_lines(entry_id,account_id,debit) values(journal,out_item.inventory_account_id,total); end if;
  if material+direct+overhead>0 then update erp.journal_entries set status='posted' where id=journal;
  else delete from erp.journal_entries where id=journal; end if;
  update erp.item_valuation set quantity=quantity+p_output_qty,total_value=total_value+total where item_id=out_item.id;
  insert into erp.stock_balances values(out_item.id,output,p_location,p_output_qty);
  insert into erp.stock_moves(document_id,item_id,lot_id,location_id,quantity_delta,value_delta) values(doc,out_item.id,output,p_location,p_output_qty,total);
  update erp.stock_documents set status='posted' where id=doc;
  update erp.operations set status='completed',started_at=coalesce(started_at,now()),completed_at=clock_timestamp(),stock_document_id=doc,
    loss_kg=loss,output_lot_id=output where id=p_op;
  if wo.id is not null then update erp.work_orders set status=case when exists(select from erp.operations where work_order_id=wo.id and status<>'completed')
    then 'running' else 'completed' end where id=wo.id; end if;
  return output;
end $$;
revoke all on all functions in schema erp from public,anon,authenticated;
commit;
