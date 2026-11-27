begin;
insert into erp.permissions values
 ('purchases.manage','Prepare and submit purchase orders'),('purchases.approve','Decide assigned approval steps'),
 ('purchases.receive','Receive approved purchases'),('sales.manage','Prepare and deliver sales'),
 ('inventory.transfer','Transfer released lots'),('finance.read','Read trial balance'),
 ('inventory.read','Read stock and valuation'),('migration.stage','Stage and reconcile opening counts'),
 ('manufacturing.post','Post manufacturing operations'),('finance.post','Post vouchers and journal entries');

create table erp.posting_accounts (
  purpose text primary key, account_id uuid not null references erp.accounts
);
alter table erp.posting_accounts enable row level security;
create function erp.posting_account(p_purpose text) returns uuid language plpgsql stable set search_path='' as $$
declare a uuid;
begin
  select a0.id into a from erp.posting_accounts m join erp.accounts a0 on a0.id=m.account_id
    where m.purpose=p_purpose and a0.active and a0.posting_allowed;
  if a is null then raise exception 'Posting account required: %',p_purpose; end if;
  return a;
end $$;

create function erp.open_period(p_date date) returns uuid language plpgsql set search_path='' as $$
declare p uuid;
begin
  select id into p from erp.fiscal_periods where status='open' and p_date between starts_on and ends_on for share;
  if p is null then raise exception 'Open fiscal period required'; end if;
  return p;
end $$;

create function erp.post_pair(p_date date,p_source text,p_id uuid,p_label text,p_debit uuid,p_credit uuid,p_amount numeric)
returns uuid language plpgsql set search_path='' as $$
declare j uuid; period uuid;
begin
  period:=erp.open_period(p_date);
  if p_amount is null or p_amount<0 or p_amount<>round(p_amount,8) or p_debit=p_credit then raise exception 'Invalid posting'; end if;
  if p_amount=0 then return null; end if;
  insert into erp.journal_entries(period_id,entry_date,source_type,source_id,idempotency_key,description,created_by)
    values(period,p_date,p_source,p_id::text,p_source||':'||p_id,p_label,auth.uid()) returning id into j;
  insert into erp.journal_lines(entry_id,account_id,debit) values(j,p_debit,p_amount);
  insert into erp.journal_lines(entry_id,account_id,credit) values(j,p_credit,p_amount);
  update erp.journal_entries set status='posted' where id=j;
  return j;
end $$;

create unique index approval_pending_document on erp.approval_requests(document_type,document_id) where status='pending';
create function erp.submit_purchase(p_order uuid) returns uuid language plpgsql set search_path='' as $$
declare o erp.purchase_orders%rowtype; threshold numeric; rule uuid; steps jsonb; req uuid;
begin
  perform erp.require_permission('purchases.manage');
  select * into strict o from erp.purchase_orders where id=p_order for update;
  if o.status<>'draft' then raise exception 'Purchase order is not a draft'; end if;
  select sum(quantity*unit_price) into threshold from erp.purchase_order_lines where order_id=p_order;
  if threshold is null then raise exception 'Purchase order is empty'; end if;
  select id into rule from erp.approval_rules where active and document_type='purchase' and minimum_amount<=threshold
    order by minimum_amount desc,id limit 1 for share;
  select jsonb_agg(role_id order by step_no) into steps from erp.approval_rule_steps where rule_id=rule;
  if steps is null then raise exception 'Configure purchase approval steps first'; end if;
  insert into erp.approval_requests(rule_id,document_type,document_id,requested_by,rule_snapshot)
    values(rule,'purchase',p_order,auth.uid(),steps) returning id into req;
  update erp.purchase_orders set status='pending' where id=p_order;
  return req;
end $$;

create function erp.decide_purchase(p_order uuid,p_decision text) returns text language plpgsql set search_path='' as $$
declare o erp.purchase_orders%rowtype; req erp.approval_requests%rowtype; step integer; required_role uuid; outcome text;
begin
  perform erp.require_permission('purchases.approve');
  select * into strict o from erp.purchase_orders where id=p_order and status='pending' for update;
  select * into strict req from erp.approval_requests where document_id=p_order and document_type='purchase' and status='pending' for update;
  if req.requested_by=auth.uid() then raise exception 'Requester cannot approve own purchase'; end if;
  if p_decision is null or p_decision not in ('approved','rejected') then raise exception 'Invalid decision'; end if;
  select count(*)+1 into step from erp.approval_decisions where request_id=req.id;
  required_role:=(req.rule_snapshot->>(step-1))::uuid;
  if not exists(select from erp.user_roles where user_id=auth.uid() and role_id=required_role) then raise exception 'Approval step requires assigned role' using errcode='42501'; end if;
  insert into erp.approval_decisions(request_id,step_no,actor_id,decision) values(req.id,step,auth.uid(),p_decision);
  outcome:=case when p_decision='rejected' then 'rejected' when step=jsonb_array_length(req.rule_snapshot) then 'approved' else 'pending' end;
  update erp.approval_requests set status=outcome where id=req.id;
  update erp.purchase_orders set status=case when outcome='rejected' then 'draft' else outcome end where id=p_order;
  return outcome;
end $$;

create function erp.receive_purchase(p_line uuid,p_lot uuid,p_location uuid,p_qty numeric,p_date date)
returns uuid language plpgsql set search_path='' as $$
declare line erp.purchase_order_lines%rowtype; o erp.purchase_orders%rowtype; done numeric; receipt uuid; doc uuid; account uuid;
begin
  perform erp.require_permission('purchases.receive');
  select * into strict line from erp.purchase_order_lines where id=p_line;
  select * into strict o from erp.purchase_orders where id=line.order_id for update;
  if o.status not in ('approved','partial') then raise exception 'Approved purchase required'; end if;
  select coalesce(sum(quantity),0) into done from erp.receipt_lines where order_line_id=p_line;
  if p_qty is null or p_qty<=0 or p_qty<>round(p_qty,6) or p_qty+done>line.quantity then raise exception 'Receipt exceeds outstanding quantity'; end if;
  perform id from erp.lots where id=p_lot and item_id=line.item_id and producing_operation_id is null and quality_status in ('pending','quarantine') for update;
  if not found or exists(select from erp.inspections where lot_id=p_lot) then raise exception 'Fresh receipt lot required'; end if;
  account:=erp.posting_account('goods_received_unbilled');
  insert into erp.receipts(order_id) values(o.id) returning id into receipt;
  insert into erp.stock_documents(source_type,source_id,idempotency_key,created_by)
    values('purchase_receipt',receipt::text,'receipt:'||receipt,auth.uid()) returning id into doc;
  perform erp.post_stock_value(doc,line.item_id,p_lot,p_location,p_qty,round(line.unit_price*p_qty,8),account,erp.open_period(p_date),p_date);
  insert into erp.receipt_lines(receipt_id,order_line_id,lot_id,quantity) values(receipt,p_line,p_lot,p_qty);
  update erp.receipts set stock_document_id=doc where id=receipt;
  update erp.purchase_orders set status=case when exists(select from erp.purchase_order_lines l where l.order_id=o.id and l.quantity>
    (select coalesce(sum(r.quantity),0) from erp.receipt_lines r where r.order_line_id=l.id)) then 'partial' else 'received' end where id=o.id;
  return receipt;
end $$;

-- The website owns central inventory. ERP can deliver only explicit, locally fulfilled channels.
alter table erp.channels add column fulfillment text not null default 'unconfigured'
  check(fulfillment in ('unconfigured','external','direct','distributor'));
create table erp.delivery_costs(delivery_line_id uuid primary key references erp.delivery_lines,
  lot_id uuid not null references erp.lots, cost numeric(24,8) not null check(cost>=0));
alter table erp.delivery_costs enable row level security;

create function erp.deliver_direct(p_line uuid,p_lot uuid,p_qty numeric,p_date date)
returns uuid language plpgsql set search_path='' as $$
declare line erp.sales_order_lines%rowtype; o erp.sales_orders%rowtype; channel erp.channels%rowtype;
  delivered numeric; period uuid; dl uuid; d uuid; doc uuid; inv uuid; amount numeric; j uuid;
begin
  perform erp.require_permission('sales.manage');
  select * into strict line from erp.sales_order_lines where id=p_line;
  select * into strict o from erp.sales_orders where id=line.order_id for update;
  select * into strict channel from erp.channels where id=o.channel_id for share;
  if channel.fulfillment<>'direct' or o.distributor_id is not null or o.status not in ('confirmed','partial') then raise exception 'Confirmed direct order required'; end if;
  select coalesce(sum(quantity),0) into delivered from erp.delivery_lines where order_line_id=p_line;
  if p_qty is null or p_qty<=0 or p_qty<>round(p_qty,6) or p_qty+delivered>line.quantity then raise exception 'Delivery exceeds outstanding quantity'; end if;
  period:=erp.open_period(p_date);
  insert into erp.deliveries(order_id) values(o.id) returning id into d;
  insert into erp.stock_documents(source_type,source_id,idempotency_key,created_by) values('sale_issue',d::text,'delivery:'||d,auth.uid()) returning id into doc;
  perform erp.post_stock_value(doc,line.item_id,p_lot,channel.location_id,-p_qty,null,erp.posting_account('cogs'),period,p_date);
  update erp.deliveries set stock_document_id=doc where id=d;
  insert into erp.delivery_lines(delivery_id,order_line_id,quantity) values(d,p_line,p_qty) returning id into dl;
  insert into erp.delivery_costs select dl,p_lot,-value_delta from erp.stock_moves where document_id=doc;
  -- Difference of cumulative amounts preserves the exact invoice total across partial deliveries.
  amount:=round((delivered+p_qty)*(line.quantity*line.unit_price-line.discount)/line.quantity,8)
        - round(delivered*(line.quantity*line.unit_price-line.discount)/line.quantity,8);
  insert into erp.sales_invoices(code,order_id,invoice_date) values('INV-'||d,o.id,p_date) returning id into inv;
  j:=erp.post_pair(p_date,'sales_invoice',inv,'Direct sale',erp.posting_account('receivables'),erp.posting_account('sales'),amount);
  update erp.sales_invoices set journal_entry_id=j where id=inv;
  insert into erp.sales_invoice_lines(invoice_id,delivery_line_id,quantity,net_amount) values(inv,dl,p_qty,amount);
  update erp.sales_orders set status=case when exists(select from erp.sales_order_lines l where l.order_id=o.id and l.quantity>
    (select coalesce(sum(x.quantity),0) from erp.delivery_lines x where x.order_line_id=l.id)) then 'partial' else 'delivered' end where id=o.id;
  return inv;
end $$;
revoke all on all functions in schema erp from public,anon,authenticated;
commit;
