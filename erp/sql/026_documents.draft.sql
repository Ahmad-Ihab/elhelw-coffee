begin;
insert into erp.permissions values ('setup.configure','Configure ERP master data and posting rules');
create function erp.create_purchase(p_supplier uuid,p_code text,p_lines jsonb) returns uuid language plpgsql set search_path='' as $$
declare doc uuid; line record;
begin
  perform erp.require_permission('purchases.manage');
  perform id from erp.suppliers where id=p_supplier and active for share;
  if not found or nullif(trim(p_code),'') is null or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines)=0 then raise exception 'Supplier, number and purchase lines required'; end if;
  insert into erp.purchase_orders(code,supplier_id) values(trim(p_code),p_supplier) returning id into doc;
  for line in select * from jsonb_to_recordset(p_lines) x(item uuid,qty numeric,price numeric) loop
    if not exists(select from erp.items where id=line.item and active and (base_unit<>'EA' or line.qty=trunc(line.qty)))
      or line.qty<>round(line.qty,6) or line.price<>round(line.price,8) then raise exception 'Invalid purchase line'; end if;
    insert into erp.purchase_order_lines(order_id,item_id,quantity,unit_price) values(doc,line.item,line.qty,line.price);
  end loop;
  return doc;
end $$;
create function erp.create_direct_order(p_channel uuid,p_customer uuid,p_code text,p_lines jsonb) returns uuid language plpgsql set search_path='' as $$
declare doc uuid; line record; price numeric;
begin
  perform erp.require_permission('sales.manage');
  perform id from erp.channels where id=p_channel and fulfillment='direct' for share;
  if not found or not exists(select from erp.customers where id=p_customer and active) or nullif(trim(p_code),'') is null
    or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines)=0 then raise exception 'Direct channel, customer, order number and lines required'; end if;
  insert into erp.sales_orders(channel_id,customer_id,code,status) values(p_channel,p_customer,trim(p_code),'confirmed') returning id into doc;
  for line in select * from jsonb_to_recordset(p_lines) x(item uuid,qty numeric,list_id uuid,discount numeric) loop
    if not exists(select from erp.items where id=line.item and active and (base_unit<>'EA' or line.qty=trunc(line.qty))) or line.qty<>round(line.qty,6)
      or line.discount<>round(line.discount,8) then raise exception 'Invalid sales line'; end if;
    select l.price into strict price from erp.price_list_lines l join erp.price_lists h on h.id=l.list_id where l.item_id=line.item and l.list_id=line.list_id and
      (h.channel_id=p_channel or h.channel_id is null) and l.effective_from<=now() order by l.effective_from desc limit 1;
    insert into erp.sales_order_lines(order_id,item_id,quantity,unit_price,discount) values(doc,line.item,line.qty,price,coalesce(line.discount,0));
  end loop;
  return doc;
end $$;
create function erp.prepare_operation(p_recipe uuid,p_order_code text,p_qty numeric,p_direct numeric) returns uuid language plpgsql set search_path='' as $$
declare wo uuid; op uuid; s text;
begin
  perform erp.require_permission('manufacturing.post');
  select p.stage into strict s from erp.manufacturing_policy p join erp.bom_versions v on v.id=p.version_id where v.id=p_recipe and v.status='approved';
  if p_qty is null or p_qty<=0 or p_qty<>round(p_qty,6) or p_direct is null or p_direct<0 or p_direct<>round(p_direct,8) then raise exception 'Invalid production plan'; end if;
  if nullif(trim(p_order_code),'') is not null then
    insert into erp.work_orders(code,version_id,planned_quantity,status) values(trim(p_order_code),p_recipe,p_qty,'approved') returning id into wo;
  end if;
  insert into erp.operations(work_order_id,stage,recipe_version_id) values(wo,s,p_recipe) returning id into op;
  if p_direct>0 then insert into erp.operation_costs(operation_id,category,amount) values(op,'other',p_direct); end if;
  return op;
end $$;
create function erp.stage_opening(p_data jsonb) returns uuid language plpgsql set search_path='' as $$
declare batch uuid;
begin
  perform erp.require_permission('migration.stage');
  if nullif(trim(p_data->>'reference'),'') is null or jsonb_typeof(p_data->'rows') is distinct from 'array' then raise exception 'Invalid count file'; end if;
  insert into erp.opening_runs(reference,as_of,expected_lines,expected_value,expected_quantities)
    values(p_data->>'reference',(p_data->>'as_of')::date,(p_data->>'expected_lines')::integer,(p_data->>'expected_value')::numeric,p_data->'expected_quantities') returning id into batch;
  insert into erp.opening_rows select batch,r.source_table,r.source_key,r.lot_code,r.location_code,r.base_unit,r.quantity,r.total_value,r.expires_on
    from jsonb_to_recordset(p_data->'rows') r(source_table text,source_key text,lot_code text,location_code text,base_unit text,quantity numeric,total_value numeric,expires_on date);
  return batch;
end $$;
create function erp.configure_check(p jsonb) returns uuid language plpgsql set search_path='' as $$
declare id0 uuid; kind text:=p->>'kind'; stage0 text:=p->>'stage'; low numeric:=(p->>'min')::numeric; high numeric:=(p->>'max')::numeric;
begin
  perform erp.require_permission('quality.configure');
  if stage0 is null or stage0 not in ('receipt','blend','roast','grind','flavor','pack') or nullif(trim(p->>'name'),'') is null or
    (kind='numeric' and low is null and high is null) or (kind='text' and nullif(p->>'expected','') is null) then raise exception 'Invalid quality specification'; end if;
  insert into erp.quality_specs(item_id,stage,test_name,result_kind,min_value,max_value,unit,expected_text,mandatory)
   values((p->>'item')::uuid,stage0,trim(p->>'name'),kind,low,high,p->>'unit',p->>'expected',coalesce((p->>'mandatory')::boolean,true)) returning id into id0;
  return id0;
end $$;
revoke all on all functions in schema erp from public,anon,authenticated;
commit;
