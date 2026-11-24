create table public.company_stock_balances ("product_id" uuid not null,"quantity" numeric default 0 not null,"updated_at" timestamp with time zone default now() not null,"bag_counts" jsonb);
create table public.company_stock_movements ("id" uuid default gen_random_uuid() not null,"product_id" uuid not null,"movement_type" text not null,"quantity" numeric not null,"reference_id" uuid,"notes" text,"created_by" uuid,"created_at" timestamp with time zone default now() not null,"bag_counts" jsonb);
create table public.production_recipes ("id" uuid default gen_random_uuid() not null,"name" text not null,"description" text,"roast_loss_percent" numeric default 20 not null,"active" boolean default true not null,"sort_order" integer default 0 not null,"created_at" timestamp with time zone default now() not null,"updated_at" timestamp with time zone default now() not null);
create table public.products ("id" uuid default gen_random_uuid() not null,"name" text not null,"unit" text default 'kg'::text not null,"active" boolean default true not null,"created_at" timestamp with time zone default now() not null,"cost_per_unit" numeric default 0 not null);
create table public.profiles ("id" uuid not null,"full_name" text not null,"role" text not null,"created_at" timestamp with time zone default now() not null,"national_id" text,"avatar_path" text,"legal_full_name" text,"phone" text);
create table public.raw_material_stock_balances ("raw_material_id" uuid not null,"quantity_kg" numeric default 0 not null,"updated_at" timestamp with time zone default now() not null);
create table public.raw_material_stock_movements ("id" uuid default gen_random_uuid() not null,"raw_material_id" uuid not null,"movement_type" text not null,"quantity_kg" numeric not null,"reference_type" text,"reference_id" uuid,"notes" text,"created_by" uuid,"created_at" timestamp with time zone default now() not null);
create table public.raw_materials ("id" uuid default gen_random_uuid() not null,"name" text not null,"unit" text default 'kg'::text not null,"active" boolean default true not null,"notes" text,"created_at" timestamp with time zone default now() not null,"updated_at" timestamp with time zone default now() not null);
create table public.suppliers ("id" uuid default gen_random_uuid() not null,"name" text not null,"contact_name" text,"phone" text,"notes" text,"active" boolean default true not null,"created_by" uuid,"created_at" timestamp with time zone default now() not null,"updated_at" timestamp with time zone default now() not null);
alter table public.company_stock_balances add constraint company_stock_balances_pkey PRIMARY KEY (product_id);
alter table public.company_stock_balances add constraint company_stock_balances_quantity_check CHECK ((quantity >= (0)::numeric));
alter table public.company_stock_movements add constraint company_stock_movements_movement_type_check CHECK ((movement_type = ANY (ARRAY['receipt'::text, 'return'::text, 'transfer_to_distributor'::text, 'transfer_from_distributor'::text, 'adjustment'::text, 'damage'::text])));
alter table public.company_stock_movements add constraint company_stock_movements_pkey PRIMARY KEY (id);
alter table public.company_stock_movements add constraint company_stock_movements_quantity_check CHECK ((quantity > (0)::numeric));
alter table public.production_recipes add constraint production_recipes_name_key UNIQUE (name);
alter table public.production_recipes add constraint production_recipes_pkey PRIMARY KEY (id);
alter table public.production_recipes add constraint production_recipes_roast_loss_percent_check CHECK (((roast_loss_percent >= (0)::numeric) AND (roast_loss_percent < (100)::numeric)));
alter table public.products add constraint products_name_key UNIQUE (name);
alter table public.products add constraint products_pkey PRIMARY KEY (id);
alter table public.profiles add constraint profiles_pkey PRIMARY KEY (id);
alter table public.profiles add constraint profiles_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'distributor'::text])));
alter table public.raw_material_stock_balances add constraint raw_material_stock_balances_pkey PRIMARY KEY (raw_material_id);
alter table public.raw_material_stock_balances add constraint raw_material_stock_balances_quantity_kg_check CHECK ((quantity_kg >= (0)::numeric));
alter table public.raw_material_stock_movements add constraint raw_material_stock_movements_movement_type_check CHECK ((movement_type = ANY (ARRAY['receipt'::text, 'production_issue'::text, 'adjustment_in'::text, 'adjustment_out'::text])));
alter table public.raw_material_stock_movements add constraint raw_material_stock_movements_pkey PRIMARY KEY (id);
alter table public.raw_material_stock_movements add constraint raw_material_stock_movements_quantity_kg_check CHECK ((quantity_kg > (0)::numeric));
alter table public.raw_materials add constraint raw_materials_name_key UNIQUE (name);
alter table public.raw_materials add constraint raw_materials_pkey PRIMARY KEY (id);
alter table public.raw_materials add constraint raw_materials_unit_check CHECK ((unit = ANY (ARRAY['kg'::text, 'g'::text, 'liter'::text, 'piece'::text])));
alter table public.suppliers add constraint suppliers_pkey PRIMARY KEY (id);
CREATE OR REPLACE FUNCTION public.apply_raw_material_stock_movement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_delta numeric(14,3);
begin
 v_delta:=case when new.movement_type in ('receipt','adjustment_in') then new.quantity_kg else -new.quantity_kg end;
 insert into public.raw_material_stock_balances(raw_material_id,quantity_kg,updated_at)
  values(new.raw_material_id,greatest(v_delta,0),now())
  on conflict(raw_material_id) do update set quantity_kg=public.raw_material_stock_balances.quantity_kg+v_delta,updated_at=now();
 if (select quantity_kg from public.raw_material_stock_balances where raw_material_id=new.raw_material_id)<0 then raise exception 'رصيد الخامة لا يسمح بهذه الحركة'; end if;
 return new;
end; $function$
;
CREATE OR REPLACE FUNCTION public.bags_add(p_a jsonb, p_b jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 select jsonb_build_object(
 '25',coalesce((p_a->>'25')::integer,0)+coalesce((p_b->>'25')::integer,0),
 '50',coalesce((p_a->>'50')::integer,0)+coalesce((p_b->>'50')::integer,0),
 '100',coalesce((p_a->>'100')::integer,0)+coalesce((p_b->>'100')::integer,0),
 '200',coalesce((p_a->>'200')::integer,0)+coalesce((p_b->>'200')::integer,0),
 '500',coalesce((p_a->>'500')::integer,0)+coalesce((p_b->>'500')::integer,0),
 '1000',coalesce((p_a->>'1000')::integer,0)+coalesce((p_b->>'1000')::integer,0))
$function$
;
CREATE OR REPLACE FUNCTION public.bags_to_kg(p_bags jsonb)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
end; $function$
;
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin') $function$
;
create trigger raw_test_movement after insert on public.raw_material_stock_movements for each row execute function public.apply_raw_material_stock_movement();
