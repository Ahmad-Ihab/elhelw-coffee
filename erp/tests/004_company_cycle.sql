-- Two signed-in staff exercise the same RPCs used by the app. No company records are read.
begin;
create temp table test_ids(k text primary key,v uuid not null);
grant all on test_ids to authenticated;
create function pg_temp.remember(k text,v uuid) returns uuid language sql as
  'insert into test_ids values($1,$2) returning v';
create function pg_temp.id(k text) returns uuid language sql as 'select v from test_ids where test_ids.k=$1';
create function pg_temp.act(action text,p jsonb) returns jsonb language sql as
  'select public.elhelw_erp_command($1,$2,gen_random_uuid())';
create function pg_temp.new_id(action text,p jsonb) returns uuid language sql as
  'select (pg_temp.act($1,$2)#>>''{}'')::uuid';
create function pg_temp.must_fail(action text,p jsonb,expected text) returns void language plpgsql as $$
begin
  begin perform pg_temp.act(action,p);
  exception when others then if position(expected in sqlerrm)>0 then return; else raise; end if; end;
  raise exception 'Expected failure: %',expected;
end $$;
do $$
declare staff uuid:=gen_random_uuid(); reviewer uuid:=gen_random_uuid(); role_id uuid; perm text; code0 text; aid uuid;
begin
 insert into auth.users(id) values(staff),(reviewer);
 perform pg_temp.remember('staff',staff),pg_temp.remember('reviewer',reviewer);
 insert into erp.roles(code,name) values('QA-reviewer','Reviewer') returning id into role_id;
 insert into erp.user_roles values(staff,role_id),(reviewer,role_id);
 insert into erp.user_permissions select staff,code,true from erp.permissions;
 insert into erp.user_permissions values(reviewer,'purchases.approve',true),(reviewer,'quality.release',true);
 perform pg_temp.remember('role',role_id);
 foreach code0 in array array['beans','roast','goods_received_unbilled','opening_equity','payables','cogs','receivables','sales','cash','direct_absorption'] loop
  insert into erp.accounts(code,name,kind) values(code0,code0,'asset') returning id into aid;
  perform pg_temp.remember(code0,aid);
  insert into erp.posting_accounts values(code0,aid);
 end loop;
end $$;
set local role authenticated;
do $$
declare order0 uuid; line0 uuid; po_receipt uuid; receivedlot uuid; inspection uuid; spec uuid; lot_out uuid;
  recipe uuid; op uuid; s uuid; loc uuid; channel uuid; item uuid; output_item uuid; t uuid; salesloc uuid; quar uuid; buying uuid;
  ws jsonb; key0 uuid:=gen_random_uuid(); a jsonb; first_result jsonb; invoice uuid; supplier_bill uuid; amount numeric;
begin
 perform set_config('request.jwt.claim.sub',pg_temp.id('staff')::text,true);
 ws:=public.elhelw_erp_workspace();
 if not (ws->'permissions' ? 'quality.configure') then raise exception 'Missing staff permission'; end if;
 perform pg_temp.act('setup.period',jsonb_build_object('start',current_date-1,'end',current_date+1));
 loc:=(pg_temp.act('setup.location','{"code":"RAW","name":"Raw","kind":"storage"}')->>'id')::uuid;
 salesloc:=(pg_temp.act('setup.location','{"code":"SHOP","name":"Shop","kind":"channel"}')->>'id')::uuid;
 quar:=(pg_temp.act('setup.location','{"code":"QC","name":"Quarantine","kind":"quarantine"}')->>'id')::uuid;
 item:=(pg_temp.act('setup.item',jsonb_build_object('code','BEAN','name','Bean','kind','RM','unit','KG','account',pg_temp.id('beans')))->>'id')::uuid;
 output_item:=(pg_temp.act('setup.item',jsonb_build_object('code','ROAST','name','Roast','kind','RB','unit','KG','account',pg_temp.id('roast')))->>'id')::uuid;
 s:=(pg_temp.act('setup.supplier','{"code":"S","name":"Supplier"}')->>'id')::uuid;
 t:=(pg_temp.act('setup.treasury',jsonb_build_object('account',pg_temp.id('cash'),'name','Cash','kind','cash'))->>'id')::uuid;
 perform pg_temp.act('setup.approval_rule',jsonb_build_object('minimum',0,'steps',jsonb_build_array(jsonb_build_object('role',pg_temp.id('role')))));
 a:=jsonb_build_object('supplier',s,'code','PO1','lines',jsonb_build_array(jsonb_build_object('item',item,'qty',10,'price',100)));
 first_result:=public.elhelw_erp_command('purchase_new',a,key0);
 if first_result<>public.elhelw_erp_command('purchase_new',a,key0) then raise exception 'Retry created a second order'; end if;
 order0:=(first_result#>>'{}')::uuid;
 perform pg_temp.act('purchase_submit',jsonb_build_object('order',order0));
 perform pg_temp.must_fail('purchase_decide',jsonb_build_object('order',order0,'decision','approved'),'own purchase');
 perform set_config('request.jwt.claim.sub',pg_temp.id('reviewer')::text,true);
 perform pg_temp.must_fail('purchase_new',a,'Missing permission');
 if public.elhelw_erp_workspace()->'choices' ? 'suppliers' then raise exception 'Supplier data visible outside permissions'; end if;
 perform pg_temp.act('purchase_decide',jsonb_build_object('order',order0,'decision','approved'));
 perform set_config('request.jwt.claim.sub',pg_temp.id('staff')::text,true);
 line0:=(public.elhelw_erp_workspace()#>>'{choices,purchase_lines,0,id}')::uuid;
 a:=jsonb_build_object('line',line0,'qty',11,'location',loc,'lot_code','IN1','date',current_date);
 perform pg_temp.must_fail('purchase_receive',a,'outstanding quantity');
 perform pg_temp.act('purchase_receive',a||'{"qty":10}');
 receivedlot:=(public.elhelw_erp_workspace()#>>'{choices,pending_lots,0,id}')::uuid;
 perform pg_temp.must_fail('inspect_start',jsonb_build_object('lot',receivedlot),'No mandatory');
 spec:=pg_temp.new_id('spec',jsonb_build_object('item',item,'stage','receipt','name','Moisture','kind','numeric','max',12));
 inspection:=pg_temp.new_id('inspect_start',jsonb_build_object('lot',receivedlot));
 perform pg_temp.must_fail('inspect_record',jsonb_build_object('inspection',inspection,'values','{}'::jsonb),'invalid reading');
 perform pg_temp.act('inspect_record',jsonb_build_object('inspection',inspection,'values',jsonb_build_object(spec::text,13)));
 if public.elhelw_erp_workspace()#>>'{records,quality,0,quality_status}'<>'quarantine' then raise exception 'Failed lot not quarantined'; end if;
 inspection:=pg_temp.new_id('inspect_start',jsonb_build_object('lot',receivedlot));
 perform pg_temp.act('inspect_record',jsonb_build_object('inspection',inspection,'values',jsonb_build_object(spec::text,12)));
 perform pg_temp.act('inspect_release',jsonb_build_object('inspection',inspection));
 perform pg_temp.act('inspect_release',jsonb_build_object('inspection',inspection));
 po_receipt:=(public.elhelw_erp_workspace()#>>'{choices,billable,0,id}')::uuid;
 supplier_bill:=pg_temp.new_id('purchase_bill',jsonb_build_object('supplier',s,'code','SUP-1','date',current_date,'lines',jsonb_build_array(jsonb_build_object('receipt',po_receipt))));
 perform pg_temp.act('settle',jsonb_build_object('kind','payment','invoice',supplier_bill,'treasury',t,'amount',1000,'date',current_date));
 perform pg_temp.must_fail('settle',jsonb_build_object('kind','payment','invoice',supplier_bill,'treasury',t,'amount',1,'date',current_date),'exceeds invoice');
 recipe:=(pg_temp.act('setup.recipe',jsonb_build_object('item',output_item,'stage','roast','code','R1','name','Roast','qty',8,'loss',0.2,'components',jsonb_build_array(jsonb_build_object('item',item,'qty',10))))->>'id')::uuid;
 op:=pg_temp.new_id('operation_new',jsonb_build_object('recipe',recipe,'code','WO1','qty',8,'direct',80));
 a:=jsonb_build_object('operation',op,'location',loc,'date',current_date,'lot_code','OUT','qty',7,'abnormal',0,'inputs',jsonb_build_array(jsonb_build_object('lot',receivedlot,'location',loc,'qty',10)));
 perform pg_temp.must_fail('operation_finish',a,'outside approved tolerance');
 lot_out:=pg_temp.new_id('operation_finish',a||'{"qty":8}');
 spec:=pg_temp.new_id('spec',jsonb_build_object('stage','roast','name','Roast OK','kind','boolean'));
 inspection:=pg_temp.new_id('inspect_start',jsonb_build_object('lot',lot_out));
 perform pg_temp.act('inspect_record',jsonb_build_object('inspection',inspection,'values',jsonb_build_object(spec::text,true)));
 perform pg_temp.act('inspect_release',jsonb_build_object('inspection',inspection));
 perform pg_temp.act('transfer',jsonb_build_object('lot',lot_out,'from',loc,'to',salesloc,'qty',5));
 channel:=(pg_temp.act('setup.channel',jsonb_build_object('location',salesloc,'code','SHOP','name','Shop','kind','direct'))->>'id')::uuid;
 s:=(pg_temp.act('setup.customer','{"code":"C","name":"Buyer"}')->>'id')::uuid;
 buying:=(pg_temp.act('setup.price_list',jsonb_build_object('code','P','name','Standard','channel',channel))->>'id')::uuid;
 perform pg_temp.act('setup.price',jsonb_build_object('list_id',buying,'item',output_item,'price',200));
 perform pg_temp.act('sale_new',jsonb_build_object('code','SO1','channel',channel,'customer',s,'lines',jsonb_build_array(jsonb_build_object('item',output_item,'qty',5,'list_id',buying,'discount',5))));
 line0:=(public.elhelw_erp_workspace()#>>'{choices,sale_lines,0,id}')::uuid;
 invoice:=pg_temp.new_id('sale_deliver',jsonb_build_object('line',line0,'lot',lot_out,'qty',5,'date',current_date));
 line0:=(public.elhelw_erp_workspace()#>>'{choices,return_lines,0,id}')::uuid;
 perform pg_temp.act('sale_return',jsonb_build_object('line',line0,'location',quar,'reason','Return','qty',1,'date',current_date));
 perform pg_temp.act('settle',jsonb_build_object('kind','receipt','invoice',invoice,'treasury',t,'amount',796,'date',current_date));
 perform pg_temp.remember('output',lot_out),pg_temp.remember('input',receivedlot);
end $$;
reset role;
do $$
begin
 if exists(select from erp.inventory_reconciliation where not reconciled) then raise exception 'Inventory does not reconcile'; end if;
 if (select sum(net) from erp.trial_balance) is distinct from 0::numeric then raise exception 'Trial balance mismatch'; end if;
 if (select net from erp.trial_balance where code='receivables')<>0 or (select net from erp.trial_balance where code='payables')<>0
    or (select net from erp.trial_balance where code='cogs')<>540 then raise exception 'Settlement or COGS mismatch'; end if;
 if (select count(*) from erp.trace_lot_ancestors(pg_temp.id('output')) where lot_id=pg_temp.id('input'))<>1 then raise exception 'Missing manufacturing genealogy'; end if;
 if has_table_privilege('authenticated','erp.stock_balances','UPDATE') or has_function_privilege('anon','public.elhelw_erp_workspace()','EXECUTE') then raise exception 'Unexpected access grant'; end if;
end $$;
rollback;
