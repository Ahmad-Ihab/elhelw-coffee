begin;
do $$
declare actor uuid:=gen_random_uuid(); raw uuid; green uuid; out_id uuid; lot uuid; loc uuid; s uuid; fp uuid; d uuid; a uuid; purpose text; v1 uuid; v2 uuid;
 po uuid; pl uuid; rc uuid; sel jsonb:='[]'; cost numeric; n int; q numeric; count_lines int;
begin
 insert into auth.users values(actor);insert into erp.user_permissions select actor,code,true from erp.permissions;perform set_config('request.jwt.claim.sub',actor::text,true);
 foreach purpose in array array['raw','fg','goods_received_unbilled','freight_clearing','payables'] loop
  insert into erp.accounts(code,name,kind) values(purpose,purpose,'asset') returning id into a;insert into erp.posting_accounts values(purpose,a);
 end loop;
 insert into erp.locations(code,name,kind) values('W','Raw','storage') returning id into loc;
 insert into erp.fiscal_periods(starts_on,ends_on) values(current_date,current_date) returning id into fp;
 insert into erp.suppliers(code,name) values('S','Supplier') returning id into s;
 insert into erp.items(sku,name,kind,base_unit,inventory_account_id) values('A','Raw','RM','KG',erp.posting_account('raw')) returning id into raw;
 insert into erp.items(sku,name,kind,base_unit,inventory_account_id) values('B','Blend','GB','KG',erp.posting_account('raw')) returning id into green;
 insert into erp.items(sku,name,kind,base_unit,inventory_account_id) values('C','Roasted','RB','KG',erp.posting_account('fg')) returning id into out_id;
 po:=erp.create_purchase(s,'P',jsonb_build_array(jsonb_build_object('item',raw,'qty',5,'price',20)));
 update erp.purchase_orders set status='approved' where id=po;select id into pl from erp.purchase_order_lines where order_id=po;
 for n in 1..2 loop
  insert into erp.lots(item_id,lot_code) values(raw,'L'||n) returning id into lot;
  rc:=erp.receive_purchase(pl,lot,loc,case n when 1 then 2 else 3 end,current_date);
  sel:=sel||jsonb_build_array(jsonb_build_object('receipt',(select id from erp.receipt_lines where receipt_id=rc)));
 end loop;
 perform erp.freight_invoice(jsonb_build_object('supplier',s,'code','F','amount',25,'date',current_date,'lines',sel));
 select total_value into cost from erp.item_valuation where item_id=raw;
 if cost is distinct from 125::numeric or (select array_agg(amount order by amount) from erp.landed_cost_allocations) is distinct from array[10,15]::numeric[]
   or (select net from erp.trial_balance where code='freight_clearing')<>0 then raise exception 'Landed cost did not reconcile';end if;
 v1:=(erp.configure('recipe',jsonb_build_object('item',green,'stage','blend','qty',1,'loss',0,'name','Blend','code','B','components',jsonb_build_array(jsonb_build_object('item',raw,'qty',1))))->>'id')::uuid;
 v2:=(erp.configure('recipe',jsonb_build_object('item',out_id,'stage','roast','qty',8,'loss',0.2,'name','Roast','code','R','components',jsonb_build_array(jsonb_build_object('item',green,'qty',10))))->>'id')::uuid;
 perform erp.linked_work_order(jsonb_build_object('code','JOB','qty',8,'steps',jsonb_build_array(jsonb_build_object('recipe',v1),jsonb_build_object('recipe',v2))));
 select count(*) into count_lines from erp.operations;
 if count_lines<>2 then raise exception 'Linked stages missing';end if;
 insert into erp.planning_recipes values(green,loc,v1),(out_id,loc,v2);
 update erp.lots set quality_status='released' where item_id=raw;
 select shortage into q from erp.component_plan(out_id,loc,8) where item_id=raw;
 if q is distinct from 5::numeric then raise exception 'BOM explosion did not net available materials: %',q;end if;
 if exists(select from erp.inventory_reconciliation where not reconciled) then raise exception 'Cost-only adjustment broke reconciliation';end if;
end $$;
rollback;
