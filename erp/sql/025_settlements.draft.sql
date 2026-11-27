begin;
-- Store the original delivery cost and refund amount per invoice line to reverse partial returns exactly once.
alter table erp.sales_return_lines add column restored_cost numeric(24,8) not null default 0 check(restored_cost>=0);
alter table erp.sales_returns add column return_lot_id uuid references erp.lots;
create function erp.return_direct(p_line uuid,p_qty numeric,p_location uuid,p_reason text,p_date date)
returns uuid language plpgsql set search_path='' as $$
declare line erp.sales_invoice_lines%rowtype; order_row erp.sales_orders%rowtype; v erp.vouchers%rowtype;
  original erp.delivery_costs%rowtype; item uuid; original_lot erp.lots%rowtype; qty_before numeric; cost numeric; refund numeric;
  ret uuid; doc uuid; journal uuid; lot uuid; period uuid;
begin
  perform erp.require_permission('sales.manage');
  select * into strict line from erp.sales_invoice_lines where id=p_line for update;
  select o.* into strict order_row from erp.sales_invoices i join erp.sales_orders o on o.id=i.order_id join erp.channels c on c.id=o.channel_id
    where i.id=line.invoice_id and c.fulfillment='direct' and o.distributor_id is null;
  perform id from erp.sales_invoices where id=line.invoice_id for update;
  select * into strict original from erp.delivery_costs where delivery_line_id=line.delivery_line_id;
  select * into strict original_lot from erp.lots where id=original.lot_id;
  select coalesce(sum(quantity),0) into qty_before from erp.sales_return_lines where invoice_line_id=p_line;
  if p_qty is null or p_qty<=0 or round(p_qty,6)<>p_qty or qty_before+p_qty>line.quantity or nullif(trim(p_reason),'') is null then raise exception 'Invalid sales return'; end if;
  perform id from erp.locations where id=p_location and kind='quarantine' and active for share;
  if not found then raise exception 'Quarantine location required'; end if;
  period:=erp.open_period(p_date);
  cost:=round(original.cost*(qty_before+p_qty)/line.quantity,8)-round(original.cost*qty_before/line.quantity,8);
  refund:=round(line.net_amount*(qty_before+p_qty)/line.quantity,8)-round(line.net_amount*qty_before/line.quantity,8);
  ret:=gen_random_uuid();
  insert into erp.lots(item_id,lot_code,quality_status,manufactured_on,expires_on)
    values(original_lot.item_id,'RET-'||ret,'quarantine',original_lot.manufactured_on,original_lot.expires_on) returning id into lot;
  insert into erp.sales_returns(id,code,invoice_id,reason,return_lot_id) values(ret,'RET-'||ret,line.invoice_id,p_reason,lot);
  insert into erp.stock_documents(source_type,source_id,idempotency_key,created_by) values('sale_return',ret::text,'return:'||ret,auth.uid()) returning id into doc;
  perform erp.post_stock_value(doc,original_lot.item_id,lot,p_location,p_qty,cost,erp.posting_account('cogs'),period,p_date);
  journal:=erp.post_pair(p_date,'credit_note',ret,'Sales credit note',erp.posting_account('sales'),erp.posting_account('receivables'),refund);
  update erp.sales_returns set stock_document_id=doc,journal_entry_id=journal where id=ret;
  insert into erp.sales_return_lines(return_id,invoice_line_id,quantity,refund_amount,restored_cost) values(ret,p_line,p_qty,refund,cost);
  return ret;
end $$;

create table erp.supplier_billed_receipts(
  receipt_line_id uuid primary key references erp.receipt_lines, invoice_line_id uuid unique not null references erp.supplier_invoice_lines
);
alter table erp.supplier_billed_receipts enable row level security;
create function erp.bill_receipts(p_supplier uuid,p_number text,p_date date,p_lines uuid[]) returns uuid
language plpgsql set search_path='' as $$
declare inv uuid; l record; total numeric:=0; bill_line uuid; matched int:=0; j uuid;
begin
  perform erp.require_permission('purchases.manage');
  if nullif(trim(p_number),'') is null or coalesce(cardinality(p_lines),0)=0 then raise exception 'Invoice number and receipts required'; end if;
  insert into erp.supplier_invoices(supplier_id,invoice_number,invoice_date) values(p_supplier,trim(p_number),p_date) returning id into inv;
  for l in select r.id,r.order_line_id,m.value_delta amount from erp.receipt_lines r join erp.receipts h on h.id=r.receipt_id
    join erp.purchase_orders o on o.id=h.order_id and o.supplier_id=p_supplier
    join erp.stock_documents d on d.id=h.stock_document_id and d.status='posted'
    join erp.stock_moves m on m.document_id=d.id where r.id=any(p_lines) order by r.id for update of r loop
    insert into erp.supplier_invoice_lines(invoice_id,order_line_id,amount) values(inv,l.order_line_id,l.amount) returning id into bill_line;
    insert into erp.supplier_billed_receipts values(l.id,bill_line);
    total:=total+l.amount; matched:=matched+1;
  end loop;
  if matched<>cardinality(p_lines) then raise exception 'Invalid or duplicated receipt selection'; end if;
  j:=erp.post_pair(p_date,'supplier_invoice',inv,'Supplier invoice '||p_number,erp.posting_account('goods_received_unbilled'),erp.posting_account('payables'),total);
  update erp.supplier_invoices set journal_entry_id=j where id=inv;
  return inv;
end $$;

create function erp.settle_invoice(p_kind text,p_invoice uuid,p_treasury uuid,p_amount numeric,p_date date) returns uuid
language plpgsql set search_path='' as $$
declare treasury_account uuid; offset_account uuid; due numeric; settled numeric; credit_notes numeric; doc uuid; j uuid;
begin
  perform erp.require_permission('finance.post');
  select account_id into strict treasury_account from erp.treasuries where id=p_treasury and active and kind in ('cash','bank','wallet','gateway') for share;
  if p_amount is null or p_amount<=0 or p_amount<>round(p_amount,8) then raise exception 'Invalid settlement amount'; end if;
  if p_kind='payment' then
    perform id from erp.supplier_invoices where id=p_invoice and invoice_date<=p_date for update;
    if not found then raise exception 'Invalid supplier invoice'; end if;
    select coalesce(sum(amount),0) into due from erp.supplier_invoice_lines where invoice_id=p_invoice;
    select coalesce(sum(amount),0) into settled from erp.supplier_payment_allocations where invoice_id=p_invoice;
    offset_account:=erp.posting_account('payables');
  elsif p_kind='receipt' then
    perform i.id from erp.sales_invoices i join erp.sales_orders o on o.id=i.order_id join erp.channels c on c.id=o.channel_id
      where i.id=p_invoice and i.invoice_date<=p_date and c.fulfillment='direct' for update of i;
    if not found then raise exception 'Invalid direct sales invoice'; end if;
    select coalesce(sum(net_amount),0) into due from erp.sales_invoice_lines where invoice_id=p_invoice;
    select coalesce(sum(l.refund_amount),0) into credit_notes from erp.sales_return_lines l join erp.sales_returns r on r.id=l.return_id where r.invoice_id=p_invoice;
    due:=due-credit_notes;
    select coalesce(sum(amount),0) into settled from erp.customer_payment_allocations where invoice_id=p_invoice;
    offset_account:=erp.posting_account('receivables');
  else raise exception 'Invalid settlement type'; end if;
  if p_amount>due-settled then raise exception 'Amount exceeds invoice balance'; end if;
  insert into erp.vouchers(code,kind,treasury_id,amount,voucher_date) values('V-'||gen_random_uuid(),p_kind,p_treasury,p_amount,p_date) returning id into doc;
  if p_kind='payment' then
    j:=erp.post_pair(p_date,'voucher',doc,'Supplier payment',offset_account,treasury_account,p_amount);
    insert into erp.supplier_payment_allocations values(doc,p_invoice,p_amount);
  else
    j:=erp.post_pair(p_date,'voucher',doc,'Customer collection',treasury_account,offset_account,p_amount);
    insert into erp.customer_payment_allocations values(doc,p_invoice,p_amount);
  end if;
  update erp.vouchers set journal_entry_id=j where id=doc;
  return doc;
end $$;
revoke all on all functions in schema erp from public,anon,authenticated;
commit;
