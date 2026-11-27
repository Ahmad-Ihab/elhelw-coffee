begin;
insert into erp.permissions values('distribution.manage','Manage distributor orders, collections and remittances');
create table erp.distributor_routes(
 distributor_id uuid primary key references public.distributors, name text not null,
 channel_id uuid unique not null references erp.channels, custody_treasury_id uuid unique not null references erp.treasuries
);
create table erp.channel_commissions (
 channel_id uuid references erp.channels,item_id uuid references erp.items, effective_from timestamptz not null,
 kind text not null check(kind in ('percentage','per_kg','per_unit')), rate numeric(24,8) not null check(rate>=0 and (kind<>'percentage' or rate<=100)),
 primary key(channel_id,item_id,effective_from)
);
create table erp.sale_commission_snapshot (
 order_line_id uuid primary key references erp.sales_order_lines,kind text not null,rate numeric(24,8) not null,per_unit_kg numeric(24,8) not null
);
alter table erp.sales_return_lines add column commission_reversal numeric(24,8) not null default 0;
alter table erp.distributor_routes enable row level security;
alter table erp.channel_commissions enable row level security;
alter table erp.sale_commission_snapshot enable row level security;
create function erp.commission_total(p_line uuid,p_qty numeric,p_revenue numeric) returns numeric language sql stable set search_path='' as $$
 select case kind when 'percentage' then round(p_revenue*rate/100,8) when 'per_kg' then round(p_qty*per_unit_kg*rate,8) else round(p_qty*rate,8) end
 from erp.sale_commission_snapshot where order_line_id=p_line
$$;
create function erp.cash_refund_due(p_invoice uuid) returns numeric language sql stable set search_path='' as $$
 select greatest(0,coalesce((select sum(amount) from erp.customer_payment_allocations where invoice_id=p_invoice),0)
  -coalesce((select sum(v.amount) from erp.sales_returns r join erp.vouchers v on v.id=r.refund_voucher_id where r.invoice_id=p_invoice),0)
  -coalesce((select sum(net_amount) from erp.sales_invoice_lines where invoice_id=p_invoice),0)
  +coalesce((select sum(l.refund_amount) from erp.sales_return_lines l join erp.sales_returns r on r.id=l.return_id where r.invoice_id=p_invoice),0))
$$;
create function erp.distribution_money(action text,p jsonb) returns uuid language plpgsql set search_path='' as $$
declare route erp.distributor_routes%rowtype; custody uuid; cash uuid; applied numeric; due numeric; value numeric:=(p->>'amount')::numeric;
 id0 uuid; j uuid; invoice erp.sales_invoices%rowtype; returned erp.sales_returns%rowtype; account uuid; cashbox uuid:=(p->>'treasury')::uuid; d date:=(p->>'date')::date;
begin
 perform erp.require_permission('distribution.manage');
 if action='refund' then
  select * into strict returned from erp.sales_returns where id=(p->>'return')::uuid and refund_voucher_id is null for update;
  select * into strict invoice from erp.sales_invoices where id=returned.invoice_id for update;
 else
  if action='collect' then select * into strict invoice from erp.sales_invoices where id=(p->>'invoice')::uuid for update;end if;
 end if;
 if invoice.id is not null then
  select r.* into strict route from erp.distributor_routes r join erp.sales_orders o on o.distributor_id=r.distributor_id and o.channel_id=r.channel_id where o.id=invoice.order_id for update of r;
 else select * into strict route from erp.distributor_routes where distributor_id=(p->>'distributor')::uuid for update;end if;
 select account_id into strict custody from erp.treasuries where id=route.custody_treasury_id and active and kind='advance' for update;
 if invoice.id is not null and (d is null or d<invoice.invoice_date) then raise exception 'Settlement date precedes invoice';end if;
 if action<>'collect' then select account_id into strict cash from erp.treasuries where id=cashbox and kind in ('bank','cash','wallet') and active for update;end if;
 if action in ('collect','refund') then
  select coalesce(sum(net_amount),0) into due from erp.sales_invoice_lines where invoice_id=invoice.id;
  select due-coalesce(sum(l.refund_amount),0) into due from erp.sales_return_lines l join erp.sales_returns r on r.id=l.return_id where r.invoice_id=invoice.id;
  select coalesce(sum(amount),0) into applied from erp.customer_payment_allocations where invoice_id=invoice.id;
  select applied-coalesce(sum(v.amount),0) into applied from erp.sales_returns r join erp.vouchers v on v.id=r.refund_voucher_id where r.invoice_id=invoice.id;
 end if;
 if action='collect' then
  if value is null or value<=0 or value>due-applied then raise exception 'Collection exceeds outstanding balance'; end if;
  insert into erp.vouchers(code,kind,treasury_id,amount,voucher_date) values('DC-'||gen_random_uuid(),'receipt',route.custody_treasury_id,value,d) returning id into id0;
  j:=erp.post_pair(d,'distributor_collection',id0,'Customer cash in distributor custody',custody,erp.posting_account('receivables'),value);
  insert into erp.customer_payment_allocations values(id0,invoice.id,value);
 elsif action='remit' then
  select coalesce(sum(net),0) into applied from erp.trial_balance where account_id=custody;
  if value is null or value<=0 or value>applied then raise exception 'Remittance exceeds cash held';end if;
  insert into erp.vouchers(code,kind,treasury_id,destination_treasury_id,amount,voucher_date)
   values('DR-'||gen_random_uuid(),'transfer',route.custody_treasury_id,cashbox,value,d) returning id into id0;
  j:=erp.post_pair(d,'distributor_remittance',id0,'Distributor remittance',cash,custody,value);
 elsif action='refund' then
  select least(greatest(applied-due,0),sum(refund_amount)) into value from erp.sales_return_lines where return_id=returned.id;
  if value is null or value<=0 then raise exception 'No collected cash to refund';end if;
  insert into erp.vouchers(code,kind,treasury_id,amount,voucher_date) values('DF-'||gen_random_uuid(),'payment',cashbox,value,d) returning id into id0;
  j:=erp.post_pair(d,'company_funded_refund',id0,'Company funds returned to customer',erp.posting_account('receivables'),cash,value);
  update erp.sales_returns set refund_voucher_id=id0 where id=returned.id;
 else raise exception 'Unknown distribution settlement';end if;
 update erp.vouchers set journal_entry_id=j where id=id0;
 return id0;
end $$;
revoke all on function erp.cash_refund_due(uuid),erp.commission_total(uuid,numeric,numeric),erp.distribution_money(text,jsonb) from public,anon,authenticated;
commit;
