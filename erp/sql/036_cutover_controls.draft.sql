begin;
-- Independent control totals are supplied by the business from the legacy close at a single point in time.
-- A missing code and a genuine zero are distinct. Extra nonzero ERP balances must be accounted for, too.
create function erp.cutover_review(p jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare differences jsonb; n int;
begin
 perform erp.require_permission('migration.stage');
 if nullif(trim(p->>'reference'),'') is null or (p->>'as_of')::date is null or jsonb_typeof(p->'balances') is distinct from 'array' or jsonb_array_length(p->'balances')=0 then
  raise exception 'Approved reference, as-of date and source controls required';
 end if;
 if exists(select from jsonb_to_recordset(p->'balances') s(kind text,code text,amount numeric) where s.kind is null or s.kind not in ('gl','customer','supplier','treasury')
   or nullif(trim(s.code),'') is null or s.amount is null or s.amount<>round(s.amount,8))
   or exists(select from jsonb_to_recordset(p->'balances') s(kind text,code text) group by s.kind,s.code having count(*)>1) then raise exception 'Invalid or duplicate source control';end if;
 if exists(select from erp.journal_entries where status='posted' and entry_date>(p->>'as_of')::date) then raise exception 'Use a rehearsal snapshot closed at the requested date';end if;
 with source as (select * from jsonb_to_recordset(p->'balances') s(kind text,code text,amount numeric)), actual as (
  select 'gl' kind,a.code,coalesce(sum(t.net),0) amount from erp.accounts a left join erp.trial_balance t on t.account_id=a.id group by a.id
  union all select 'treasury',a.code,coalesce(sum(t.net),0) from erp.treasuries tr join erp.accounts a on a.id=tr.account_id left join erp.trial_balance t on t.account_id=a.id group by a.id
  union all select 'customer',c.code,coalesce((select sum(
    coalesce((select sum(net_amount) from erp.sales_invoice_lines where invoice_id=i.id),0)
    -coalesce((select sum(refund_amount) from erp.sales_return_lines l join erp.sales_returns r on r.id=l.return_id where r.invoice_id=i.id),0)
    -coalesce((select sum(amount) from erp.customer_payment_allocations where invoice_id=i.id),0)
    +coalesce((select sum(v.amount) from erp.sales_returns r join erp.vouchers v on v.id=r.refund_voucher_id where r.invoice_id=i.id),0))
   from erp.sales_invoices i join erp.sales_orders o on o.id=i.order_id where o.customer_id=c.id),0) from erp.customers c
  union all select 'supplier',s.code,coalesce((select sum(
    coalesce((select sum(amount) from erp.supplier_invoice_lines where invoice_id=i.id),0)
    -coalesce((select sum(amount) from erp.supplier_payment_allocations where invoice_id=i.id),0))
   from erp.supplier_invoices i where i.supplier_id=s.id),0) from erp.suppliers s
 ), delta as (
  select coalesce(s.kind,a.kind) kind,coalesce(s.code,a.code) code,s.amount expected,a.amount actual,a.amount-s.amount difference
  from source s full join actual a using(kind,code)
  where (s.code is null and a.amount<>0) or (s.code is not null and a.amount is distinct from s.amount)
 )
 select coalesce(jsonb_agg(to_jsonb(delta) order by kind,code),'[]'::jsonb) into differences from delta;
 select count(*) into n from erp.inventory_reconciliation where not reconciled;
 n:=n+(select count(*) from erp.inventory_account_reconciliation where not reconciled);
 return jsonb_build_object('reference',p->>'reference','as_of',p->>'as_of','matches',jsonb_array_length(differences)=0 and n=0,
   'differences',differences,'stock_mismatches',n);
end $$;
revoke all on function erp.cutover_review(jsonb) from public,anon,authenticated;
commit;
