-- Inventory integration tests; isolated database only.
begin;
do $$
declare i uuid; l uuid; a uuid; b uuid; d uuid; r uuid; q numeric;
begin
insert into erp.items(sku,name,kind,base_unit) values('TEST-RM','Test beans','RM','KG') returning id into i;
insert into erp.lots(item_id,lot_code,quality_status) values(i,'TEST-LOT','released') returning id into l;
insert into erp.locations(code,name,kind) values('TEST-A','Test source','storage') returning id into a;
insert into erp.locations(code,name,kind) values('TEST-B','Test destination','channel') returning id into b;
insert into erp.item_valuation(item_id,quantity,total_value) values(i,100,25000);
insert into erp.stock_balances(item_id,lot_id,location_id,quantity) values(i,l,a,100);
r:=erp.reserve_lot(i,l,a,30,'test','1');
select sum(suggested) into q from erp.suggest_lots(i,a,100);
if q is distinct from 70::numeric then raise exception 'Reservation availability mismatch'; end if;
begin
perform erp.reserve_lot(i,l,a,71,'test','2');
raise exception 'Unexpected success';
exception when raise_exception then if sqlerrm<>'Insufficient available stock' then raise; end if;
end;
insert into erp.stock_documents(source_type,source_id,idempotency_key) values('internal_transfer','test','test:transfer') returning id into d;
perform erp.post_internal_transfer(d,i,l,a,b,60);
select quantity into q from erp.stock_balances where item_id=i and lot_id=l and location_id=a;
if q is distinct from 40::numeric then raise exception 'Source mismatch'; end if;
select quantity into q from erp.stock_balances where item_id=i and lot_id=l and location_id=b;
if q is distinct from 60::numeric then raise exception 'Destination mismatch'; end if;
select sum(value_delta) into q from erp.stock_moves where document_id=d;
if q is distinct from 0::numeric then raise exception 'Transfer value mismatch'; end if;
perform erp.release_reservation(r);
perform erp.release_reservation(r);
select sum(suggested) into q from erp.suggest_lots(i,a,100);
if q is distinct from 40::numeric then raise exception 'Release mismatch'; end if;
end $$;
rollback;
