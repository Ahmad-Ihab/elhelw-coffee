begin;
alter table public.raw_materials add column factory_kind text check(factory_kind in ('green_coffee','additive')), add column origin text, add column bean_type text, add column screen_size text;
create table public.roasted_stock (
 raw_material_id uuid references public.raw_materials(id), roast_degree text not null check(length(trim(roast_degree)) between 1 and 80),
 quantity_kg numeric(14,3) not null default 0 check(quantity_kg>=0),
 average_cost numeric(20,8) not null default 0 check(average_cost>=0),
 primary key(raw_material_id,roast_degree)
);
create table public.roasting_batches (
 id uuid primary key, raw_material_id uuid not null references public.raw_materials(id),
 roast_degree text not null, input_kg numeric(14,3) not null check(input_kg>0),
 output_kg numeric(14,3) not null check(output_kg>0 and output_kg<=input_kg),
 green_unit_cost numeric(20,8) not null check(green_unit_cost>=0),
 processing_cost numeric(20,8) not null check(processing_cost>=0),
 loss_percent numeric generated always as (100*(input_kg-output_kg)/input_kg) stored,
 notes text, created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
alter table public.roasted_stock enable row level security;
alter table public.roasting_batches enable row level security;
revoke all on public.roasted_stock,public.roasting_batches from anon,authenticated;
grant select on public.roasted_stock,public.roasting_batches to authenticated;
create policy roasted_admin_read on public.roasted_stock for select to authenticated using(public.is_admin());
create policy roasting_admin_read on public.roasting_batches for select to authenticated using(public.is_admin());
create function public.record_roasting_batch(p_id uuid,p_material uuid,p_degree text,p_input numeric,p_output numeric,p_green_cost numeric,p_processing_cost numeric default 0,p_notes text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare b public.roasting_batches%rowtype; v_balance numeric; v_cost numeric; v_degree text:=trim(p_degree);
begin
 if auth.uid() is null or not coalesce(public.is_admin(),false) then raise exception 'Admin required'; end if;
 if p_id is null or p_material is null or v_degree is null or length(v_degree) not between 1 and 80 or p_input is null or p_output is null or p_green_cost is null or p_processing_cost is null or p_input::text in ('NaN','Infinity','-Infinity') or p_output::text in ('NaN','Infinity','-Infinity') or p_green_cost::text in ('NaN','Infinity','-Infinity') or p_processing_cost::text in ('NaN','Infinity','-Infinity') or p_input<=0 or p_output<=0 or p_output>p_input or p_input<>round(p_input,3) or p_output<>round(p_output,3) or p_green_cost<0 or p_processing_cost<0 then raise exception 'Invalid roasting batch'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,0));
 select * into b from public.roasting_batches where id=p_id;
 if found then
 if b.raw_material_id<>p_material or b.roast_degree<>v_degree or b.input_kg<>p_input or b.output_kg<>p_output or b.green_unit_cost<>round(p_green_cost,8) or b.processing_cost<>round(p_processing_cost,8) or b.created_by<>auth.uid() then raise exception 'Request ID already used'; end if;
 return p_id; end if;
 if not exists(select 1 from public.raw_materials where id=p_material and active and factory_kind='green_coffee') then raise exception 'Select active green coffee'; end if;
 select quantity_kg into v_balance from public.raw_material_stock_balances where raw_material_id=p_material for update;
 if coalesce(v_balance,0)<p_input then raise exception 'Insufficient green coffee stock'; end if;
 v_cost:=(p_input*p_green_cost+p_processing_cost)/p_output;
 insert into public.roasting_batches(id,raw_material_id,roast_degree,input_kg,output_kg,green_unit_cost,processing_cost,notes,created_by)
 values(p_id,p_material,v_degree,p_input,p_output,p_green_cost,p_processing_cost,p_notes,auth.uid());
 insert into public.raw_material_stock_movements(raw_material_id,movement_type,quantity_kg,reference_type,reference_id,notes,created_by)
 values(p_material,'production_issue',p_input,'production',p_id,p_notes,auth.uid());
 insert into public.roasted_stock(raw_material_id,roast_degree,quantity_kg,average_cost) values(p_material,v_degree,p_output,v_cost)
 on conflict(raw_material_id,roast_degree) do update set average_cost=(public.roasted_stock.quantity_kg*public.roasted_stock.average_cost+excluded.quantity_kg*excluded.average_cost)/(public.roasted_stock.quantity_kg+excluded.quantity_kg),quantity_kg=public.roasted_stock.quantity_kg+excluded.quantity_kg;
 return p_id;
end; $$;
revoke all on function public.record_roasting_batch(uuid,uuid,text,numeric,numeric,numeric,numeric,text) from public,anon;
grant execute on function public.record_roasting_batch(uuid,uuid,text,numeric,numeric,numeric,numeric,text) to authenticated;
commit;