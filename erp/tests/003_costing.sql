begin;
do $$
declare r record; a numeric[];
begin
select * into r from erp.calculate_operation_cost(25000,800,1200,80,0);
if r.output_value<>27000 or r.unit_cost<>337.5 or r.abnormal_expense<>0 then raise exception 'Manufacturing cost mismatch'; end if;
select * into r from erp.calculate_operation_cost(25000,800,1200,80,1000);
if r.output_value<>26000 or r.unit_cost<>325 or r.abnormal_expense<>1000 then raise exception 'Abnormal loss mismatch'; end if;
select array_agg(allocated order by line_no) into a from erp.allocate_cost_by_weight(6000,array[100,60,40]::numeric[]);
if a is distinct from array[3000,1800,1200]::numeric[] then raise exception 'Landed cost mismatch'; end if;
if (select sum(allocated) from erp.allocate_cost_by_weight(1,array[1,1,1]::numeric[]))<>1 then raise exception 'Rounding mismatch'; end if;
end $$;
rollback;
