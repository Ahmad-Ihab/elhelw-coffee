-- Add 25g bags to all bag-count calculations and sample inventory defaults.
create or replace function public.bags_to_kg(p_bags jsonb)
returns numeric language plpgsql immutable set search_path='pg_catalog','public' as $$
declare v_size text; v_count numeric; v_total numeric:=0;
begin
 if p_bags is null or jsonb_typeof(p_bags)<>'object' then raise exception 'Bag counts must be a JSON object'; end if;
 for v_size in select jsonb_object_keys(p_bags) loop
  if v_size not in ('25','50','100','200','500','1000') then raise exception 'Unsupported bag size: %',v_size; end if;
 end loop;
 foreach v_size in array array['25','50','100','200','500','1000'] loop
  v_count:=coalesce((p_bags->>v_size)::numeric,0);
  if v_count<0 or v_count<>trunc(v_count) then raise exception 'Bag counts must be non-negative integers'; end if;
  v_total:=v_total+v_count*v_size::numeric/1000;
 end loop;
 if v_total<=0 then raise exception 'At least one bag is required'; end if;
 return v_total;
exception when invalid_text_representation then raise exception 'Bag counts must be integers';
end; $$;
create or replace function public.bags_add(p_a jsonb,p_b jsonb)
returns jsonb language sql immutable set search_path='pg_catalog','public' as $$
 select jsonb_build_object(
 '25',coalesce((p_a->>'25')::integer,0)+coalesce((p_b->>'25')::integer,0),
 '50',coalesce((p_a->>'50')::integer,0)+coalesce((p_b->>'50')::integer,0),
 '100',coalesce((p_a->>'100')::integer,0)+coalesce((p_b->>'100')::integer,0),
 '200',coalesce((p_a->>'200')::integer,0)+coalesce((p_b->>'200')::integer,0),
 '500',coalesce((p_a->>'500')::integer,0)+coalesce((p_b->>'500')::integer,0),
 '1000',coalesce((p_a->>'1000')::integer,0)+coalesce((p_b->>'1000')::integer,0))
$$;
create or replace function public.bags_subtract(p_stock jsonb,p_out jsonb)
returns jsonb language plpgsql immutable set search_path='pg_catalog','public' as $$
declare v_size text;v_have integer;v_need integer;v_result jsonb:='{}'::jsonb;
begin
 foreach v_size in array array['25','50','100','200','500','1000'] loop
  v_have:=coalesce((p_stock->>v_size)::integer,0);v_need:=coalesce((p_out->>v_size)::integer,0);
  if v_need<0 or v_need>v_have then raise exception 'Insufficient stock for %g bag size',v_size; end if;
  v_result:=v_result||jsonb_build_object(v_size,v_have-v_need);
 end loop;
 return v_result;
end; $$;
alter table public.sample_stock_balances alter column bag_counts set default '{"25":0,"50":0,"100":0,"200":0,"500":0,"1000":0}'::jsonb;
