begin;
alter table erp.lots add column received_at timestamptz not null default clock_timestamp();
-- Use receipt time for FIFO, with dated lots sorted by FEFO before undated ones.
create or replace function erp.suggest_lots(p_item uuid,p_location uuid,p_quantity numeric)
returns table(lot_id uuid,lot_code text,expires_on date,available numeric,suggested numeric)
language sql stable set search_path='' as $$
 with eligible as (
  select l.id,l.lot_code,l.expires_on,l.received_at,
    b.quantity-coalesce((select sum(r.quantity) from erp.reservations r where (r.item_id,r.lot_id,r.location_id)=(b.item_id,b.lot_id,b.location_id) and r.status='active'),0) qty
  from erp.stock_balances b join erp.lots l on l.id=b.lot_id join erp.locations loc on loc.id=b.location_id
  where b.item_id=p_item and b.location_id=p_location and loc.active and l.quality_status='released' and (l.expires_on is null or l.expires_on>=current_date)
 ), ranked as (
  select *,coalesce(sum(qty) over(order by expires_on nulls last,received_at,id rows between unbounded preceding and 1 preceding),0) prior
  from eligible where qty>0
 )
 select id,ranked.lot_code,ranked.expires_on,qty,least(qty,p_quantity-prior) from ranked where p_quantity>0 and prior<p_quantity
 order by ranked.expires_on nulls last,received_at,id
$$;
create function erp.allocate_order_line(p_line uuid,p_location uuid) returns void language plpgsql set search_path='' as $$
declare line erp.sales_order_lines%rowtype; allocated numeric:=0; lot record;
begin
 select * into strict line from erp.sales_order_lines where id=p_line for update;
 perform id from erp.items where id=line.item_id for update;
 for lot in select * from erp.suggest_lots(line.item_id,p_location,line.quantity) loop
  perform erp.reserve_lot(line.item_id,lot.lot_id,p_location,lot.suggested,'sales_line',p_line::text);
  allocated:=allocated+lot.suggested;
 end loop;
 if allocated<>line.quantity then raise exception 'Insufficient stock in the selected sales channel'; end if;
end $$;
create function erp.consume_allocation(p_line uuid,p_lot uuid,p_location uuid,p_qty numeric) returns void language plpgsql set search_path='' as $$
declare r erp.reservations%rowtype; left_qty numeric:=p_qty; portion numeric; item uuid;
begin
 select item_id into strict item from erp.sales_order_lines where id=p_line;
 perform item_id from erp.stock_balances where (item_id,lot_id,location_id)=(item,p_lot,p_location) for update;
 for r in select * from erp.reservations where source_type='sales_line' and source_id=p_line::text and lot_id=p_lot and location_id=p_location and status='active' order by id for update loop
  portion:=least(left_qty,r.quantity);
  if portion<r.quantity then
   update erp.reservations set quantity=r.quantity-portion where id=r.id;
   insert into erp.reservations(item_id,lot_id,location_id,quantity,source_type,source_id,status)
     values(item,p_lot,p_location,portion,'sales_line',p_line::text,'consumed');
  else update erp.reservations set status='consumed' where id=r.id; end if;
  left_qty:=left_qty-portion;
  exit when left_qty=0;
 end loop;
 if left_qty<>0 then raise exception 'Selected lot has insufficient allocation for this order'; end if;
end $$;
create function erp.cancel_sale(p_order uuid) returns void language plpgsql set search_path='' as $$
declare o erp.sales_orders%rowtype; r record;
begin
 select * into strict o from erp.sales_orders where id=p_order for update;
 perform erp.require_permission(case when o.distributor_id is null then 'sales.manage' else 'distribution.manage' end);
 if o.status='cancelled' then return; end if;
 if o.status not in ('draft','confirmed') or exists(select from erp.deliveries where order_id=p_order) then raise exception 'Delivered quantities require a credit note'; end if;
 for r in select a.id from erp.reservations a join erp.sales_order_lines l on l.id::text=a.source_id
    where source_type='sales_line' and l.order_id=p_order and a.status='active' order by a.item_id,a.lot_id,a.location_id,a.id loop perform erp.release_reservation(r.id); end loop;
 update erp.sales_orders set status='cancelled' where id=p_order;
end $$;
insert into erp.permissions values ('planning.run','Run replenishment planning');
create function erp.run_plan(p_horizon date) returns uuid language plpgsql set search_path='' as $$
declare run uuid;
begin
 perform erp.require_permission('planning.run');
 if p_horizon is null or p_horizon<current_date then raise exception 'Invalid planning horizon'; end if;
 insert into erp.planning_runs(horizon_end) values(p_horizon) returning id into run;
 insert into erp.planning_suggestions(run_id,item_id,location_id,kind,quantity,required_on)
  select run,rule.item_id,rule.location_id,
   case when exists(select from erp.boms b join erp.bom_versions v on v.bom_id=b.id and v.status='approved' where b.output_item_id=rule.item_id) then 'manufacture' else 'purchase' end,
   rule.target_stock-available.qty,greatest(current_date,p_horizon-rule.lead_days)
  from erp.replenishment_rules rule join erp.items i on i.id=rule.item_id and i.active join erp.locations loc on loc.id=rule.location_id and loc.active
  cross join lateral (select coalesce(sum(a.available),0) qty from erp.suggest_lots(rule.item_id,rule.location_id,1e30) a) available
  where available.qty<=rule.reorder_point and rule.target_stock>available.qty;
 return run;
end $$;
revoke all on function erp.allocate_order_line(uuid,uuid),erp.consume_allocation(uuid,uuid,uuid,numeric),erp.cancel_sale(uuid),erp.run_plan(date) from public,anon,authenticated;
commit;
