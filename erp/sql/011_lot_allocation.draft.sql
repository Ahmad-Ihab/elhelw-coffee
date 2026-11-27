-- Draft allocation suggestion, read-only; not a reservation.
begin;
create function erp.suggest_lots(p_item uuid,p_location uuid,p_quantity numeric)
returns table(lot_id uuid,lot_code text,expires_on date,available numeric,suggested numeric)
language sql stable set search_path='' as $$
with eligible as (
 select l.id,l.lot_code,l.expires_on,l.manufactured_on,
 b.quantity-coalesce((select sum(r.quantity) from erp.reservations r where r.item_id=b.item_id and r.lot_id=b.lot_id and r.location_id=b.location_id and r.status='active'),0) as qty
 from erp.stock_balances b join erp.lots l on l.id=b.lot_id
 join erp.locations loc on loc.id=b.location_id
 where b.item_id=p_item and b.location_id=p_location and loc.active and l.quality_status='released' and (l.expires_on is null or l.expires_on>=current_date)
), ranked as (
 select *,coalesce(sum(qty) over(order by expires_on nulls last,manufactured_on nulls last,id rows between unbounded preceding and 1 preceding),0) prior
 from eligible where qty>0
)
select id,ranked.lot_code,ranked.expires_on,qty,least(qty,p_quantity-prior)
from ranked where p_quantity>0 and prior<p_quantity
order by ranked.expires_on nulls last,manufactured_on nulls last,id;
$$;
revoke all on function erp.suggest_lots(uuid,uuid,numeric) from public,anon,authenticated;
commit;
-- Undated FIFO currently uses manufacture date; receipt timestamp/sequence needed
-- for true FIFO where manufacture date is missing or differs from receipt order.
-- Caller must verify total suggested quantity; reservation requires locking and recheck.
