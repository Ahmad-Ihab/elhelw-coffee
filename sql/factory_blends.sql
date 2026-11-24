begin;
create table public.factory_blend_versions (
 id uuid primary key default gen_random_uuid(), recipe_id uuid not null references public.production_recipes(id),
 version integer not null check(version>0), components jsonb not null check(jsonb_typeof(components)='array'),
 created_at timestamptz not null default now(), unique(recipe_id,version)
);
create table public.factory_blend_stock (
 version_id uuid primary key references public.factory_blend_versions(id),
 quantity_kg numeric(14,3) not null default 0 check(quantity_kg>=0),
 average_cost numeric(20,8) not null default 0 check(average_cost>=0)
);
create table public.factory_blend_batches (
 id uuid primary key, version_id uuid not null references public.factory_blend_versions(id),
 input_kg numeric(14,3) not null check(input_kg>0), output_kg numeric(14,3) not null check(output_kg>0 and output_kg<=input_kg),
 total_cost numeric(20,8) not null check(total_cost>=0), components jsonb not null,
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
alter table public.factory_blend_versions enable row level security;
alter table public.factory_blend_stock enable row level security;
alter table public.factory_blend_batches enable row level security;
revoke all on public.factory_blend_versions,public.factory_blend_stock,public.factory_blend_batches from anon,authenticated;
grant select on public.factory_blend_versions,public.factory_blend_stock,public.factory_blend_batches to authenticated;
create policy blend_versions_read on public.factory_blend_versions for select to authenticated using(public.is_admin());
create policy blend_stock_read on public.factory_blend_stock for select to authenticated using(public.is_admin());
create policy blend_batches_read on public.factory_blend_batches for select to authenticated using(public.is_admin());
create function public.save_factory_blend_version(p_recipe uuid,p_components jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare c jsonb; total numeric:=0; ratio numeric; m uuid; k text; d text; v integer; result uuid; seen text[]:=array[]::text[]; key text;
begin
 if auth.uid() is null or not coalesce(public.is_admin(),false) then raise exception 'Admin required'; end if;
 if p_components is null or jsonb_typeof(p_components)<>'array' or jsonb_array_length(p_components)=0 then raise exception 'Components required'; end if;
 perform 1 from public.production_recipes where id=p_recipe and active for update;
 if not found then raise exception 'Active recipe required'; end if;
 for c in select value from jsonb_array_elements(p_components) loop
 m:=(c->>'material_id')::uuid; k:=c->>'kind'; d:=trim(c->>'roast_degree'); ratio:=(c->>'ratio')::numeric;
 if m is null or k is null or k not in ('roasted','additive') or ratio is null or ratio<=0 or ratio>1 or ratio::text='NaN' then raise exception 'Invalid component'; end if;
 if not exists(select 1 from public.raw_materials where id=m and active and factory_kind=case when k='roasted' then 'green_coffee' else 'additive' end) then raise exception 'Invalid material classification'; end if;
 if k='roasted' and coalesce(d,'')='' then raise exception 'Roast degree required'; end if;
 key:=m::text||':'||k||':'||case when k='roasted' then d else '' end;
 if key=any(seen) then raise exception 'Duplicate component'; end if; seen:=array_append(seen,key); total:=total+ratio;
 end loop;
 if total<>1 then raise exception 'Ratios must total 100 percent'; end if;
 select coalesce(max(version),0)+1 into v from public.factory_blend_versions where recipe_id=p_recipe;
 insert into public.factory_blend_versions(recipe_id,version,components) values(p_recipe,v,p_components) returning id into result;
 return result;
end; $$;
create function public.record_factory_blend(p_id uuid,p_version uuid,p_input numeric,p_output numeric,p_additive_costs jsonb default '{}'::jsonb,p_processing_cost numeric default 0) returns uuid
language plpgsql security definer set search_path='' as $$
declare v public.factory_blend_versions%rowtype; b public.factory_blend_batches%rowtype; c jsonb; m uuid; k text; d text; qty numeric; available numeric; cost numeric; total numeric:=p_processing_cost; details jsonb:='[]'::jsonb; allocated numeric:=0; idx integer:=0;
begin
 if auth.uid() is null or not coalesce(public.is_admin(),false) then raise exception 'Admin required'; end if;
 if p_id is null or p_input is null or p_output is null or p_processing_cost is null or p_input::text in ('NaN','Infinity','-Infinity') or p_output::text in ('NaN','Infinity','-Infinity') or p_processing_cost::text in ('NaN','Infinity','-Infinity') or p_input<=0 or p_output<=0 or p_output>p_input or p_input<>round(p_input,3) or p_output<>round(p_output,3) or p_processing_cost<0 then raise exception 'Invalid batch'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,0));
 select * into b from public.factory_blend_batches where id=p_id;
 if found then
 if b.version_id<>p_version or b.input_kg<>p_input or b.output_kg<>p_output or b.created_by<>auth.uid() then raise exception 'Request ID already used'; end if;
 return p_id; end if;
 select * into strict v from public.factory_blend_versions where id=p_version;
 for c in select value from jsonb_array_elements(v.components) order by value->>'material_id',value->>'kind',value->>'roast_degree' loop
 idx:=idx+1; m:=(c->>'material_id')::uuid; k:=c->>'kind'; d:=trim(c->>'roast_degree');
 qty:=case when idx=jsonb_array_length(v.components) then p_input-allocated else trunc(p_input*(c->>'ratio')::numeric,3) end;
 if qty<=0 then raise exception 'Batch too small for recipe'; end if; allocated:=allocated+qty;
 if k='roasted' then
 select quantity_kg,average_cost into available,cost from public.roasted_stock where raw_material_id=m and roast_degree=d for update;
 if coalesce(available,0)<qty then raise exception 'Insufficient roasted stock'; end if;
 update public.roasted_stock set quantity_kg=quantity_kg-qty where raw_material_id=m and roast_degree=d;
 else
 select quantity_kg into available from public.raw_material_stock_balances where raw_material_id=m for update;
 if coalesce(available,0)<qty then raise exception 'Insufficient additive stock'; end if;
 cost:=(p_additive_costs->>m::text)::numeric;
 if cost is null or cost<0 or cost::text in ('NaN','Infinity','-Infinity') then raise exception 'Additive cost required'; end if;
 insert into public.raw_material_stock_movements(raw_material_id,movement_type,quantity_kg,reference_type,reference_id,notes,created_by) values(m,'production_issue',qty,'production',p_id,'Blend production',auth.uid());
 end if;
 total:=total+qty*cost; details:=details||jsonb_build_array(c||jsonb_build_object('quantity_kg',qty,'unit_cost',cost));
 end loop;
 insert into public.factory_blend_batches(id,version_id,input_kg,output_kg,total_cost,components,created_by) values(p_id,p_version,p_input,p_output,total,details,auth.uid());
 insert into public.factory_blend_stock(version_id,quantity_kg,average_cost) values(p_version,p_output,total/p_output)
 on conflict(version_id) do update set average_cost=(public.factory_blend_stock.quantity_kg*public.factory_blend_stock.average_cost+excluded.quantity_kg*excluded.average_cost)/(public.factory_blend_stock.quantity_kg+excluded.quantity_kg),quantity_kg=public.factory_blend_stock.quantity_kg+excluded.quantity_kg;
 return p_id;
end; $$;
revoke all on function public.save_factory_blend_version(uuid,jsonb),public.record_factory_blend(uuid,uuid,numeric,numeric,jsonb,numeric) from public,anon;
grant execute on function public.save_factory_blend_version(uuid,jsonb),public.record_factory_blend(uuid,uuid,numeric,numeric,jsonb,numeric) to authenticated;
commit;