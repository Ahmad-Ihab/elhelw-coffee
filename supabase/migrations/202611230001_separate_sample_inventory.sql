-- Separate sample inventory for company and distributor custody.
create table if not exists public.sample_stock_balances (
  id uuid primary key default gen_random_uuid(),
  distributor_id uuid null references public.distributors(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity numeric not null default 0 check (quantity >= 0),
  bag_counts jsonb not null default '{"50":0,"100":0,"200":0,"500":0,"1000":0}'::jsonb,
  updated_at timestamptz not null default now()
);
create unique index if not exists sample_stock_company_product_uq on public.sample_stock_balances(product_id) where distributor_id is null;
create unique index if not exists sample_stock_distributor_product_uq on public.sample_stock_balances(distributor_id,product_id) where distributor_id is not null;

create table if not exists public.sample_stock_movements (
  id uuid primary key default gen_random_uuid(),
  distributor_id uuid null references public.distributors(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  movement_type text not null check (movement_type in ('company_in','company_out','issued_to_distributor','distributed_to_cafe','returned_to_company','adjustment_in','adjustment_out')),
  quantity numeric not null check (quantity > 0),
  bag_counts jsonb not null,
  reference_id uuid null,
  notes text null,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists sample_stock_movements_product_date_idx on public.sample_stock_movements(product_id,created_at desc);
create index if not exists sample_stock_movements_distributor_date_idx on public.sample_stock_movements(distributor_id,created_at desc);

alter table public.sample_stock_balances enable row level security;
alter table public.sample_stock_movements enable row level security;
drop policy if exists sample_stock_balances_read on public.sample_stock_balances;
create policy sample_stock_balances_read on public.sample_stock_balances for select to authenticated
using (public.is_admin() or distributor_id=public.current_distributor_id());
drop policy if exists sample_stock_movements_read on public.sample_stock_movements;
create policy sample_stock_movements_read on public.sample_stock_movements for select to authenticated
using (public.is_admin() or distributor_id=public.current_distributor_id());
grant select on public.sample_stock_balances,public.sample_stock_movements to authenticated;

create or replace function public.admin_adjust_sample_company_stock(p_product_id uuid,p_bags jsonb,p_direction text,p_notes text default null)
returns void language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_kg numeric; v_existing jsonb; v_remaining jsonb;
begin
 if not public.is_admin() then raise exception 'Admin access required'; end if;
 if p_direction not in ('in','out') then raise exception 'Invalid direction'; end if;
 v_kg:=public.bags_to_kg(p_bags);
 if not exists(select 1 from public.products where id=p_product_id and active=true) then raise exception 'Invalid product'; end if;
 if p_direction='out' then
  select bag_counts into v_existing from public.sample_stock_balances where distributor_id is null and product_id=p_product_id for update;
  if v_existing is null then raise exception 'Insufficient company sample stock'; end if;
  v_remaining:=public.bags_subtract(v_existing,p_bags);
  update public.sample_stock_balances set quantity=quantity-v_kg,bag_counts=v_remaining,updated_at=now() where distributor_id is null and product_id=p_product_id;
 else
  insert into public.sample_stock_balances(distributor_id,product_id,quantity,bag_counts) values(null,p_product_id,v_kg,p_bags)
  on conflict (product_id) where distributor_id is null do update set quantity=public.sample_stock_balances.quantity+excluded.quantity,bag_counts=public.bags_add(public.sample_stock_balances.bag_counts,excluded.bag_counts),updated_at=now();
 end if;
 insert into public.sample_stock_movements(distributor_id,product_id,movement_type,quantity,bag_counts,notes,created_by)
 values(null,p_product_id,case when p_direction='in' then 'company_in' else 'company_out' end,v_kg,p_bags,p_notes,auth.uid());
end; $$;

create or replace function public.admin_issue_sample_stock(p_distributor_id uuid,p_product_id uuid,p_bags jsonb,p_notes text default null)
returns void language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_kg numeric; v_company jsonb; v_remaining jsonb;
begin
 if not public.is_admin() then raise exception 'Admin access required'; end if;
 v_kg:=public.bags_to_kg(p_bags);
 if not exists(select 1 from public.distributors where id=p_distributor_id and active=true) then raise exception 'Invalid distributor'; end if;
 if not exists(select 1 from public.products where id=p_product_id and active=true) then raise exception 'Invalid product'; end if;
 select bag_counts into v_company from public.sample_stock_balances where distributor_id is null and product_id=p_product_id for update;
 if v_company is null then raise exception 'No company sample stock for this product'; end if;
 v_remaining:=public.bags_subtract(v_company,p_bags);
 update public.sample_stock_balances set quantity=quantity-v_kg,bag_counts=v_remaining,updated_at=now() where distributor_id is null and product_id=p_product_id;
 insert into public.sample_stock_balances(distributor_id,product_id,quantity,bag_counts) values(p_distributor_id,p_product_id,v_kg,p_bags)
 on conflict (distributor_id,product_id) where distributor_id is not null do update set quantity=public.sample_stock_balances.quantity+excluded.quantity,bag_counts=public.bags_add(public.sample_stock_balances.bag_counts,excluded.bag_counts),updated_at=now();
 insert into public.sample_stock_movements(distributor_id,product_id,movement_type,quantity,bag_counts,notes,created_by)
 values(p_distributor_id,p_product_id,'issued_to_distributor',v_kg,p_bags,p_notes,auth.uid());
end; $$;

create or replace function public.record_distributor_sample_bags(p_cafe_id uuid,p_product_id uuid,p_bags jsonb,p_feedback text default null)
returns uuid language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_distributor uuid; v_kg numeric; v_cost numeric; v_stock jsonb; v_remaining jsonb; v_sample_id uuid;
begin
 v_distributor:=public.current_distributor_id();
 if v_distributor is null then raise exception 'Distributor account required'; end if;
 if not exists(select 1 from public.cafes where id=p_cafe_id and distributor_id=v_distributor and active=true) then raise exception 'Invalid or inactive cafe'; end if;
 v_kg:=public.bags_to_kg(p_bags);
 select cost_per_unit into v_cost from public.products where id=p_product_id and active=true;
 if not found then raise exception 'Invalid product'; end if;
 select bag_counts into v_stock from public.sample_stock_balances where distributor_id=v_distributor and product_id=p_product_id for update;
 if v_stock is null then raise exception 'No sample stock for this product'; end if;
 v_remaining:=public.bags_subtract(v_stock,p_bags);
 update public.sample_stock_balances set quantity=quantity-v_kg,bag_counts=v_remaining,updated_at=now() where distributor_id=v_distributor and product_id=p_product_id;
 insert into public.samples(distributor_id,cafe_id,sample_date,feedback,marketing_cost,created_by) values(v_distributor,p_cafe_id,current_date,p_feedback,v_kg*coalesce(v_cost,0),auth.uid()) returning id into v_sample_id;
 insert into public.sample_items(sample_id,product_id,quantity,unit_cost,total_cost,bag_counts) values(v_sample_id,p_product_id,v_kg,coalesce(v_cost,0),v_kg*coalesce(v_cost,0),p_bags);
 insert into public.sample_stock_movements(distributor_id,product_id,movement_type,quantity,bag_counts,reference_id,notes,created_by) values(v_distributor,p_product_id,'distributed_to_cafe',v_kg,p_bags,v_sample_id,p_feedback,auth.uid());
 insert into public.distributor_expenses(distributor_id,expense_type,amount,reference_id,notes) values(v_distributor,'sample',v_kg*coalesce(v_cost,0),v_sample_id,'Coffee samples'||case when p_feedback is null then '' else ': '||p_feedback end);
 return v_sample_id;
end; $$;

revoke all on function public.admin_adjust_sample_company_stock(uuid,jsonb,text,text) from public,anon;
revoke all on function public.admin_issue_sample_stock(uuid,uuid,jsonb,text) from public,anon;
revoke all on function public.record_distributor_sample_bags(uuid,uuid,jsonb,text) from public,anon;
grant execute on function public.admin_adjust_sample_company_stock(uuid,jsonb,text,text) to authenticated;
grant execute on function public.admin_issue_sample_stock(uuid,uuid,jsonb,text) to authenticated;
grant execute on function public.record_distributor_sample_bags(uuid,uuid,jsonb,text) to authenticated;
