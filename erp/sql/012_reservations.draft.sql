-- Draft reservation engine. Internal only. Depends on 001–011.
begin;
create function erp.reserve_lot(p_item uuid,p_lot uuid,p_location uuid,p_quantity numeric,p_source_type text,p_source_id text) returns uuid language plpgsql set search_path='' as $$
declare q numeric; r numeric; result uuid;
begin
if p_quantity is null or p_quantity<=0 or p_quantity<>round(p_quantity,6) or nullif(trim(p_source_type),'') is null or nullif(trim(p_source_id),'') is null then raise exception 'Invalid reservation'; end if;
perform id from erp.lots where id=p_lot and item_id=p_item and quality_status='released' and (expires_on is null or expires_on>=current_date) for share;
if not found then raise exception 'Lot unavailable'; end if;
perform id from erp.locations where id=p_location and active for share;
if not found then raise exception 'Location unavailable'; end if;
select quantity into q from erp.stock_balances where item_id=p_item and lot_id=p_lot and location_id=p_location for update;
if not found then raise exception 'Stock unavailable'; end if;
select coalesce(sum(quantity),0) into r from erp.reservations where item_id=p_item and lot_id=p_lot and location_id=p_location and status='active';
if q-r<p_quantity then raise exception 'Insufficient available stock'; end if;
insert into erp.reservations(item_id,lot_id,location_id,quantity,source_type,source_id) values(p_item,p_lot,p_location,p_quantity,p_source_type,p_source_id) returning id into result;
return result;
end $$;
create function erp.release_reservation(p_id uuid) returns void language plpgsql set search_path='' as $$
declare r erp.reservations%rowtype;
begin
select * into r from erp.reservations where id=p_id;
if not found then raise exception 'Reservation not found'; end if;
perform 1 from erp.stock_balances where item_id=r.item_id and lot_id=r.lot_id and location_id=r.location_id for update;
update erp.reservations set status='released' where id=p_id and status='active';
if not found and exists(select 1 from erp.reservations where id=p_id and status<>'released') then raise exception 'Reservation cannot be released'; end if;
end $$;
revoke all on function erp.reserve_lot(uuid,uuid,uuid,numeric,text,text),erp.release_reservation(uuid) from public,anon,authenticated;
commit;
-- Pending: idempotent request wrapper, authorized override audit, consumption
-- linked to stock posting, partial reservation release and concurrency tests.
