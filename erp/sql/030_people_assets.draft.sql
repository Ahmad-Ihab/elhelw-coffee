begin;
insert into erp.permissions values ('hr.manage','Manage employees, attendance and leave'),('payroll.prepare','Prepare employee payroll'),
 ('payroll.approve','Approve and post payroll'),('assets.manage','Maintain assets and post depreciation'),('maintenance.manage','Manage maintenance work');
alter table erp.payroll_runs add column prepared_by uuid references auth.users;
alter table erp.payroll_runs add column approved_by uuid references auth.users;
create unique index payroll_period on erp.payroll_runs(period_id) where status in ('draft','approved','posted');
create table erp.payroll_accounts(component text primary key,kind text not null check(kind in ('earning','deduction','employer_cost')),
  account_id uuid not null references erp.accounts, payable_id uuid references erp.accounts, check(kind<>'employer_cost' or payable_id is not null));
alter table erp.payroll_accounts enable row level security;
create unique index one_open_visit on erp.attendance(employee_id) where clock_out is null;
alter table erp.payroll_lines add unique(run_id,employee_id,component);
create unique index one_maintenance_ticket on erp.maintenance_orders(plan_id) where plan_id is not null and status in ('open','running');

create function erp.people_action(action text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare employee uuid:=(p->>'employee')::uuid; obj uuid; d1 date; d2 date; period erp.fiscal_periods%rowtype;
 run erp.payroll_runs%rowtype; j uuid; line record; net numeric:=0; from_time timestamptz; till_time timestamptz;
begin
 if action='payroll_prepare' then
  perform erp.require_permission('payroll.prepare');
  select * into strict period from erp.fiscal_periods where id=(p->>'period')::uuid and status='open' for share;
  if jsonb_typeof(p->'lines') is distinct from 'array' or jsonb_array_length(p->'lines')=0 then raise exception 'Approved gross and deduction lines required'; end if;
  insert into erp.payroll_runs(period_id,prepared_by) values(period.id,auth.uid()) returning id into obj;
  for line in select * from jsonb_to_recordset(p->'lines') x(employee uuid,component text,amount numeric) loop
   if not exists(select from erp.employment_terms t where t.employee_id=line.employee and t.effective_from<=period.ends_on
     and coalesce(t.effective_to,'infinity'::date)>=period.starts_on) or line.amount is null or line.amount<=0 or line.amount<>round(line.amount,8)
     then raise exception 'Payroll line requires an active contract and a positive amount'; end if;
   insert into erp.payroll_lines(run_id,employee_id,component,kind,amount) select obj,line.employee,c.component,c.kind,line.amount from erp.payroll_accounts c where c.component=line.component;
   if not found then raise exception 'Payroll component has no posting rule'; end if;
  end loop;
 elsif action='payroll_post' then
  perform erp.require_permission('payroll.approve');
  select * into strict run from erp.payroll_runs where id=(p->>'run')::uuid and status='draft' for update;
  if run.prepared_by=auth.uid() then raise exception 'Independent payroll approval required'; end if;
  select * into strict period from erp.fiscal_periods where id=run.period_id and status='open' for share;
  if exists(select from erp.payroll_lines where run_id=run.id group by employee_id
    having sum(case kind when 'earning' then amount when 'deduction' then -amount else 0 end)<0) then raise exception 'Employee net pay cannot be negative'; end if;
  insert into erp.journal_entries(period_id,entry_date,source_type,source_id,idempotency_key,description,created_by)
    values(period.id,period.ends_on,'payroll',run.id::text,'payroll:'||run.id,'Payroll',auth.uid()) returning id into j;
  for line in select l.kind,l.amount,a.account_id,a.payable_id from erp.payroll_lines l join erp.payroll_accounts a using(component,kind) where run_id=run.id loop
   if line.kind='deduction' then
    insert into erp.journal_lines(entry_id,account_id,credit) values(j,line.account_id,line.amount); net:=net-line.amount;
   else
    insert into erp.journal_lines(entry_id,account_id,debit) values(j,line.account_id,line.amount);
    if line.kind='employer_cost' then insert into erp.journal_lines(entry_id,account_id,credit) values(j,line.payable_id,line.amount);
    else net:=net+line.amount; end if;
   end if;
  end loop;
  if net>0 then insert into erp.journal_lines(entry_id,account_id,credit) values(j,erp.posting_account('payroll_payable'),net); end if;
  update erp.journal_entries set status='posted' where id=j;
  update erp.payroll_runs set status='posted',approved_by=auth.uid(),journal_entry_id=j where id=run.id; obj:=run.id;
 else
  perform erp.require_permission('hr.manage');
  if action='employee' then
   if nullif(trim(p->>'name'),'') is null then raise exception 'Employee name required'; end if;
   insert into erp.employees(code,name,hired_on) values(p->>'code',p->>'name',(p->>'date')::date) returning id into obj;
  elsif action='leave_decide' then
   if p->>'decision' is null or (p->>'decision') not in ('approved','rejected') then raise exception 'Invalid leave decision'; end if;
   update erp.leave_requests set status=p->>'decision' where id=(p->>'leave')::uuid and status='pending' returning id into strict obj;
  else
   perform id from erp.employees where id=employee and active for update;
   if not found then raise exception 'Active employee required'; end if;
   case action
   when 'contract' then
    d1:=(p->>'start')::date; d2:=(p->>'end')::date;
    if exists(select from erp.employment_terms where employee_id=employee and daterange(effective_from,effective_to,'[]') && daterange(d1,d2,'[]')) then raise exception 'Overlapping employment terms'; end if;
    insert into erp.employment_terms(employee_id,effective_from,effective_to,base_salary) values(employee,d1,d2,(p->>'salary')::numeric) returning id into obj;
   when 'attendance' then
    from_time:=(p->>'start')::timestamptz; till_time:=(p->>'end')::timestamptz;
    if exists(select from erp.attendance where employee_id=employee and tstzrange(clock_in,clock_out,'[)') && tstzrange(from_time,till_time,'[)')) then raise exception 'Overlapping attendance'; end if;
    insert into erp.attendance(employee_id,clock_in,clock_out) values(employee,from_time,till_time) returning id into obj;
   when 'clock_out' then
    update erp.attendance set clock_out=(p->>'end')::timestamptz where employee_id=employee and clock_out is null returning id into strict obj;
   when 'leave' then
    d1:=(p->>'start')::date; d2:=(p->>'end')::date;
    if exists(select from erp.leave_requests where employee_id=employee and status in ('pending','approved') and daterange(starts_on,ends_on,'[]') && daterange(d1,d2,'[]')) then raise exception 'Overlapping leave'; end if;
    insert into erp.leave_requests(employee_id,starts_on,ends_on,kind) values(employee,d1,d2,p->>'kind') returning id into obj;
   else raise exception 'Unknown HR operation'; end case;
  end if;
 end if;
 return to_jsonb(obj);
end $$;

create function erp.asset_action(action text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare asset erp.assets%rowtype; period erp.fiscal_periods%rowtype; posted numeric; charge numeric; j uuid; obj uuid; ticket erp.maintenance_orders%rowtype; plan erp.maintenance_plans%rowtype;
begin
 if action in ('asset','depreciate') then perform erp.require_permission('assets.manage');
 else perform erp.require_permission('maintenance.manage'); end if;
 case action
 when 'asset' then
  insert into erp.assets(code,name,location_id,acquired_on,acquisition_cost,residual_value,useful_life_months,asset_account_id,depreciation_account_id,accumulated_depreciation_account_id)
    values(p->>'code',p->>'name',(p->>'location')::uuid,(p->>'date')::date,(p->>'cost')::numeric,(p->>'residual')::numeric,(p->>'months')::integer,
      (p->>'account')::uuid,(p->>'expense')::uuid,(p->>'accumulated')::uuid) returning id into obj;
 when 'depreciate' then
  select * into strict asset from erp.assets where id=(p->>'asset')::uuid and status='active' for update;
  select * into strict period from erp.fiscal_periods where id=(p->>'period')::uuid and status='open' and ends_on>=asset.acquired_on for share;
  select coalesce(sum(amount),0) into posted from erp.depreciation_entries where asset_id=asset.id;
  -- The accountant provides the approved amount for this period, including any first/last-period proration.
  charge:=(p->>'amount')::numeric;
  if charge is null or charge<=0 or charge<>round(charge,8) or posted+charge>asset.acquisition_cost-asset.residual_value then raise exception 'Depreciation exceeds remaining depreciable value'; end if;
  obj:=gen_random_uuid(); j:=erp.post_pair(period.ends_on,'asset_depreciation',obj,'Depreciation '||asset.code,asset.depreciation_account_id,asset.accumulated_depreciation_account_id,charge);
  insert into erp.depreciation_entries values(asset.id,period.id,charge,j);
 when 'plan' then
  insert into erp.maintenance_plans(asset_id,description,interval_days,next_due) values((p->>'asset')::uuid,p->>'notes',(p->>'days')::int,(p->>'date')::date) returning id into obj;
 when 'open' then
  if p->>'plan' is not null then
   select * into strict plan from erp.maintenance_plans where id=(p->>'plan')::uuid and active for update;
   insert into erp.maintenance_orders(asset_id,plan_id,kind,notes) values(plan.asset_id,plan.id,'preventive',p->>'notes') returning id into obj;
  else insert into erp.maintenance_orders(asset_id,kind,notes) values((p->>'asset')::uuid,'corrective',p->>'notes') returning id into obj; end if;
 when 'complete' then
  select * into strict ticket from erp.maintenance_orders where id=(p->>'ticket')::uuid and status in ('open','running') for update;
  charge:=(p->>'amount')::numeric;
  if charge is null or charge<0 or charge<>round(charge,8) then raise exception 'Enter maintenance cost or zero'; end if;
  if charge>0 then
   j:=erp.post_pair((p->>'date')::date,'maintenance',ticket.id,'Maintenance cost',erp.posting_account('maintenance_expense'),erp.posting_account('maintenance_clearing'),charge);
   insert into erp.maintenance_costs(order_id,amount,journal_line_id) select ticket.id,charge,id from erp.journal_lines where entry_id=j and debit>0;
  end if;
  update erp.maintenance_orders set status='completed',completed_at=clock_timestamp() where id=ticket.id;
  update erp.maintenance_plans set next_due=(p->>'date')::date+interval_days where id=ticket.plan_id;
  obj:=ticket.id;
 else raise exception 'Unknown asset operation'; end case;
 return to_jsonb(obj);
end $$;
revoke all on function erp.people_action(text,jsonb),erp.asset_action(text,jsonb) from public,anon,authenticated;
commit;
