begin;
create table erp.command_receipts (
  actor_id uuid references auth.users, request_id uuid, action text not null, payload jsonb not null,
  result jsonb, primary key(actor_id,request_id)
);
alter table erp.command_receipts enable row level security;
create function erp.command(p_action text,p_payload jsonb,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); receipt erp.command_receipts%rowtype; output_value jsonb; p jsonb:=p_payload;
  doc uuid; lot uuid; item uuid; inspection uuid;
begin
 if actor is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_request is null or jsonb_typeof(p) is distinct from 'object' then raise exception 'Request ID and form required'; end if;
 -- Acquire the retry key before doing any work. Even concurrent duplicate submissions share one result.
 insert into erp.command_receipts(actor_id,request_id,action,payload) values(actor,p_request,p_action,p) on conflict do nothing;
 select * into strict receipt from erp.command_receipts where actor_id=actor and request_id=p_request for update;
 if receipt.action<>p_action or receipt.payload<>p then raise exception 'Request key belongs to a different command'; end if;
 if receipt.result is not null then return receipt.result; end if;
 case p_action
 when 'inspect_start' then output_value:=to_jsonb(erp.begin_inspection((p->>'lot')::uuid));
 when 'inspect_record' then output_value:=to_jsonb(erp.record_inspection((p->>'inspection')::uuid,p->'values'));
 when 'inspect_release' then
  inspection:=(p->>'inspection')::uuid;
  select lot_id into strict lot from erp.inspections where id=inspection;
  perform erp.release_inspected_lot(lot,inspection);
 when 'spec_retire' then
  perform erp.require_permission('quality.configure');
  update erp.quality_specs set active=false where id=(p->>'spec')::uuid and active returning id into strict doc;
 when 'spec' then output_value:=to_jsonb(erp.configure_check(p));
 when 'purchase_new' then output_value:=to_jsonb(erp.create_purchase((p->>'supplier')::uuid,p->>'code',p->'lines'));
 when 'purchase_submit' then output_value:=to_jsonb(erp.submit_purchase((p->>'order')::uuid));
 when 'purchase_decide' then output_value:=to_jsonb(erp.decide_purchase((p->>'order')::uuid,p->>'decision'));
 when 'purchase_receive' then
  perform erp.require_permission('purchases.receive');
  select item_id into strict item from erp.purchase_order_lines where id=(p->>'line')::uuid;
  if nullif(trim(p->>'lot_code'),'') is null then raise exception 'Lot code required'; end if;
  insert into erp.lots(item_id,lot_code,expires_on) values(item,trim(p->>'lot_code'),(p->>'expiry')::date) returning id into lot;
  output_value:=to_jsonb(erp.receive_purchase((p->>'line')::uuid,lot,(p->>'location')::uuid,(p->>'qty')::numeric,(p->>'date')::date));
 when 'freight_bill' then output_value:=to_jsonb(erp.freight_invoice(p));
 when 'purchase_bill' then output_value:=to_jsonb(erp.bill_receipts((p->>'supplier')::uuid,p->>'code',(p->>'date')::date,array(select (x->>'receipt')::uuid from jsonb_array_elements(p->'lines') x)));
 when 'distribution_new' then
  select channel_id into strict doc from erp.distributor_routes where distributor_id=(p->>'distributor')::uuid;
  output_value:=to_jsonb(erp.create_direct_order(doc,(p->>'customer')::uuid,p->>'code',p->'lines',(p->>'distributor')::uuid));
 when 'distribution_collect','distribution_remit','distribution_refund' then output_value:=to_jsonb(erp.distribution_money(substr(p_action,14),p));
 when 'sale_new' then output_value:=to_jsonb(erp.create_direct_order((p->>'channel')::uuid,(p->>'customer')::uuid,p->>'code',p->'lines'));
 when 'sale_cancel' then perform erp.cancel_sale((p->>'order')::uuid);
 when 'plan' then output_value:=to_jsonb(erp.run_plan((p->>'horizon')::date));
 when 'sale_deliver' then output_value:=to_jsonb(erp.deliver_direct((p->>'line')::uuid,(p->>'lot')::uuid,(p->>'qty')::numeric,(p->>'date')::date));
 when 'sale_return' then
  doc:=erp.return_direct((p->>'line')::uuid,(p->>'qty')::numeric,(p->>'location')::uuid,p->>'reason',(p->>'date')::date);
  if exists(select from erp.sales_returns r join erp.sales_invoices i on i.id=r.invoice_id join erp.sales_orders o on o.id=i.order_id
    where r.id=doc and o.distributor_id is not null and erp.cash_refund_due(i.id)>0) then
    perform erp.distribution_money('refund',p||jsonb_build_object('return',doc));
  elsif exists(select from erp.sales_returns r join erp.sales_invoices i on i.id=r.invoice_id join erp.sales_orders o on o.id=i.order_id
    where r.id=doc and o.distributor_id is null and erp.cash_refund_due(i.id)>0) then
    perform erp.refund_direct_cash(doc,(p->>'treasury')::uuid,(p->>'date')::date);
  end if;
  output_value:=to_jsonb(doc);
 when 'settle' then output_value:=to_jsonb(erp.settle_invoice(p->>'kind',(p->>'invoice')::uuid,(p->>'treasury')::uuid,(p->>'amount')::numeric,(p->>'date')::date));
 when 'linked_order' then output_value:=to_jsonb(erp.linked_work_order(p));
 when 'component_plan' then
  perform erp.require_permission('planning.run');
  select coalesce(jsonb_agg(jsonb_build_object('sku',i.sku,'base_unit',i.base_unit,'required',round(c.required,6),'available',c.available,'shortage',round(c.shortage,6)) order by i.sku),'[]')
  into output_value from erp.component_plan((p->>'item')::uuid,(p->>'location')::uuid,(p->>'qty')::numeric) c join erp.items i on i.id=c.item_id;
 when 'operation_new' then output_value:=to_jsonb(erp.prepare_operation((p->>'recipe')::uuid,p->>'code',(p->>'qty')::numeric,(p->>'direct')::numeric));
 when 'operation_finish' then output_value:=to_jsonb(erp.finish_operation((p->>'operation')::uuid,p->>'lot_code',(p->>'qty')::numeric,(p->>'location')::uuid,p->'inputs',(p->>'date')::date,(p->>'abnormal')::numeric));
 when 'transfer' then
  perform erp.require_permission('inventory.transfer');
  lot:=(p->>'lot')::uuid;
  select item_id into strict item from erp.lots where id=lot;
  insert into erp.stock_documents(source_type,source_id,idempotency_key,created_by) values('internal_transfer',p_request::text,'transfer:'||actor||':'||p_request,actor) returning id into doc;
  perform erp.post_internal_transfer(doc,item,lot,(p->>'from')::uuid,(p->>'to')::uuid,(p->>'qty')::numeric);
  output_value:=to_jsonb(doc);
 when 'cutover_review' then output_value:=erp.cutover_review(p);
 when 'opening_stage' then output_value:=to_jsonb(erp.stage_opening(p));
 when 'opening_review' then perform erp.require_permission('migration.stage'); output_value:=erp.opening_review((p->>'run')::uuid);
 when 'opening_post' then output_value:=erp.post_opening((p->>'run')::uuid);
 else
  if p_action like 'setup.%' then output_value:=erp.configure(substr(p_action,7),p);
  elsif p_action like 'finance.%' then output_value:=erp.finance_action(substr(p_action,8),p);
  elsif p_action like 'hr.%' then output_value:=erp.people_action(substr(p_action,4),p);
  elsif p_action like 'asset.%' then output_value:=erp.asset_action(substr(p_action,7),p);
  elsif p_action like 'access.%' then output_value:=erp.configure_access(substr(p_action,8),p);
  else raise exception 'Unknown workflow'; end if;
 end case;
 output_value:=coalesce(output_value,'true'::jsonb);
 update erp.command_receipts set result=output_value where actor_id=actor and request_id=p_request;
 insert into erp.audit_log(actor_id,action,entity_type,entity_id,after_data) values(actor,p_action,'command',p_request::text,output_value);
 return output_value;
end $$;

create function erp.workspace() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare perms text[]; data jsonb:='{}'; records jsonb:='{}';
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 select coalesce(array_agg(code order by code),'{}') into perms from erp.permissions where erp.has_permission(code);
 if perms && array['setup.configure','planning.run','quality.configure','purchases.manage','sales.manage','distribution.manage','manufacturing.post','inventory.transfer'] then
  select data||jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(q) order by q.label,q.id),'[]')) into data from (select i.id,i.sku||' · '||i.name label from erp.items i where i.active) q;
 end if;
 if perms && array['setup.configure','planning.run','costing.manage','assets.manage','purchases.receive','sales.manage','distribution.manage','manufacturing.post','inventory.transfer'] then
  select data||jsonb_build_object('locations',coalesce(jsonb_agg(to_jsonb(q) order by q.label,q.id),'[]')) into data from (select id,code||' · '||name label from erp.locations where active) q;
 end if;
 if perms && array['setup.configure','purchases.manage','costing.manage'] then
  select data||jsonb_build_object('suppliers',coalesce(jsonb_agg(to_jsonb(q) order by q.label,q.id),'[]')) into data from (select id,name label from erp.suppliers where active) q;
 end if;
 if perms && array['setup.configure','sales.manage','distribution.manage'] then
  select data||jsonb_build_object('customers',coalesce(jsonb_agg(to_jsonb(q) order by q.label,q.id),'[]')) into data from (select id,name label from erp.customers where active) q;
 end if;
 if perms && array['setup.configure','sales.manage','distribution.manage'] then
  select data||jsonb_build_object('channels',coalesce(jsonb_agg(to_jsonb(q) order by q.label,q.id),'[]')) into data from (select id,name label from erp.channels where fulfillment='direct') q;
 end if;
 if perms && array['setup.configure','sales.manage','distribution.manage'] then
  select data||jsonb_build_object('lists',coalesce(jsonb_agg(to_jsonb(q) order by q.label,q.id),'[]')) into data from (select id,name label from erp.price_lists) q;
 end if;
 if perms && array['finance.post','sales.manage','distribution.manage','setup.configure'] then
  select data||jsonb_build_object('treasuries',coalesce(jsonb_agg(to_jsonb(q) order by q.label,q.id),'[]')) into data from (select id,name label from erp.treasuries where active) q;
 end if;
 if perms && array['setup.configure','assets.manage','finance.post','costing.manage'] then
  select data||jsonb_build_object('accounts',coalesce(jsonb_agg(to_jsonb(q) order by q.label,q.id),'[]')) into data from (select id,code||' · '||name label from erp.accounts where active and posting_allowed) q;
 end if;
 if perms && array['setup.configure','roles.manage'] then
  select data||jsonb_build_object('roles',coalesce(jsonb_agg(to_jsonb(q) order by q.label,q.id),'[]')) into data from (select id,name label from erp.roles) q;
 end if;
 if perms && array['roles.manage'] then
  select data||jsonb_build_object('permissions',coalesce(jsonb_agg(to_jsonb(q) order by q.label,q.id),'[]')) into data from (select code id,code label from erp.permissions) q;
 end if;
 if perms && array['purchases.manage'] then
  select data||jsonb_build_object('purchase_drafts',coalesce(jsonb_agg(to_jsonb(q) order by q.label,q.id),'[]')) into data from (select id,code label from erp.purchase_orders where status='draft') q;
 end if;
 if perms && array['purchases.approve'] then
  select data||jsonb_build_object('approvals',coalesce(jsonb_agg(to_jsonb(q) order by q.label,q.id),'[]')) into data from (select o.id,o.code label from erp.purchase_orders o join erp.approval_requests a on a.document_id=o.id and a.document_type='purchase' and a.status='pending' where o.status='pending' and a.requested_by<>auth.uid() and exists(select from erp.user_roles u where u.user_id=auth.uid() and u.role_id=(a.rule_snapshot->>(select count(*)::int from erp.approval_decisions where request_id=a.id))::uuid)) q;
 end if;
 if perms && array['purchases.receive'] then
  select data||jsonb_build_object('purchase_lines',coalesce(jsonb_agg(to_jsonb(q) order by q.label,q.id),'[]')) into data from (select l.id,o.code||' · '||i.sku||' · '||(l.quantity-coalesce(r.qty,0))::text label from erp.purchase_order_lines l join erp.purchase_orders o on o.id=l.order_id join erp.items i on i.id=l.item_id left join lateral(select sum(quantity) qty from erp.receipt_lines where order_line_id=l.id) r on true where o.status in ('approved','partial') and l.quantity>coalesce(r.qty,0)) q;
 end if;
 if perms && array['purchases.manage'] then
  select data||jsonb_build_object('billable',coalesce(jsonb_agg(to_jsonb(q) order by q.label,q.id),'[]')) into data from (select l.id,o.code||' · '||b.lot_code||' · '||l.quantity label from erp.receipt_lines l join erp.receipts r on r.id=l.receipt_id join erp.purchase_orders o on o.id=r.order_id join erp.lots b on b.id=l.lot_id where not exists(select from erp.supplier_billed_receipts where receipt_line_id=l.id)) q;
 end if;
 if perms && array['sales.manage','distribution.manage'] then
  select data||jsonb_build_object('sale_lines',coalesce(jsonb_agg(to_jsonb(q) order by q.label,q.id),'[]')) into data from (select l.id,o.code||' · '||i.sku label from erp.sales_order_lines l join erp.sales_orders o on o.id=l.order_id join erp.items i on i.id=l.item_id join erp.channels c on c.id=o.channel_id where o.status in ('confirmed','partial') and ((c.fulfillment='direct' and 'sales.manage'=any(perms)) or (c.fulfillment='distributor' and 'distribution.manage'=any(perms))) and l.quantity>(select coalesce(sum(quantity),0) from erp.delivery_lines where order_line_id=l.id)) q;
 end if;
 if perms && array['sales.manage','distribution.manage'] then
  select data||jsonb_build_object('return_lines',coalesce(jsonb_agg(to_jsonb(q) order by q.label,q.id),'[]')) into data from (select l.id,i.code||' · '||lot.lot_code label from erp.sales_invoice_lines l join erp.sales_invoices i on i.id=l.invoice_id join erp.delivery_costs d on d.delivery_line_id=l.delivery_line_id join erp.lots lot on lot.id=d.lot_id join erp.sales_orders so on so.id=i.order_id where ((so.distributor_id is null and 'sales.manage'=any(perms)) or (so.distributor_id is not null and 'distribution.manage'=any(perms))) and l.quantity>(select coalesce(sum(quantity),0) from erp.sales_return_lines where invoice_line_id=l.id)) q;
 end if;
 if perms && array['finance.post'] then
  select data||jsonb_build_object('sales_invoices',coalesce(jsonb_agg(to_jsonb(q) order by q.label,q.id),'[]')) into data from (select id,code label from erp.sales_invoices) q;
 end if;
 if perms && array['finance.post'] then
  select data||jsonb_build_object('supplier_invoices',coalesce(jsonb_agg(to_jsonb(q) order by q.label,q.id),'[]')) into data from (select id,invoice_number label from erp.supplier_invoices) q;
 end if;
 if perms && array['manufacturing.post','setup.configure'] then
  select data||jsonb_build_object('recipes',coalesce(jsonb_agg(to_jsonb(q) order by q.label,q.id),'[]')) into data from (select v.id,b.name||' · v'||v.version label from erp.bom_versions v join erp.boms b on b.id=v.bom_id where v.status='approved') q;
 end if;
 if perms && array['manufacturing.post'] then
  select data||jsonb_build_object('operations',coalesce(jsonb_agg(to_jsonb(q) order by q.label,q.id),'[]')) into data from (select o.id,coalesce(w.code,b.name)||' · '||o.stage||' · '||left(o.id::text,8) label from erp.operations o left join erp.work_orders w on w.id=o.work_order_id join erp.bom_versions v on v.id=coalesce(o.recipe_version_id,w.version_id) join erp.boms b on b.id=v.bom_id where o.status in ('draft','running')) q;
 end if;
 if perms && array['sales.manage','distribution.manage','manufacturing.post','inventory.transfer'] then
  select data||jsonb_build_object('released',coalesce(jsonb_agg(to_jsonb(q) order by q.label,q.id),'[]')) into data from (select l.id,i.sku||' · '||l.lot_code label from erp.lots l join erp.items i on i.id=l.item_id where l.quality_status='released' and (l.expires_on is null or l.expires_on>=current_date) and exists(select from erp.stock_balances b where b.lot_id=l.id and b.quantity>0)) q;
 end if;
 if perms && array['quality.inspect'] then
  select data||jsonb_build_object('pending_lots',coalesce(jsonb_agg(to_jsonb(q) order by q.label,q.id),'[]')) into data from (select l.id,i.sku||' · '||l.lot_code label from erp.lots l join erp.items i on i.id=l.item_id where l.quality_status in ('pending','quarantine')) q;
 end if;
 if perms && array['quality.inspect'] then
  select data||jsonb_build_object('pending_inspections',coalesce(jsonb_agg(to_jsonb(q) order by q.label,q.id),'[]')) into data from (select c.id,i.sku||' · '||l.lot_code label,
 (select jsonb_agg(snapshot||jsonb_build_object('id',spec_id) order by snapshot->>'name',spec_id) from erp.inspection_checks where inspection_id=c.id) checks
 from erp.inspections c join erp.lots l on l.id=c.lot_id join erp.items i on i.id=l.item_id where c.status='pending') q;
 end if;
 if perms && array['quality.release'] then
  select data||jsonb_build_object('passed',coalesce(jsonb_agg(to_jsonb(q) order by q.label,q.id),'[]')) into data from (select c.id,i.sku||' · '||l.lot_code label from erp.inspections c join erp.lots l on l.id=c.lot_id join erp.items i on i.id=l.item_id
 where c.status='passed' and l.quality_status in ('pending','quarantine') and not exists(select from erp.inspections n where n.lot_id=l.id and n.id<>c.id and (n.status='pending' or n.inspected_at>=c.inspected_at))) q;
 end if;
 if perms && array['migration.stage'] then
  select data||jsonb_build_object('runs',coalesce(jsonb_agg(to_jsonb(q) order by q.label,q.id),'[]')) into data from (select id,reference||' · '||status label from erp.opening_runs) q;
 end if;
 if 'inventory.read'=any(perms) then
  select records||jsonb_build_object('inventory',coalesce(jsonb_agg(to_jsonb(q) order by q.sku,q.lot_code,q.location),'[]')) into records from
    (select i.sku,l.lot_code,loc.name location,l.quality_status,b.quantity,i.base_unit,
      b.quantity-(select coalesce(sum(quantity),0) from erp.reservations where item_id=i.id and lot_id=l.id and location_id=loc.id and status='active') unreserved
     from erp.stock_balances b join erp.items i on i.id=b.item_id join erp.lots l on l.id=b.lot_id join erp.locations loc on loc.id=b.location_id where b.quantity>0) q;
 end if;
 if 'finance.read'=any(perms) then
  select records||jsonb_build_object('inventory_gl',coalesce(jsonb_agg(to_jsonb(q) order by q.code),'[]')) into records from
   (select code,stock_value,gl_value,stock_value-gl_value difference from erp.inventory_account_reconciliation) q;
  select records||jsonb_build_object('trial',coalesce(jsonb_agg(to_jsonb(q) order by q.starts_on,q.code),'[]')) into records from
    (select f.starts_on,t.code,t.name,t.debit,t.credit,t.net from erp.trial_balance t join erp.fiscal_periods f on f.id=t.period_id) q;
 end if;
 if 'quality.configure'=any(perms) then
  select data||jsonb_build_object('active_specs',coalesce(jsonb_agg(to_jsonb(q) order by q.label),'[]')) into data from
   (select s.id,coalesce(i.sku,'*')||' · '||s.stage||' · '||s.test_name label from erp.quality_specs s left join erp.items i on i.id=s.item_id where s.active) q;
 end if;
 if 'quality.read'=any(perms) then
  select records||jsonb_build_object('quality',coalesce(jsonb_agg(to_jsonb(q) order by q.sku,q.lot_code),'[]')) into records from
    (select i.sku,l.lot_code,l.quality_status,c.stage,c.status,c.inspected_at from erp.lots l join erp.items i on i.id=l.item_id
      left join erp.inspections c on c.lot_id=l.id) q;
 end if;
 if perms && array['hr.manage','payroll.prepare'] then
  select data||jsonb_build_object('employees',coalesce(jsonb_agg(to_jsonb(q) order by q.label),'[]')) into data from (select id,code||' · '||name label from erp.employees where active) q;
 end if;
 if 'hr.manage'=any(perms) then
  select data||jsonb_build_object('leave',coalesce(jsonb_agg(to_jsonb(q) order by q.label),'[]')) into data from (select l.id,e.name||' · '||l.starts_on||' – '||l.ends_on label from erp.leave_requests l join erp.employees e on e.id=l.employee_id where l.status='pending') q;
 end if;
 if 'payroll.prepare'=any(perms) then
  select data||jsonb_build_object('components',coalesce(jsonb_agg(to_jsonb(q) order by q.label),'[]')) into data from (select component id,component label from erp.payroll_accounts) q;
 end if;
 if 'payroll.approve'=any(perms) then
  select data||jsonb_build_object('payruns',coalesce(jsonb_agg(to_jsonb(q) order by q.label),'[]')) into data from (select r.id,f.starts_on||' – '||f.ends_on label from erp.payroll_runs r join erp.fiscal_periods f on f.id=r.period_id where r.status='draft' and prepared_by<>auth.uid()) q;
 end if;
 if perms && array['assets.manage','setup.configure','payroll.prepare','finance.post','costing.manage','finance.close'] then
  select data||jsonb_build_object('periods',coalesce(jsonb_agg(to_jsonb(q) order by q.label),'[]')) into data from (select id,starts_on||' – '||ends_on label from erp.fiscal_periods where status='open') q;
 end if;
 if perms && array['assets.manage','maintenance.manage'] then
  select data||jsonb_build_object('assets',coalesce(jsonb_agg(to_jsonb(q) order by q.label),'[]')) into data from (select id,code||' · '||name label from erp.assets where status='active') q;
 end if;
 if 'maintenance.manage'=any(perms) then
  select data||jsonb_build_object('maintenance_plans',coalesce(jsonb_agg(to_jsonb(q) order by q.label),'[]')) into data from (select p.id,a.name||' · '||p.description||' · '||p.next_due label from erp.maintenance_plans p join erp.assets a on a.id=p.asset_id where p.active) q;
  select data||jsonb_build_object('tickets',coalesce(jsonb_agg(to_jsonb(q) order by q.label),'[]')) into data from (select t.id,a.name||' · '||t.kind||' · '||left(t.id::text,8) label from erp.maintenance_orders t join erp.assets a on a.id=t.asset_id where t.status in ('open','running')) q;
 end if;
 if 'finance.post'=any(perms) then
  select data||jsonb_build_object('journals',coalesce(jsonb_agg(to_jsonb(q) order by q.label),'[]')) into data from (select j.id,j.entry_date||' · '||j.description label from erp.journal_entries j where j.status='posted' and j.source_type='manual' and not exists(select from erp.journal_entries r where r.reversal_of=j.id)) q;
 end if;
 if 'costing.manage'=any(perms) then
  select data||jsonb_build_object('freight_receipts',coalesce(jsonb_agg(to_jsonb(q) order by q.label),'[]')) into data from (select r.id,l.lot_code||' · '||i.sku label from erp.receipt_lines r join erp.lots l on l.id=r.lot_id join erp.items i on i.id=l.item_id where not exists(select from erp.stock_moves m where m.lot_id=l.id and m.quantity_delta<0)) q;
  select data||jsonb_build_object('cost_periods',coalesce(jsonb_agg(to_jsonb(q) order by q.label),'[]')) into data from (select c.id,f.starts_on||' – '||f.ends_on label from erp.cost_periods c join erp.fiscal_periods f on f.id=c.period_id where c.status='open') q;
  select data||jsonb_build_object('cost_lots',coalesce(jsonb_agg(to_jsonb(q) order by q.label),'[]')) into data from (select l.id,i.sku||' · '||l.lot_code label from erp.lots l join erp.items i on i.id=l.item_id where exists(select from erp.stock_balances b where b.lot_id=l.id and b.quantity>0)) q;
 end if;
 if perms && array['distribution.manage','setup.configure'] then
  select data||jsonb_build_object('routes',coalesce(jsonb_agg(to_jsonb(q) order by q.label),'[]')) into data from (select distributor_id id,name label from erp.distributor_routes) q;
  select data||jsonb_build_object('distribution_channels',coalesce(jsonb_agg(to_jsonb(q) order by q.label),'[]')) into data from (select id,name label from erp.channels where fulfillment='distributor') q;
 end if;
 if 'distribution.manage'=any(perms) then
  select data||jsonb_build_object('distribution_invoices',coalesce(jsonb_agg(to_jsonb(q) order by q.label),'[]')) into data from (select i.id,i.code label from erp.sales_invoices i join erp.sales_orders o on o.id=i.order_id where o.distributor_id is not null) q;
  select data||jsonb_build_object('distribution_returns',coalesce(jsonb_agg(to_jsonb(q) order by q.label),'[]')) into data from (select r.id,r.code label from erp.sales_returns r join erp.sales_invoices i on i.id=r.invoice_id join erp.sales_orders o on o.id=i.order_id where o.distributor_id is not null and r.refund_voucher_id is null) q;
 end if;
 if perms && array['sales.manage','distribution.manage'] then
  select data||jsonb_build_object('open_sales',coalesce(jsonb_agg(to_jsonb(q) order by q.label),'[]')) into data from
   (select o.id,o.code label from erp.sales_orders o join erp.channels c on c.id=o.channel_id where ((c.fulfillment='direct' and 'sales.manage'=any(perms)) or (c.fulfillment='distributor' and 'distribution.manage'=any(perms))) and o.status in ('draft','confirmed')) q;
 end if;
 if 'planning.run'=any(perms) then
  select records||jsonb_build_object('plan',coalesce(jsonb_agg(to_jsonb(q) order by q.required_on,q.sku),'[]')) into records from
   (select i.sku,l.name location,s.kind,s.quantity,s.required_on from erp.planning_suggestions s join erp.items i on i.id=s.item_id
    join erp.locations l on l.id=s.location_id where run_id=(select id from erp.planning_runs order by created_at desc,id limit 1)) q;
 end if;
 return jsonb_build_object('permissions',perms,'choices',data,'records',records);
end $$;
-- PostgREST entry points delegate to a private schema. No table grants are required.
create function public.elhelw_erp_workspace() returns jsonb language sql stable security invoker set search_path='' as $$
 select erp.workspace()
$$;
create function public.elhelw_erp_command(p_action text,p_payload jsonb,p_request uuid) returns jsonb language sql security invoker set search_path='' as $$
 select erp.command(p_action,p_payload,p_request)
$$;
revoke all on all functions in schema erp from public,anon,authenticated;
revoke all on function public.elhelw_erp_workspace(),public.elhelw_erp_command(text,jsonb,uuid) from public,anon,authenticated;
grant usage on schema erp to authenticated;
grant execute on function erp.workspace(),erp.command(text,jsonb,uuid),public.elhelw_erp_workspace(),public.elhelw_erp_command(text,jsonb,uuid) to authenticated;
create function erp.available() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select from erp.permissions where erp.has_permission(code))
$$;
create function public.elhelw_erp_available() returns boolean language sql stable security invoker set search_path='' as $$ select erp.available() $$;
revoke all on function erp.available(),public.elhelw_erp_available() from public,anon;
grant execute on function erp.available(),public.elhelw_erp_available() to authenticated;
commit;
