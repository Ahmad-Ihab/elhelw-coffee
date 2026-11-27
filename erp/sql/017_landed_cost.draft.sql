-- Draft purchasing landed cost allocation by physical weight.
begin;
create function erp.allocate_cost_by_weight(p_amount numeric,p_weights numeric[])
returns table(line_no integer,allocated numeric)
language plpgsql immutable set search_path='' as $$
declare total numeric; remaining numeric; n integer; k integer; cumulative numeric:=0; previous numeric:=0;
begin
n:=cardinality(p_weights);
if p_amount is null or p_amount<0 or p_amount<>round(p_amount,8) or n is null or n=0 or array_ndims(p_weights)<>1 or array_lower(p_weights,1)<>1 then raise exception 'Invalid allocation inputs'; end if;
if exists(select 1 from unnest(p_weights) w where w is null or w<=0) then raise exception 'Invalid allocation weight'; end if;
select sum(w) into total from unnest(p_weights) w;
for k in 1..n loop
 cumulative:=cumulative+p_weights[k];
 remaining:=round(p_amount*cumulative/total,8);
 line_no:=k; allocated:=remaining-previous; previous:=remaining; return next;
end loop;
end $$;
revoke all on function erp.allocate_cost_by_weight(numeric,numeric[]) from public,anon,authenticated;
commit;
