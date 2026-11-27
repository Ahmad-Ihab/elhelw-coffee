-- Draft internal stock transfer engine. Depends on 001–009.
-- Only same-item, same-lot internal transfers; no purchase, sale or production posting.
begin;
create function erp.post_internal_transfer(p_document uuid,p_item uuid,p_lot uuid,p_from uuid,p_to uuid,p_quantity numeric)
returns void language plpgsql set search_path='' as $$
declare d erp.stock_documents%rowtype; l erp.lots%rowtype; v erp.item_valuation%rowtype; available numeric; reserved numeric; cost numeric;
begin
if p_quantity is null or p_quantity<=0 or p_quantity<>round(p_quantity,6) or p_from is null or p_to is null or p_from=p_to then raise exception 'Invalid transfer'; end if;
select * into d from erp.stock_documents where id=p_document for update;
if not found or d.status<>'draft' or d.source_type<>'internal_transfer' or d.reversal_of is not null then raise exception 'Invalid transfer document'; end if;
if exists(select 1 from erp.stock_moves where document_id=p_document) then raise exception 'Document already has moves'; end if;
select * into v from erp.item_valuation where item_id=p_item for update;
if not found or v.quantity<p_quantity then raise exception 'Insufficient valuation quantity'; end if;
select * into l from erp.lots where id=p_lot and item_id=p_item for share;
if not found or l.quality_status<>'released' or (l.expires_on is not null and l.expires_on<current_date) then raise exception 'Lot unavailable'; end if;
perform id from erp.locations where id in (p_from,p_to) order by id for share;
if (select count(*) from erp.locations where id in (p_from,p_to) and active and kind in ('storage','channel'))<>2 then raise exception 'Invalid locations'; end if;
insert into erp.stock_balances(item_id,lot_id,location_id,quantity) values(p_item,p_lot,p_to,0) on conflict do nothing;
perform location_id from erp.stock_balances where item_id=p_item and lot_id=p_lot and location_id in(p_from,p_to) order by location_id for update;
select quantity into available from erp.stock_balances where item_id=p_item and lot_id=p_lot and location_id=p_from;
select coalesce(sum(quantity),0) into reserved from erp.reservations where item_id=p_item and lot_id=p_lot and location_id=p_from and status='active';
if available is null or available-reserved<p_quantity then raise exception 'Insufficient unreserved stock'; end if;
cost:=round(v.total_value*p_quantity/v.quantity,8);
update erp.stock_balances set quantity=quantity-p_quantity where item_id=p_item and lot_id=p_lot and location_id=p_from;
update erp.stock_balances set quantity=quantity+p_quantity where item_id=p_item and lot_id=p_lot and location_id=p_to;
insert into erp.stock_moves(document_id,item_id,lot_id,location_id,quantity_delta,value_delta) values(p_document,p_item,p_lot,p_from,-p_quantity,-cost),(p_document,p_item,p_lot,p_to,p_quantity,cost);
update erp.stock_documents set status='posted',posted_at=now() where id=p_document;
end $$;
revoke all on function erp.post_internal_transfer(uuid,uuid,uuid,uuid,uuid,numeric) from public,anon,authenticated;
commit;
-- All reservation writers must lock the same balance rows before checking availability.
-- No client access until authorization, audit, immutable ledger and concurrency tests.
-- Internal transfers preserve company-wide quantity/value; GL location dimensions pending.
