-- Pure weighted-average calculations, not posting. Depends on foundation.
begin;
create function erp.calculate_receipt_value(p_old_qty numeric,p_old_value numeric,p_in_qty numeric,p_in_value numeric)
returns table(quantity numeric,total_value numeric,average_cost numeric)
language plpgsql immutable set search_path='' as $$
begin
if p_old_qty is null or p_old_value is null or p_in_qty is null or p_in_value is null or p_old_qty<0 or p_old_value<0 or p_in_qty<=0 or p_in_value<0 or (p_old_qty=0 and p_old_value<>0) then raise exception 'Invalid valuation inputs'; end if;
quantity:=p_old_qty+p_in_qty; total_value:=p_old_value+p_in_value; average_cost:=round(total_value/quantity,8); return next;
end $$;
create function erp.calculate_issue_value(p_old_qty numeric,p_old_value numeric,p_out_qty numeric)
returns table(quantity numeric,total_value numeric,issue_value numeric)
language plpgsql immutable set search_path='' as $$
begin
if p_old_qty is null or p_old_value is null or p_out_qty is null or p_old_qty<=0 or p_old_value<0 or p_out_qty<=0 or p_out_qty>p_old_qty then raise exception 'Invalid issue valuation'; end if;
quantity:=p_old_qty-p_out_qty;
issue_value:=case when quantity=0 then p_old_value else round(p_old_value*p_out_qty/p_old_qty,8) end;
total_value:=p_old_value-issue_value; return next;
end $$;
revoke all on function erp.calculate_receipt_value(numeric,numeric,numeric,numeric),erp.calculate_issue_value(numeric,numeric,numeric) from public,anon,authenticated;
commit;
-- Posting must lock valuation rows and enforce stored precision, stock/GL reconciliation.
