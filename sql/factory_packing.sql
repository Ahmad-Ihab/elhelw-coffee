begin;
create table public.factory_product_mapping (
 version_id uuid primary key references public.factory_blend_versions(id),
 product_id uuid not null references public.products(id),
 label_family integer check(label_family between 1 and 8)
);
create table public.factory_packing_batches (
 id uuid primary key, version_id uuid not null references public.factory_blend_versions(id),
 product_id uuid not null references public.products(id), bags jsonb not null,
 quantity_kg numeric not null check(quantity_kg>0), total_cost numeric not null check(total_cost>=0),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
alter table public.factory_product_mapping enable row level security;
alter table public.factory_packing_batches enable row level security;
revoke all on public.factory_product_mapping,public.factory_packing_batches from anon,authenticated;
grant select on public.factory_product_mapping,public.factory_packing_batches to authenticated;
create policy mapping_read on public.factory_product_mapping for select to authenticated using(public.is_admin());
create policy packing_read on public.factory_packing_batches for select to authenticated using(public.is_admin());
create function public.set_factory_product_mapping(p_version uuid,p_product uuid,p_label integer) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not coalesce(public.is_admin(),false) then raise exception 'Admin required'; end if;
 if not exists(select 1 from public.products where id=p_product and active) then raise exception 'Active product required'; end if;
 perform 1 from public.factory_blend_versions where id=p_version for update;
 if not found then raise exception 'Unknown version'; end if;
 if exists(select 1 from public.factory_packing_batches where version_id=p_version) then raise exception 'Mapping already used; create a new recipe version'; end if;
 insert into public.factory_product_mapping values(p_version,p_product,p_label)
 on conflict(version_id) do update set product_id=excluded.product_id,label_family=excluded.label_family;
end; $$;
create function public.record_factory_packing(p_id uuid,p_version uuid,p_bags jsonb,p_processing_cost numeric default 0) returns uuid
language plpgsql security definer set search_path='' as $$
declare m public.factory_product_mapping%rowtype; b public.factory_packing_batches%rowtype; st public.factory_blend_stock%rowtype; item public.packaging_items%rowtype; k text; n bigint; sku text; kg numeric; total numeric; requirements jsonb:='{}'::jsonb;
begin
 if auth.uid() is null or not coalesce(public.is_admin(),false) then raise exception 'Admin required'; end if;
 if p_id is null or p_processing_cost is null or p_processing_cost<0 or p_processing_cost::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid request'; end if;
 kg:=public.bags_to_kg(p_bags);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,0));
 select * into b from public.factory_packing_batches where id=p_id;
 if found then
 if b.version_id<>p_version or b.bags<>p_bags or b.created_by<>auth.uid() then raise exception 'Request ID already used'; end if;
 return p_id; end if;
 perform 1 from public.factory_blend_versions where id=p_version for update;
 select * into strict m from public.factory_product_mapping where version_id=p_version;
 if not exists(select 1 from public.products where id=m.product_id and active) then raise exception 'Inactive product'; end if;
 select * into strict st from public.factory_blend_stock where version_id=p_version for update;
 if st.quantity_kg<kg then raise exception 'Insufficient bulk blend'; end if;
 total:=kg*st.average_cost+p_processing_cost;
 for k in select jsonb_object_keys(p_bags) loop
 n:=(p_bags->>k)::bigint;
 if n=0 then continue; end if;
 if k not in ('50','100','200','500','1000') then raise exception 'Unsupported packaging size'; end if;
 sku:='BAG-'||k; requirements:=requirements||jsonb_build_object(sku,n);
 if k in ('50','100','200') then
 if m.label_family is null then raise exception 'Label mapping required'; end if;
 sku:='LABEL-'||m.label_family||'-'||case when k='200' then '200' else '100' end;
 requirements:=requirements||jsonb_build_object(sku,coalesce((requirements->>sku)::bigint,0)+n);
 end if;
 end loop;
 for sku,n in select key,value::bigint from jsonb_each_text(requirements) order by key loop
 select * into strict item from public.packaging_items where packaging_items.sku=record_factory_packing.sku for update;
 if item.quantity<n then raise exception 'Insufficient packaging: %',sku; end if;
 update public.packaging_items set quantity=quantity-n where packaging_items.sku=record_factory_packing.sku;
 total:=total+n*item.average_cost;
 insert into public.packaging_movements(id,sku,quantity_delta,unit_cost,movement_type,notes,created_by)
 values(gen_random_uuid(),sku,-n,item.average_cost,'adjustment_out','Packing batch '||p_id,auth.uid());
 end loop;
 update public.factory_blend_stock set quantity_kg=quantity_kg-kg where version_id=p_version;
 insert into public.company_stock_balances(product_id,quantity,bag_counts) values(m.product_id,kg,p_bags)
 on conflict(product_id) do update set quantity=public.company_stock_balances.quantity+excluded.quantity,bag_counts=public.bags_add(coalesce(public.company_stock_balances.bag_counts,'{}'::jsonb),excluded.bag_counts),updated_at=now();
 insert into public.company_stock_movements(product_id,movement_type,quantity,bag_counts,reference_id,notes,created_by)
 values(m.product_id,'receipt',kg,p_bags,p_id,'Factory packing',auth.uid());
 insert into public.factory_packing_batches values(p_id,p_version,m.product_id,p_bags,kg,total,auth.uid(),now());
 return p_id;
end; $$;
create function public.record_factory_direct_pack(p_blend_id uuid,p_pack_id uuid,p_version uuid,p_input numeric,p_bags jsonb,p_additive_costs jsonb default '{}'::jsonb,p_blend_cost numeric default 0,p_pack_cost numeric default 0) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not coalesce(public.is_admin(),false) then raise exception 'Admin required'; end if;
 perform public.record_factory_blend(p_blend_id,p_version,p_input,public.bags_to_kg(p_bags),p_additive_costs,p_blend_cost);
 return public.record_factory_packing(p_pack_id,p_version,p_bags,p_pack_cost);
end; $$;
revoke all on function public.set_factory_product_mapping(uuid,uuid,integer),public.record_factory_packing(uuid,uuid,jsonb,numeric),public.record_factory_direct_pack(uuid,uuid,uuid,numeric,jsonb,jsonb,numeric,numeric) from public,anon;
grant execute on function public.set_factory_product_mapping(uuid,uuid,integer),public.record_factory_packing(uuid,uuid,jsonb,numeric),public.record_factory_direct_pack(uuid,uuid,uuid,numeric,jsonb,jsonb,numeric,numeric) to authenticated;
commit;