begin;
do $$
declare actor uuid:=gen_random_uuid(); dist uuid:=gen_random_uuid(); asset uuid; a uuid; acct text; cash uuid; custody uuid; shop uuid; quarantine uuid; c uuid; item uuid; lot uuid; buyer uuid; prices uuid; sale uuid; l uuid; invoice uuid; data jsonb; refund uuid;
begin
 insert into auth.users values(actor);insert into erp.user_permissions select actor,code,true from erp.permissions;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 insert into public.distributors(id) values(dist);
 insert into erp.fiscal_periods(starts_on,ends_on) values(current_date,current_date);
 foreach acct in array array['inventory','opening_equity','cash','custody','sales','commission_payable','commission_expense','receivables','cogs'] loop
  insert into erp.accounts(code,name,kind) values(acct,acct,'asset') returning id into a;insert into erp.posting_accounts values(acct,a);
 end loop;
 insert into erp.treasuries(name,kind,account_id) values('Company','cash',erp.posting_account('cash')) returning id into cash;
 insert into erp.treasuries(name,kind,account_id) values('Custody','advance',erp.posting_account('custody')) returning id into custody;
 insert into erp.locations(code,name,kind) values('ROUTE','Route stock','channel') returning id into shop;
 insert into erp.locations(code,name,kind) values('QC','QC','quarantine') returning id into quarantine;
 insert into erp.channels(code,name,location_id,fulfillment) values('A','Area A',shop,'distributor') returning id into c;
 insert into erp.distributor_routes values(dist,'Test Distributor',c,custody);
 insert into erp.items(sku,name,kind,base_unit,net_weight_kg,inventory_account_id) values('FG','Coffee','FG','EA',0.1,erp.posting_account('inventory')) returning id into item;
 insert into erp.lots(item_id,lot_code,quality_status) values(item,'SELL','released') returning id into lot;
 insert into erp.stock_documents(source_type,source_id,idempotency_key) values('opening_stock','test','test-opening') returning id into a;
 perform erp.post_stock_value(a,item,lot,shop,10,300,erp.posting_account('opening_equity'),erp.open_period(current_date),current_date);
 insert into erp.customers(code,name) values('C','Cafe') returning id into buyer;
 insert into erp.price_lists(code,name,channel_id) values('P','Retail',c) returning id into prices;
 insert into erp.price_list_lines(list_id,item_id,price,effective_from) values(prices,item,50,now());
 insert into erp.channel_commissions values(c,item,now(),'percentage',10);
 data:=jsonb_build_object('distributor',dist,'customer',buyer,'code','SO','lines',jsonb_build_array(jsonb_build_object('item',item,'list_id',prices,'qty',10)));
 sale:=(erp.command('distribution_new',data||'{"code":"CANCEL"}',gen_random_uuid())#>>'{}')::uuid;
 perform erp.command('sale_cancel',jsonb_build_object('order',sale),gen_random_uuid());
 if (select sum(suggested) from erp.suggest_lots(item,shop,10)) is distinct from 10::numeric then raise exception 'Cancellation did not release stock';end if;
 sale:=(erp.command('distribution_new',data,gen_random_uuid())#>>'{}')::uuid;
 select id into strict l from erp.sales_order_lines where order_id=sale;
 invoice:=(erp.command('sale_deliver',jsonb_build_object('line',l,'lot',lot,'qty',10,'date',current_date),gen_random_uuid())#>>'{}')::uuid;
 perform erp.command('distribution_collect',jsonb_build_object('invoice',invoice,'amount',500,'date',current_date),gen_random_uuid());
 perform erp.command('distribution_remit',jsonb_build_object('distributor',dist,'treasury',cash,'amount',500,'date',current_date),gen_random_uuid());
 select id into strict l from erp.sales_invoice_lines where invoice_id=invoice;
 data:=jsonb_build_object('line',l,'qty',2,'date',current_date,'reason','Test refund','location',quarantine);
 begin perform erp.command('sale_return',data,gen_random_uuid());raise exception 'Expected company treasury';
 exception when no_data_found then null;end;
 refund:=(erp.command('sale_return',data||jsonb_build_object('treasury',cash),gen_random_uuid())#>>'{}')::uuid;
 if (select net from erp.trial_balance where code='cash') is distinct from 400::numeric or
  (select net from erp.trial_balance where code='custody') is distinct from 0::numeric or
  (select net from erp.trial_balance where code='commission_payable') is distinct from -40::numeric or
  (select net from erp.trial_balance where code='receivables') is distinct from 0::numeric or
  (select refund_voucher_id from erp.sales_returns where id=refund) is null then raise exception 'Incorrect company funded refund/commission/custody';end if;
 if exists(select from erp.inventory_reconciliation where not reconciled) then raise exception 'Returned stock does not reconcile';end if;
end $$;
rollback;
