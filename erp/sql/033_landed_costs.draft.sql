begin;
create table erp.freight_invoices(
 id uuid primary key default gen_random_uuid(),supplier_id uuid not null references erp.suppliers,invoice_id uuid unique not null references erp.supplier_invoices,
 reference text not null,unique(supplier_id,reference)
);
alter table erp.freight_invoices enable row level security;
alter table erp.landed_costs add column freight_invoice_id uuid references erp.freight_invoices;
alter table erp.landed_cost_allocations add column journal_entry_id uuid references erp.journal_entries;
create function erp.freight_invoice(p jsonb) returns uuid language plpgsql set search_path='' as $$
declare lines uuid[]; weights numeric[]; selected int; inv uuid; freight uuid; cost uuid; j uuid; grni uuid; ap uuid;
  total numeric:=(p->>'amount')::numeric; d date:=(p->>'date')::date; line record;
begin
 perform erp.require_permission('costing.manage');
 if total is null or total<=0 or total<>round(total,8) or nullif(trim(p->>'code'),'') is null or jsonb_typeof(p->'lines') is distinct from 'array' then raise exception 'Freight invoice and receipt selection required';end if;
 select array_agg((x->>'receipt')::uuid order by n),count(*) into lines,selected from jsonb_array_elements(p->'lines') with ordinality q(x,n);
 if selected=0 or (select count(distinct id) from unnest(lines) id)<>selected then raise exception 'Distinct receipt lines required';end if;
 -- First-receipt valuation is valid while these lots have not been issued or transferred.
 perform i.id from erp.items i where i.id in (select l.item_id from erp.receipt_lines r join erp.lots l on l.id=r.lot_id where r.id=any(lines)) order by i.id for update;
 perform val.item_id from erp.item_valuation val where val.item_id in (select l.item_id from erp.receipt_lines r join erp.lots l on l.id=r.lot_id where r.id=any(lines)) order by val.item_id for update;
 if exists(select from erp.receipt_lines r join erp.stock_moves m on m.lot_id=r.lot_id where r.id=any(lines) and m.quantity_delta<0) then raise exception 'Lot already issued: reconcile inventory and expense shares before late freight allocation'; end if;
 select array_agg(erp.mass_kg(i,r.quantity) order by a.n) into weights from unnest(lines) with ordinality a(id,n)
  join erp.receipt_lines r on r.id=a.id join erp.lots l on l.id=r.lot_id join erp.items i on i.id=l.item_id;
 if cardinality(weights) is distinct from selected then raise exception 'Receipt selection incomplete';end if;
 grni:=erp.posting_account('freight_clearing');ap:=erp.posting_account('payables');
 insert into erp.supplier_invoices(supplier_id,invoice_number,invoice_date) values((p->>'supplier')::uuid,p->>'code',d) returning id into inv;
 insert into erp.freight_invoices(supplier_id,invoice_id,reference) values((p->>'supplier')::uuid,inv,p->>'code') returning id into freight;
 for line in select r.*,m.location_id,x.allocated from erp.allocate_cost_by_weight(total,weights) x
  join erp.receipt_lines r on r.id=lines[x.line_no] join erp.receipts h on h.id=r.receipt_id join erp.stock_moves m on m.document_id=h.stock_document_id and m.quantity_delta>0 loop
  insert into erp.landed_costs(receipt_id,description,amount,allocation_method,freight_invoice_id) values(line.receipt_id,p->>'code',line.allocated,'weight',freight) returning id into cost;
  if line.allocated>0 then j:=erp.adjust_carrying_value(line.lot_id,line.location_id,line.allocated,grni,d,'Freight '||(p->>'code'));else j:=null;end if;
  insert into erp.landed_cost_allocations values(cost,line.id,line.allocated,j);
 end loop;
 j:=erp.post_pair(d,'freight_bill',freight,'Freight supplier invoice',grni,ap,total);
 update erp.supplier_invoices set journal_entry_id=j where id=inv;
 insert into erp.supplier_invoice_lines(invoice_id,amount) values(inv,total);
 return inv;
end $$;
revoke all on function erp.freight_invoice(jsonb) from public,anon,authenticated;
commit;
