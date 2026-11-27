-- Fictional acceptance data for an in-memory database bundled with the preview.
begin;
do $$
declare operator_id uuid:='00000000-0000-4000-8000-000000000001'; reviewer uuid:='00000000-0000-4000-8000-000000000002';
 rr uuid; kind text; a uuid; site uuid; store uuid; quarantine uuid; beans uuid; roasted uuid; supp uuid; customer uuid; channel uuid; list uuid; lot uuid;
 fp uuid; doc uuid; qc uuid; spec uuid; recipe uuid; purchase uuid; rec record;
begin
 insert into auth.users(id) values(operator_id),(reviewer);
 insert into erp.roles(code,name) values('REVIEW','مراجع التجربة') returning id into rr;
 insert into erp.user_roles values(reviewer,rr);
 insert into erp.role_permissions select rr,code from erp.permissions where code in ('purchases.approve','quality.read','quality.release','payroll.approve','inventory.read','finance.read');
 insert into erp.user_permissions select operator_id,code,true from erp.permissions where code not in ('purchases.approve','payroll.approve');
 perform set_config('request.jwt.claim.sub',operator_id::text,true);
 for rec in select * from (values
 ('beans','مخزون خام','asset'),('roast','مخزون إنتاج','asset'),('goods_received_unbilled','مشتريات تحت الفوترة','liability'),
 ('opening_equity','أرصدة افتتاحية','equity'),('payables','مورّدون','liability'),('receivables','عملاء','asset'),
 ('cogs','تكلفة المبيعات','expense'),('sales','إيراد المبيعات','revenue'),('cash','خزينة الشركة','asset'),
 ('overhead_absorption','تكاليف صناعية محملة','expense'),('direct_absorption','تكاليف مباشرة محملة','expense'),('abnormal_loss','فاقد غير طبيعي','expense'),
 ('freight_clearing','وسيط النقل','liability'),('payroll_payable','رواتب مستحقة','liability'),('maintenance_expense','مصروف صيانة','expense'),
 ('maintenance_clearing','مقابل مصروف الصيانة','liability'),('commission_expense','مصروف عمولة','expense'),('commission_payable','عمولات مستحقة','liability')
 ) t(code,name,kind) loop
  insert into erp.accounts(code,name,kind) values(rec.code,rec.name,rec.kind) returning id into a;
  insert into erp.posting_accounts values(rec.code,a);
 end loop;
 insert into erp.treasuries(account_id,name,kind) values(erp.posting_account('cash'),'خزينة التجربة','cash');
 insert into erp.fiscal_periods(starts_on,ends_on) values(date_trunc('month',current_date)::date,(date_trunc('month',current_date)+interval '1 month - 1 day')::date) returning id into fp;
 insert into erp.locations(code,name,kind) values('RAW','مخزن المصنع','storage') returning id into site;
 insert into erp.locations(code,name,kind) values('STORE','مخزن البيع المباشر','channel') returning id into store;
 insert into erp.locations(code,name,kind) values('QC','منطقة الحجر','quarantine') returning id into quarantine;
 insert into erp.items(sku,name,kind,base_unit,inventory_account_id) values('DEMO-GREEN','بن أخضر تجريبي','RM','KG',erp.posting_account('beans')) returning id into beans;
 insert into erp.items(sku,name,kind,base_unit,inventory_account_id) values('DEMO-ROAST','بن محمص تجريبي','RB','KG',erp.posting_account('roast')) returning id into roasted;
 insert into erp.suppliers(code,name) values('S-01','مورّد تجريبي') returning id into supp;
 insert into erp.customers(code,name) values('C-01','كافيه تجريبي') returning id into customer;
 insert into erp.channels(code,name,location_id,fulfillment) values('SHOP','بيع مباشر',store,'direct') returning id into channel;
 insert into erp.price_lists(code,name,channel_id) values('P','سعر التجربة',channel) returning id into list;
 insert into erp.price_list_lines(list_id,item_id,price,effective_from) values(list,roasted,300,now());
 spec:=erp.configure_check(jsonb_build_object('stage','receipt','name','مطابق للعينة التجريبية','kind','boolean'));
 perform erp.configure_check(jsonb_build_object('stage','roast','name','درجة التحميص مطابقة للعينة','kind','boolean'));
 for rec in select * from (values (beans,site,'GREEN-01',100,10000),(roasted,store,'ROAST-01',10,1700),(beans,site,'CHECK-02',5,500)) t(item,location,code,qty,val) loop
  insert into erp.lots(item_id,lot_code) values(rec.item,rec.code) returning id into lot;
  insert into erp.stock_documents(source_type,source_id,idempotency_key) values('opening_stock',rec.code,rec.code) returning id into doc;
  perform erp.post_stock_value(doc,rec.item,lot,rec.location,rec.qty,rec.val,erp.posting_account('opening_equity'),fp,current_date);
  if rec.code<>'CHECK-02' then
   qc:=erp.begin_inspection(lot);perform erp.record_inspection(qc,jsonb_build_object(spec::text,true)); perform erp.release_inspected_lot(lot,qc);
  end if;
 end loop;
 perform erp.configure('approval_rule',jsonb_build_object('minimum',0,'steps',jsonb_build_array(jsonb_build_object('role',rr))));
 perform erp.configure('recipe',jsonb_build_object('item',roasted,'stage','roast','code','R1','name','تحميص تجريبي','qty',8,'loss',0.25,'components',jsonb_build_array(jsonb_build_object('item',beans,'qty',10))));
 purchase:=erp.create_purchase(supp,'PO-DEMO-01',jsonb_build_array(jsonb_build_object('item',beans,'qty',20,'price',100)));perform erp.submit_purchase(purchase);
 perform erp.create_direct_order(channel,customer,'SO-DEMO-01',jsonb_build_array(jsonb_build_object('item',roasted,'list_id',list,'qty',2)));
end $$;
commit;
