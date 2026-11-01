-- Bag-count inventory support. NULL bag_counts means legacy history with unknown composition.
ALTER TABLE public.stock_balances ADD COLUMN IF NOT EXISTS bag_counts jsonb;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS bag_counts jsonb;
ALTER TABLE public.sales_invoice_items ADD COLUMN IF NOT EXISTS bag_counts jsonb;
ALTER TABLE public.sample_items ADD COLUMN IF NOT EXISTS bag_counts jsonb;
ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS bag_counts jsonb;
ALTER TABLE public.company_stock_balances ADD COLUMN IF NOT EXISTS bag_counts jsonb;
ALTER TABLE public.company_stock_movements ADD COLUMN IF NOT EXISTS bag_counts jsonb;
ALTER TABLE public.sales_return_items ADD COLUMN IF NOT EXISTS bag_counts jsonb;
ALTER TABLE public.return_quarantine_movements ADD COLUMN IF NOT EXISTS bag_counts jsonb;

CREATE OR REPLACE FUNCTION public.bags_to_kg(p_bags jsonb)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE v_size text; v_count numeric; v_total numeric := 0;
BEGIN
 IF p_bags IS NULL OR jsonb_typeof(p_bags) <> 'object' THEN RAISE EXCEPTION 'Bag counts must be a JSON object'; END IF;
 FOR v_size IN SELECT jsonb_object_keys(p_bags) LOOP
  IF v_size NOT IN ('50','100','200','500','1000') THEN RAISE EXCEPTION 'Unsupported bag size: %',v_size; END IF;
 END LOOP;
 FOREACH v_size IN ARRAY ARRAY['50','100','200','500','1000'] LOOP
  v_count:=COALESCE((p_bags->>v_size)::numeric,0);
  IF v_count<0 OR v_count<>trunc(v_count) THEN RAISE EXCEPTION 'Bag counts must be non-negative integers'; END IF;
  v_total:=v_total+v_count*v_size::numeric/1000;
 END LOOP;
 IF v_total<=0 THEN RAISE EXCEPTION 'At least one bag is required'; END IF;
 RETURN v_total;
EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Bag counts must be integers';
END; $$;

CREATE OR REPLACE FUNCTION public.bags_add(p_a jsonb,p_b jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('50',COALESCE((p_a->>'50')::integer,0)+COALESCE((p_b->>'50')::integer,0),
 '100',COALESCE((p_a->>'100')::integer,0)+COALESCE((p_b->>'100')::integer,0),
 '200',COALESCE((p_a->>'200')::integer,0)+COALESCE((p_b->>'200')::integer,0),
 '500',COALESCE((p_a->>'500')::integer,0)+COALESCE((p_b->>'500')::integer,0),
 '1000',COALESCE((p_a->>'1000')::integer,0)+COALESCE((p_b->>'1000')::integer,0))
$$;

CREATE OR REPLACE FUNCTION public.bags_subtract(p_stock jsonb,p_out jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE v_size text; v_have integer; v_need integer; v_result jsonb:='{}'::jsonb;
BEGIN
 FOREACH v_size IN ARRAY ARRAY['50','100','200','500','1000'] LOOP
  v_have:=COALESCE((p_stock->>v_size)::integer,0); v_need:=COALESCE((p_out->>v_size)::integer,0);
  IF v_need<0 OR v_need>v_have THEN RAISE EXCEPTION 'Insufficient stock for %g bag size',v_size; END IF;
  v_result:=v_result||jsonb_build_object(v_size,v_have-v_need);
 END LOOP; RETURN v_result;
END; $$;

-- Bag-aware RPC definitions are captured in the follow-up migration 202611010001_complete_bag_inventory_rpcs.sql.
