-- Internal draft: atomic receipt/issue with journal, restricted to trusted callers.
begin;
alter table erp.items add column inventory_account_id uuid references erp.accounts;
create function erp.post_stock_value(p_document uuid,p_item uuid,p_lot uuid,p_location uuid,p_delta numeric,p_receipt_value numeric,p_offset_account uuid,p_period uuid,p_date date) returns uuid language plpgsql set search_path='' as $$
declare d erp.stock_documents%rowtype; v erp.item_valuation%rowtype; q numeric; r numeric; amount numeric; j uuid; a uuid;
begin
if p_delta is null or p_delta=0 or p_delta<>round(p_delta,6) then raise exception 'Invalid quantity'; end if;
select * into d from erp.stock_documents where id=p_document for update;
if not found or d.status<>'draft' or d.reversal_of is not null or d.source_type not in ('purchase_receipt','opening_stock','sale_issue','sale_return') then raise exception 'Invalid document'; end if;
if (d.source_type='sale_issue')<>(p_delta<0) then raise exception 'Invalid movement direction'; end if;
perform id from erp.fiscal_periods where id=p_period and status='open' and p_date between starts_on and ends_on for share;
if not found then raise exception 'Invalid fiscal period'; end if;
if exists(select 1 from erp.stock_moves where document_id=p_document) then raise exception 'Already has moves'; end if;
if exists(select from erp.items where id=p_item and base_unit='EA' and trunc(p_delta)<>p_delta) then raise exception 'Whole pieces required'; end if;
select inventory_account_id into a from erp.items where id=p_item and active for share;
if a is null or p_offset_account is null or a=p_offset_account then raise exception 'Invalid accounts'; end if;
insert into erp.item_valuation values(p_item,0,0) on conflict do nothing;
select * into v from erp.item_valuation where item_id=p_item for update;
perform id from erp.lots where id=p_lot and item_id=p_item and (p_delta>0 or (quality_status='released' and (expires_on is null or expires_on>=current_date))) for share;
if not found then raise exception 'Invalid lot'; end if;
perform id from erp.locations where id=p_location and active and (kind in ('storage','channel','quarantine') or (kind='custody' and d.source_type='opening_stock')) and (p_delta>0 or kind<>'quarantine') for share;
if not found then raise exception 'Invalid location'; end if;
insert into erp.stock_balances values(p_item,p_lot,p_location,0) on conflict do nothing;
select quantity into q from erp.stock_balances where item_id=p_item and lot_id=p_lot and location_id=p_location for update;
if p_delta<0 then
 select coalesce(sum(quantity),0) into r from erp.reservations where item_id=p_item and lot_id=p_lot and location_id=p_location and status='active';
 if q-r< -p_delta or v.quantity< -p_delta then raise exception 'Insufficient stock'; end if;
 select issue_value into amount from erp.calculate_issue_value(v.quantity,v.total_value,-p_delta);
 amount:=-amount;
else
 if p_receipt_value is null or p_receipt_value<0 or p_receipt_value<>round(p_receipt_value,8) then raise exception 'Invalid receipt value'; end if;
 amount:=p_receipt_value;
end if;
update erp.stock_balances set quantity=quantity+p_delta where item_id=p_item and lot_id=p_lot and location_id=p_location;
update erp.item_valuation set quantity=quantity+p_delta,total_value=total_value+amount where item_id=p_item;
insert into erp.stock_moves(document_id,item_id,lot_id,location_id,quantity_delta,value_delta) values(p_document,p_item,p_lot,p_location,p_delta,amount);
if amount<>0 then
 insert into erp.journal_entries(period_id,entry_date,source_type,source_id,idempotency_key,description) values(p_period,p_date,'stock',p_document::text,'stock:'||p_document::text,'Stock movement') returning id into j;
 insert into erp.journal_lines(entry_id,account_id,debit,credit) values(j,a,greatest(amount,0),greatest(-amount,0)),(j,p_offset_account,greatest(-amount,0),greatest(amount,0));
 update erp.journal_entries set status='posted' where id=j;
end if;
update erp.stock_documents set status='posted',posted_at=now() where id=p_document;
return j;
end $$;
revoke all on function erp.post_stock_value(uuid,uuid,uuid,uuid,numeric,numeric,uuid,uuid,date) from public,anon,authenticated;
commit;
-- Not ready for deployment: source-specific validation, zero-value period validation,
-- reservation consumption, multi-line documents, authorization, reversals and tests pending.
