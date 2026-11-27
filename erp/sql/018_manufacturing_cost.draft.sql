-- Draft manufacturing cost calculation, independent of posting.
begin;
create function erp.calculate_operation_cost(p_input_value numeric,p_direct_cost numeric,p_overhead numeric,p_output_kg numeric,p_abnormal_loss_value numeric default 0)
returns table(output_value numeric,unit_cost numeric,abnormal_expense numeric)
language plpgsql immutable set search_path='' as $$
begin
if p_input_value is null or p_direct_cost is null or p_overhead is null or p_output_kg is null or p_abnormal_loss_value is null or least(p_input_value,p_direct_cost,p_overhead,p_abnormal_loss_value)<0 or p_output_kg<=0 or p_abnormal_loss_value>p_input_value+p_direct_cost+p_overhead then raise exception 'Invalid operation cost'; end if;
output_value:=p_input_value+p_direct_cost+p_overhead-p_abnormal_loss_value;
unit_cost:=round(output_value/p_output_kg,8);
abnormal_expense:=p_abnormal_loss_value;
return next;
end $$;
revoke all on function erp.calculate_operation_cost(numeric,numeric,numeric,numeric,numeric) from public,anon,authenticated;
commit;
-- Actual posting must derive input values from locked inventory, validate overhead
-- eligibility and prevent duplicate absorption across successive stages.
