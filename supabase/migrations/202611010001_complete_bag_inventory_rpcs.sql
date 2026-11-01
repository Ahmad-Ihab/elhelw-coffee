-- Reproducible definitions for the live bag-based inventory RPCs.
-- Existing balances with NULL bag_counts remain legacy/unknown; no counts are inferred.
CREATE OR REPLACE FUNCTION public.admin_adjust_stock_bags(p_distributor_id uuid, p_product_id uuid, p_bags jsonb, p_direction text, p_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_kg numeric; v_stock jsonb; v_new jsonb;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
 IF p_direction NOT IN ('in','out') THEN RAISE EXCEPTION 'Direction must be in or out'; END IF;
 v_kg:=public.bags_to_kg(p_bags);
 SELECT bag_counts INTO v_stock FROM public.stock_balances WHERE distributor_id=p_distributor_id AND product_id=p_product_id FOR UPDATE;
 IF p_direction='out' THEN
  IF v_stock IS NULL THEN RAISE EXCEPTION 'Bag-level stock is not initialized'; END IF;
  v_new:=public.bags_subtract(v_stock,p_bags);
  UPDATE public.stock_balances SET quantity=quantity-v_kg,bag_counts=v_new WHERE distributor_id=p_distributor_id AND product_id=p_product_id AND quantity>=v_kg;
  IF NOT FOUND THEN RAISE EXCEPTION 'Insufficient stock'; END IF;
 ELSE
  INSERT INTO public.stock_balances(distributor_id,product_id,quantity,bag_counts) VALUES(p_distributor_id,p_product_id,v_kg,p_bags)
  ON CONFLICT(distributor_id,product_id) DO UPDATE SET quantity=public.stock_balances.quantity+EXCLUDED.quantity,bag_counts=public.bags_add(COALESCE(public.stock_balances.bag_counts,'{}'::jsonb),EXCLUDED.bag_counts);
 END IF;
 INSERT INTO public.stock_movements(distributor_id,product_id,movement_type,quantity,bag_counts,notes,created_by)
 VALUES(p_distributor_id,p_product_id,CASE WHEN p_direction='in' THEN 'adjustment_in' ELSE 'adjustment_out' END,v_kg,p_bags,p_notes,auth.uid());
END; $function$


CREATE OR REPLACE FUNCTION public.admin_delete_cafe(p_cafe_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_cafe public.cafes%ROWTYPE; v_has_history boolean;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
 SELECT * INTO v_cafe FROM public.cafes WHERE id=p_cafe_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Cafe not found'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.orders WHERE cafe_id=p_cafe_id)
 OR EXISTS(SELECT 1 FROM public.sales_invoices WHERE cafe_id=p_cafe_id)
 OR EXISTS(SELECT 1 FROM public.samples WHERE cafe_id=p_cafe_id)
 OR EXISTS(SELECT 1 FROM public.cafe_payments WHERE cafe_id=p_cafe_id)
 INTO v_has_history;
 IF v_has_history THEN
  UPDATE public.cafes SET active=false,status='inactive' WHERE id=p_cafe_id;
  RETURN 'archived';
 END IF;
 DELETE FROM public.cafes WHERE id=p_cafe_id;
 RETURN 'deleted';
END; $function$


CREATE OR REPLACE FUNCTION public.admin_receive_stock_bags(p_distributor_id uuid, p_product_id uuid, p_bags jsonb, p_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_kg numeric; v_existing jsonb;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
 v_kg := public.bags_to_kg(p_bags);
 IF NOT EXISTS(SELECT 1 FROM public.distributors WHERE id=p_distributor_id AND active=true) THEN RAISE EXCEPTION 'Invalid distributor'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.products WHERE id=p_product_id AND active=true) THEN RAISE EXCEPTION 'Invalid product'; END IF;
 INSERT INTO public.stock_balances(distributor_id,product_id,quantity,bag_counts)
 VALUES(p_distributor_id,p_product_id,v_kg,p_bags)
 ON CONFLICT(distributor_id,product_id) DO UPDATE
 SET quantity=public.stock_balances.quantity+EXCLUDED.quantity,
     bag_counts=public.bags_add(COALESCE(public.stock_balances.bag_counts,'{}'::jsonb),EXCLUDED.bag_counts);
 INSERT INTO public.stock_movements(distributor_id,product_id,movement_type,quantity,bag_counts,notes,created_by)
 VALUES(p_distributor_id,p_product_id,'receipt',v_kg,p_bags,p_notes,auth.uid());
END;
$function$


CREATE OR REPLACE FUNCTION public.create_distributor_order_bags(p_cafe_id uuid, p_distributor_id uuid, p_product_id uuid, p_bags jsonb, p_expected_delivery date DEFAULT NULL::date, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_order_id uuid; v_kg numeric; v_distributor uuid;
BEGIN
 v_kg := public.bags_to_kg(p_bags);
 IF public.is_admin() THEN v_distributor:=p_distributor_id;
 ELSE v_distributor:=public.current_distributor_id(); IF v_distributor IS DISTINCT FROM p_distributor_id THEN RAISE EXCEPTION 'Not authorized'; END IF; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.distributors WHERE id=v_distributor AND active=true) THEN RAISE EXCEPTION 'Invalid distributor'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cafes WHERE id=p_cafe_id AND distributor_id=v_distributor AND active=true) THEN RAISE EXCEPTION 'Invalid cafe'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.products WHERE id=p_product_id AND active=true) THEN RAISE EXCEPTION 'Invalid product'; END IF;
 INSERT INTO public.orders(distributor_id,cafe_id,order_date,expected_delivery,status,notes)
 VALUES(v_distributor,p_cafe_id,current_date,p_expected_delivery,'confirmed',p_notes)
 RETURNING id INTO v_order_id;
 INSERT INTO public.order_items(order_id,product_id,quantity,bag_counts)
 VALUES(v_order_id,p_product_id,v_kg,p_bags);
 RETURN v_order_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.deliver_order(p_order_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
 o public.orders%ROWTYPE; it RECORD; v_price numeric; v_cost numeric; v_type text; v_rate numeric;
 v_line numeric; v_comm numeric; v_net numeric; v_total numeric:=0; v_comm_total numeric:=0;
 v_invoice uuid; v_items jsonb:='[]'::jsonb; v_item_count integer:=0; v_item jsonb;
 v_stock jsonb; v_new_bags jsonb; v_kg numeric;
BEGIN
 SELECT * INTO o FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
 IF NOT (public.is_admin() OR o.distributor_id=public.current_distributor_id()) THEN RAISE EXCEPTION 'Not authorized'; END IF;
 IF o.status NOT IN ('confirmed','preparing') THEN RAISE EXCEPTION 'Order is not deliverable'; END IF;
 FOR it IN SELECT * FROM public.order_items WHERE order_id=o.id ORDER BY id LOOP
  v_item_count:=v_item_count+1;
  IF it.quantity IS NULL OR it.quantity<=0 THEN RAISE EXCEPTION 'Invalid quantity for product %',it.product_id; END IF;
  v_kg:=it.quantity;
  IF it.bag_counts IS NOT NULL THEN
   v_kg:=public.bags_to_kg(it.bag_counts);
   SELECT bag_counts INTO v_stock FROM public.stock_balances
    WHERE distributor_id=o.distributor_id AND product_id=it.product_id FOR UPDATE;
   IF v_stock IS NULL THEN RAISE EXCEPTION 'Bag-level stock missing for product %',it.product_id; END IF;
   v_new_bags:=public.bags_subtract(v_stock,it.bag_counts);
   UPDATE public.stock_balances SET quantity=quantity-v_kg,bag_counts=v_new_bags
    WHERE distributor_id=o.distributor_id AND product_id=it.product_id AND quantity>=v_kg;
  ELSE
   UPDATE public.stock_balances SET quantity=quantity-v_kg
    WHERE distributor_id=o.distributor_id AND product_id=it.product_id AND quantity>=v_kg;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Insufficient stock for product %',it.product_id; END IF;
  SELECT cost_per_unit INTO v_cost FROM public.products WHERE id=it.product_id AND active=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product % is inactive or missing',it.product_id; END IF;
  IF v_cost IS NULL OR v_cost<0 THEN RAISE EXCEPTION 'Invalid product cost for %',it.product_id; END IF;
  SELECT price INTO v_price FROM public.product_prices WHERE product_id=it.product_id AND effective_from<=now() ORDER BY effective_from DESC,id DESC LIMIT 1;
  IF NOT FOUND OR v_price IS NULL THEN RAISE EXCEPTION 'No active product price for %',it.product_id; END IF;
  SELECT commission_type,commission_value INTO v_type,v_rate FROM public.commission_rules
   WHERE distributor_id=o.distributor_id AND product_id=it.product_id AND active=true AND effective_from<=now()
   ORDER BY effective_from DESC,id DESC LIMIT 1;
  IF NOT FOUND THEN v_type:='percentage';v_rate:=0; END IF;
  IF v_rate IS NULL OR v_rate<0 THEN RAISE EXCEPTION 'Invalid commission value'; END IF;
  IF v_type NOT IN ('percentage','per_kg') THEN RAISE EXCEPTION 'Invalid commission type'; END IF;
  IF v_type='percentage' AND v_rate>100 THEN RAISE EXCEPTION 'Commission percentage cannot exceed 100'; END IF;
  v_line:=round(v_kg*v_price,2);
  IF v_type='percentage' THEN v_comm:=round(v_line*v_rate/100,2); ELSE v_comm:=round(v_kg*v_rate,2); END IF;
  IF v_comm>v_line THEN RAISE EXCEPTION 'Commission cannot exceed line total'; END IF;
  v_net:=v_line-v_comm;
  v_items:=v_items||jsonb_build_array(jsonb_build_object('product_id',it.product_id,'quantity',v_kg,'bag_counts',it.bag_counts,'unit_price',v_price,'unit_cost',v_cost,'line_total',v_line,'commission_type',v_type,'commission_value',v_rate,'commission_amount',v_comm,'company_net',v_net));
  v_total:=v_total+v_line;v_comm_total:=v_comm_total+v_comm;
 END LOOP;
 IF v_item_count=0 THEN RAISE EXCEPTION 'Order has no items'; END IF;
 INSERT INTO public.sales_invoices(order_id,distributor_id,cafe_id,total_amount,total_commission,company_net)
 VALUES(o.id,o.distributor_id,o.cafe_id,v_total,v_comm_total,v_total-v_comm_total) RETURNING id INTO v_invoice;
 FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
  INSERT INTO public.sales_invoice_items(invoice_id,product_id,quantity,unit_price,line_total,commission_type,commission_value,commission_amount,company_net,unit_cost,bag_counts)
  VALUES(v_invoice,(v_item->>'product_id')::uuid,(v_item->>'quantity')::numeric,(v_item->>'unit_price')::numeric,(v_item->>'line_total')::numeric,v_item->>'commission_type',(v_item->>'commission_value')::numeric,(v_item->>'commission_amount')::numeric,(v_item->>'company_net')::numeric,(v_item->>'unit_cost')::numeric,v_item->'bag_counts');
  INSERT INTO public.stock_movements(distributor_id,product_id,movement_type,quantity,bag_counts,reference_id,created_by)
  VALUES(o.distributor_id,(v_item->>'product_id')::uuid,'delivery',(v_item->>'quantity')::numeric,v_item->'bag_counts',o.id,auth.uid());
 END LOOP;
 UPDATE public.orders SET status='delivered' WHERE id=o.id;
 RETURN v_invoice;
END;
$function$


CREATE OR REPLACE FUNCTION public.process_return_quarantine_bags(p_return_item_id uuid, p_bags jsonb, p_disposition text, p_destination_distributor_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
 v_item public.sales_return_items%rowtype;
 v_kg numeric;
 v_received jsonb;
 v_processed jsonb;
 v_left jsonb;
 v_id uuid;
 v_return_id uuid;
begin
 if not public.is_admin() then raise exception 'Only admin can process returns'; end if;
 v_kg:=public.bags_to_kg(p_bags);
 if p_disposition not in ('released_to_company','released_to_distributor','damaged') then raise exception 'Invalid disposition'; end if;
 if (p_disposition='released_to_distributor')<>(p_destination_distributor_id is not null) then raise exception 'Destination distributor is required only for distributor release'; end if;
 select * into v_item from public.sales_return_items where id=p_return_item_id for update;
 if not found or v_item.bag_counts is null then raise exception 'Bag-level return item not found'; end if;
 v_return_id:=v_item.return_id;
 select coalesce(jsonb_object_agg(k,total),'{}'::jsonb) into v_received
 from (select k,sum(val::integer) total from public.return_quarantine_movements q
 cross join lateral jsonb_each_text(q.bag_counts) e(k,val)
 where q.return_item_id=p_return_item_id and q.movement_type='received' group by k) x;
 select coalesce(jsonb_object_agg(k,total),'{}'::jsonb) into v_processed
 from (select k,sum(val::integer) total from public.return_quarantine_movements q
 cross join lateral jsonb_each_text(q.bag_counts) e(k,val)
 where q.return_item_id=p_return_item_id and q.movement_type in ('released_to_company','released_to_distributor','damaged') group by k) x;
 v_left:=public.bags_subtract(v_received,v_processed);
 perform public.bags_subtract(v_left,p_bags);
 if p_disposition='released_to_distributor' then
  if not exists(select 1 from public.distributors where id=p_destination_distributor_id and active) then raise exception 'Invalid destination distributor'; end if;
  insert into public.stock_balances(distributor_id,product_id,quantity,bag_counts) values(p_destination_distributor_id,v_item.product_id,v_kg,p_bags)
  on conflict(distributor_id,product_id) do update set quantity=public.stock_balances.quantity+excluded.quantity,
   bag_counts=public.bags_add(coalesce(public.stock_balances.bag_counts,'{}'::jsonb),excluded.bag_counts);
  insert into public.stock_movements(distributor_id,product_id,movement_type,quantity,bag_counts,reference_id,created_by)
  values(p_destination_distributor_id,v_item.product_id,'return',v_kg,p_bags,p_return_item_id,auth.uid());
 elsif p_disposition='released_to_company' then
  insert into public.company_stock_balances(product_id,quantity,bag_counts) values(v_item.product_id,v_kg,p_bags)
  on conflict(product_id) do update set quantity=public.company_stock_balances.quantity+excluded.quantity,
   bag_counts=public.bags_add(coalesce(public.company_stock_balances.bag_counts,'{}'::jsonb),excluded.bag_counts);
  insert into public.company_stock_movements(product_id,movement_type,quantity,bag_counts,reference_id,notes,created_by)
  values(v_item.product_id,'return',v_kg,p_bags,p_return_item_id,p_notes,auth.uid());
 else
  insert into public.company_stock_movements(product_id,movement_type,quantity,bag_counts,reference_id,notes,created_by)
  values(v_item.product_id,'damage',v_kg,p_bags,p_return_item_id,p_notes,auth.uid());
 end if;
 insert into public.return_quarantine_movements(return_item_id,movement_type,quantity,bag_counts,destination_distributor_id,notes,created_by)
 values(p_return_item_id,p_disposition,v_kg,p_bags,p_destination_distributor_id,p_notes,auth.uid()) returning id into v_id;
 if not exists (
  select 1 from public.sales_return_items ri
  where ri.return_id=v_return_id and
   coalesce((select sum(q.quantity) from public.return_quarantine_movements q where q.return_item_id=ri.id and q.movement_type='received'),0)
   >
   coalesce((select sum(q.quantity) from public.return_quarantine_movements q where q.return_item_id=ri.id and q.movement_type in ('released_to_company','released_to_distributor','damaged')),0)
 ) then
  update public.sales_returns set inspection_status='completed' where id=v_return_id;
 end if;
 return v_id;
end;
$function$


CREATE OR REPLACE FUNCTION public.record_sales_return(p_invoice_id uuid, p_items jsonb, p_reason text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_invoice public.sales_invoices%ROWTYPE; v_line public.sales_invoice_items%ROWTYPE; e jsonb; rid uuid; iid uuid; kg numeric; bags jsonb; prior numeric; refund numeric; comm numeric; net numeric;
BEGIN
 IF jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'At least one return line required'; END IF;
 SELECT * INTO v_invoice FROM public.sales_invoices WHERE id=p_invoice_id FOR UPDATE;
 IF NOT FOUND OR v_invoice.status<>'issued' THEN RAISE EXCEPTION 'Issued invoice not found'; END IF;
 IF NOT(public.is_admin() OR v_invoice.distributor_id=public.current_distributor_id()) THEN RAISE EXCEPTION 'Not authorized'; END IF;
 INSERT INTO public.sales_returns(invoice_id,distributor_id,cafe_id,reason,notes,created_by) VALUES(v_invoice.id,v_invoice.distributor_id,v_invoice.cafe_id,p_reason,p_notes,auth.uid()) RETURNING id INTO rid;
 FOR e IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  SELECT * INTO v_line FROM public.sales_invoice_items WHERE id=(e->>'invoice_item_id')::uuid AND invoice_id=v_invoice.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid invoice line'; END IF;
  IF e ? 'bag_counts' THEN
   bags:=e->'bag_counts'; kg:=public.bags_to_kg(bags);
   IF v_line.bag_counts IS NULL THEN RAISE EXCEPTION 'Legacy invoice line requires kg quantity'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_each_text(bags) x WHERE x.value::integer+COALESCE((SELECT sum((ri.bag_counts->>x.key)::integer) FROM public.sales_return_items ri WHERE ri.invoice_item_id=v_line.id),0)>COALESCE((v_line.bag_counts->>x.key)::integer,0)) THEN RAISE EXCEPTION 'Return bags exceed sold bags'; END IF;
  ELSE
   bags:=NULL; kg:=(e->>'quantity')::numeric;
   IF v_line.bag_counts IS NOT NULL THEN RAISE EXCEPTION 'Bag-level return required for this invoice line'; END IF;
  END IF;
  IF kg<=0 THEN RAISE EXCEPTION 'Return quantity must be positive'; END IF;
  SELECT COALESCE(sum(quantity),0) INTO prior FROM public.sales_return_items WHERE invoice_item_id=v_line.id;
  IF prior+kg>v_line.quantity THEN RAISE EXCEPTION 'Return exceeds sold quantity'; END IF;
  refund:=round(kg*v_line.unit_price,2);
  IF v_line.commission_type='percentage' THEN comm:=round(refund*v_line.commission_value/100,2);
  ELSIF v_line.commission_type='per_kg' THEN comm:=round(kg*v_line.commission_value,2);
  ELSE RAISE EXCEPTION 'Invalid commission type'; END IF;
  net:=refund-comm;
  INSERT INTO public.sales_return_items(return_id,invoice_item_id,product_id,quantity,unit_price,refund_amount,commission_reversal,company_net_reversal,unit_cost,bag_counts)
  VALUES(rid,v_line.id,v_line.product_id,kg,v_line.unit_price,refund,comm,net,v_line.unit_cost,bags) RETURNING id INTO iid;
  INSERT INTO public.return_quarantine_movements(return_item_id,movement_type,quantity,bag_counts,created_by) VALUES(iid,'received',kg,bags,auth.uid());
  IF comm>0 THEN INSERT INTO public.distributor_commission_adjustments(distributor_id,return_item_id,amount) VALUES(v_invoice.distributor_id,iid,comm); END IF;
 END LOOP;
 RETURN rid;
END; $function$


CREATE OR REPLACE FUNCTION public.record_sample_bags(p_cafe_id uuid, p_product_id uuid, p_bags jsonb, p_feedback text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_distributor uuid; v_kg numeric; v_cost numeric; v_sample_id uuid; v_stock jsonb;
BEGIN
 v_distributor:=public.current_distributor_id();
 IF v_distributor IS NULL THEN RAISE EXCEPTION 'Distributor account required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cafes WHERE id=p_cafe_id AND distributor_id=v_distributor AND active=true) THEN RAISE EXCEPTION 'Invalid cafe'; END IF;
 v_kg:=public.bags_to_kg(p_bags);
 SELECT cost_per_unit INTO v_cost FROM public.products WHERE id=p_product_id AND active=true;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid product'; END IF;
 SELECT bag_counts INTO v_stock FROM public.stock_balances WHERE distributor_id=v_distributor AND product_id=p_product_id FOR UPDATE;
 IF v_stock IS NULL THEN RAISE EXCEPTION 'Bag-level stock is not available for this product'; END IF;
 UPDATE public.stock_balances SET quantity=quantity-v_kg,bag_counts=public.bags_subtract(v_stock,p_bags)
 WHERE distributor_id=v_distributor AND product_id=p_product_id AND quantity>=v_kg;
 IF NOT FOUND THEN RAISE EXCEPTION 'Insufficient stock'; END IF;
 INSERT INTO public.samples(distributor_id,cafe_id,sample_date,feedback,created_by)
 VALUES(v_distributor,p_cafe_id,current_date,p_feedback,auth.uid()) RETURNING id INTO v_sample_id;
 INSERT INTO public.sample_items(sample_id,product_id,quantity,unit_cost,total_cost,bag_counts)
 VALUES(v_sample_id,p_product_id,v_kg,COALESCE(v_cost,0),v_kg*COALESCE(v_cost,0),p_bags);
 INSERT INTO public.stock_movements(distributor_id,product_id,movement_type,quantity,bag_counts,reference_id,notes,created_by)
 VALUES(v_distributor,p_product_id,'sample',v_kg,p_bags,v_sample_id,p_feedback,auth.uid());
 INSERT INTO public.distributor_expenses(distributor_id,expense_date,category,amount,description,reference_id,created_by)
 VALUES(v_distributor,current_date,'samples',v_kg*COALESCE(v_cost,0),'Coffee samples',v_sample_id,auth.uid());
 RETURN v_sample_id;
END;
$function$


REVOKE ALL ON FUNCTION public.admin_receive_stock_bags(uuid,uuid,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_receive_stock_bags(uuid,uuid,jsonb,text) TO authenticated;
REVOKE ALL ON FUNCTION public.create_distributor_order_bags(uuid,uuid,uuid,jsonb,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_distributor_order_bags(uuid,uuid,uuid,jsonb,date,text) TO authenticated;
REVOKE ALL ON FUNCTION public.record_sample_bags(uuid,uuid,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_sample_bags(uuid,uuid,jsonb,text) TO authenticated;
REVOKE ALL ON FUNCTION public.process_return_quarantine_bags(uuid,jsonb,text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_return_quarantine_bags(uuid,jsonb,text,uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_delete_cafe(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_cafe(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_adjust_stock_bags(uuid,uuid,jsonb,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_adjust_stock_bags(uuid,uuid,jsonb,text,text) TO authenticated;
