begin;
insert into erp.permissions values('finance.close','Reconcile and close periods'),('costing.manage','Manage overhead and landed costs');
alter table erp.stock_moves drop constraint stock_moves_quantity_delta_check;
alter table erp.stock_moves add check(quantity_delta<>0 or value_delta<>0);
create table erp.cost_postings (
  id uuid primary key default gen_random_uuid(), item_id uuid not null references erp.items, lot_id uuid not null references erp.lots,
  location_id uuid not null references erp.locations, stock_document_id uuid not null references erp.stock_documents,
  journal_entry_id uuid not null references erp.journal_entries
);
alter table erp.cost_postings enable row level security;
create function erp.adjust_carrying_value(p_lot uuid,p_location uuid,p_amount numeric,p_offset uuid,p_date date,p_reason text)
returns uuid language plpgsql set search_path='' as $$
declare item erp.items%rowtype; val erp.item_valuation%rowtype; doc uuid; j uuid; id0 uuid:=gen_random_uuid(); balance_qty numeric;
begin
 select i.* into strict item from erp.items i join erp.lots l on l.item_id=i.id where l.id=p_lot and i.active for share of i;
 select * into strict val from erp.item_valuation where item_id=item.id for update;
 select quantity into strict balance_qty from erp.stock_balances where item_id=item.id and lot_id=p_lot and location_id=p_location for update;
 if balance_qty<=0 or p_amount is null or p_amount=0 or round(p_amount,8)<>p_amount or val.total_value+p_amount<0 or item.inventory_account_id is null then raise exception 'Invalid inventory value adjustment'; end if;
 insert into erp.stock_documents(source_type,source_id,idempotency_key,created_by) values('cost_adjustment',id0::text,'cost_adjustment:'||id0,auth.uid()) returning id into doc;
 insert into erp.stock_moves(document_id,item_id,lot_id,location_id,quantity_delta,value_delta) values(doc,item.id,p_lot,p_location,0,p_amount);
 update erp.item_valuation set total_value=total_value+p_amount where item_id=item.id;
 j:=erp.post_pair(p_date,'cost_adjustment',id0,p_reason,case when p_amount>0 then item.inventory_account_id else p_offset end,
   case when p_amount>0 then p_offset else item.inventory_account_id end,abs(p_amount));
 update erp.stock_documents set status='posted' where id=doc;
 insert into erp.cost_postings values(id0,item.id,p_lot,p_location,doc,j);
 return j;
end $$;

create function erp.finance_action(action text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare j uuid; original erp.journal_entries%rowtype; period uuid; d date:=(p->>'date')::date; id0 uuid; line record;
 debit_account uuid; credit_account uuid; cost erp.cost_periods%rowtype; fp erp.fiscal_periods%rowtype; prior erp.cost_periods%rowtype;
 actual numeric; applied numeric; allocated numeric; amount numeric; offset_account uuid; debit_side uuid; posted_qty numeric;
begin
 if action in ('open_cost','overhead','close_cost') then perform erp.require_permission('costing.manage');
 elsif action='close' then perform erp.require_permission('finance.close');
 else perform erp.require_permission('finance.post');end if;
 case action
 when 'journal' then
  period:=erp.open_period(d);id0:=gen_random_uuid();
  if nullif(trim(p->>'reason'),'') is null or jsonb_typeof(p->'lines') is distinct from 'array' then raise exception 'Journal description and lines required'; end if;
  insert into erp.journal_entries(period_id,entry_date,source_type,source_id,idempotency_key,description,created_by)
    values(period,d,'manual',id0::text,'manual:'||id0,p->>'reason',auth.uid()) returning id into j;
  insert into erp.journal_lines(entry_id,account_id,debit,credit) select j,account,coalesce(debit,0),coalesce(credit,0)
    from jsonb_to_recordset(p->'lines') x(account uuid,debit numeric,credit numeric);
  if exists(select from erp.journal_lines l join erp.items i on i.inventory_account_id=l.account_id where l.entry_id=j) then raise exception 'Inventory control requires stock posting'; end if;
  update erp.journal_entries set status='posted' where id=j; id0:=j;
 when 'reverse' then
  select * into strict original from erp.journal_entries where id=(p->>'entry')::uuid and status='posted' and source_type='manual' and reversal_of is null for update;
  period:=erp.open_period(d);
  insert into erp.journal_entries(period_id,entry_date,source_type,source_id,idempotency_key,description,created_by,reversal_of)
   values(period,d,'manual_reversal',original.id::text,'reverse:'||original.id,p->>'reason',auth.uid(),original.id) returning id into j;
  insert into erp.journal_lines(entry_id,account_id,debit,credit) select j,account_id,credit,debit from erp.journal_lines where entry_id=original.id;
  update erp.journal_entries set status='posted' where id=j;id0:=j;
 when 'treasury_transfer' then
  select account_id into strict credit_account from erp.treasuries where id=(p->>'from')::uuid and active for share;
  select account_id into strict debit_account from erp.treasuries where id=(p->>'to')::uuid and active for share;
  insert into erp.vouchers(code,kind,treasury_id,destination_treasury_id,amount,voucher_date)
    values('TR-'||gen_random_uuid(),'transfer',(p->>'from')::uuid,(p->>'to')::uuid,(p->>'amount')::numeric,d) returning id into id0;
  j:=erp.post_pair(d,'treasury_transfer',id0,'Treasury transfer',debit_account,credit_account,(p->>'amount')::numeric);
  update erp.vouchers set journal_entry_id=j where id=id0;
 when 'open_cost' then
  select * into strict fp from erp.fiscal_periods where id=(p->>'period')::uuid and status='open' for share;
  select c.* into prior from erp.cost_periods c join erp.fiscal_periods f on f.id=c.period_id where f.ends_on=fp.starts_on-1 and c.status='closed' for share of c;
  if prior.id is null then
    if exists(select from erp.cost_periods) or p->>'initial_rate' is null then raise exception 'Initial approved rate or preceding closed cost period required'; end if;
    amount:=(p->>'initial_rate')::numeric;
  else
    select coalesce(sum(o.amount),0) into actual from erp.overheads o where o.cost_period_id=prior.id;
    select coalesce(sum(eligible_output_kg),0) into posted_qty from erp.overhead_applications where cost_period_id=prior.id;
    amount:=round(actual/greatest(prior.normal_capacity_kg,posted_qty),8);
  end if;
  insert into erp.cost_periods(period_id,normal_capacity_kg,applied_rate_per_kg,rate_source_period_id)
   values(fp.id,(p->>'capacity')::numeric,amount,prior.id) returning id into id0;
 when 'overhead' then
  select c.* into strict cost from erp.cost_periods c join erp.fiscal_periods f on f.id=c.period_id where c.id=(p->>'cost_period')::uuid and c.status='open' and f.status='open' and d between f.starts_on and f.ends_on for update of c;
  amount:=(p->>'amount')::numeric;
  id0:=gen_random_uuid();
  j:=erp.post_pair(d,'overhead',id0,'Actual manufacturing overhead',erp.posting_account('overhead_absorption'),(p->>'account')::uuid,amount);
  insert into erp.overheads(id,cost_period_id,category,behavior,amount,journal_line_id)
   values(id0,cost.id,p->>'category',p->>'behavior',amount,(select id from erp.journal_lines where entry_id=j and debit>0));
 when 'close_cost' then
  select * into strict cost from erp.cost_periods where id=(p->>'cost_period')::uuid and status='open' for update;
  select * into strict fp from erp.fiscal_periods where id=cost.period_id and status='open' for share;
  select coalesce(sum(o.amount),0) into actual from erp.overheads o where o.cost_period_id=cost.id;
  select coalesce(sum(a.applied_amount),0) into applied from erp.overhead_applications a where a.cost_period_id=cost.id;
  if jsonb_typeof(p->'lines') is distinct from 'array' then raise exception 'Explicit reconciliation allocations required'; end if;
  select coalesce(sum(x.amount),0) into allocated from jsonb_to_recordset(p->'lines') x(amount numeric);
  if actual-applied<>allocated then raise exception 'Cost variance allocations do not reconcile'; end if;
  offset_account:=erp.posting_account('overhead_absorption');
  for line in select * from jsonb_to_recordset(p->'lines') x(destination text,lot uuid,location uuid,amount numeric) loop
   if line.amount is null or line.amount=0 or sign(line.amount)<>sign(actual-applied) then raise exception 'Invalid cost variance allocation';end if;
   if line.destination in ('inventory','wip') then
    j:=erp.adjust_carrying_value(line.lot,line.location,line.amount,offset_account,fp.ends_on,'Period-end cost adjustment');
   elsif line.destination in ('cogs','abnormal_expense') then
    debit_side:=erp.posting_account(case line.destination when 'cogs' then 'cogs' else 'abnormal_loss' end);
    j:=erp.post_pair(fp.ends_on,'cost_variance',gen_random_uuid(),'Period-end variance',case when line.amount>0 then debit_side else offset_account end,
     case when line.amount>0 then offset_account else debit_side end,abs(line.amount));
   else raise exception 'Invalid variance destination';end if;
   insert into erp.cost_adjustments(cost_period_id,destination,item_id,lot_id,amount,journal_entry_id)
     values(cost.id,line.destination,(select item_id from erp.lots where id=line.lot),line.lot,line.amount,j);
  end loop;
  update erp.cost_periods set status='closed' where id=cost.id;id0:=cost.id;
 when 'close' then
  select * into strict fp from erp.fiscal_periods where id=(p->>'period')::uuid and status='open' for update;
  if exists(select from erp.cost_periods where period_id=fp.id and status<>'closed') or exists(select from erp.journal_entries where period_id=fp.id and status<>'posted')
    or exists(select from erp.inventory_reconciliation where not reconciled) or exists(select from erp.inventory_account_reconciliation where not reconciled) or exists(select from erp.payroll_runs where period_id=fp.id and status<>'posted')
    then raise exception 'Resolve open postings or reconciliation differences first';end if;
  update erp.fiscal_periods set status='closed' where id=fp.id;id0:=fp.id;
 else raise exception 'Unknown financial operation';end case;
 return to_jsonb(id0);
end $$;
revoke all on function erp.adjust_carrying_value(uuid,uuid,numeric,uuid,date,text),erp.finance_action(text,jsonb) from public,anon,authenticated;
commit;
