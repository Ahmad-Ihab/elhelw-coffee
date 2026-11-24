begin;
create table public.packaging_items (
 sku text primary key, name text not null, kind text not null check(kind in ('bag','label')),
 weight_g integer not null, quantity bigint not null default 0 check(quantity>=0),
 average_cost numeric(20,8) not null default 0 check(average_cost>=0),
 minimum_quantity bigint not null default 0 check(minimum_quantity>=0)
);
create table public.packaging_movements (
 id uuid primary key, sku text not null references public.packaging_items(sku),
 quantity_delta bigint not null check(quantity_delta<>0),
 unit_cost numeric(20,8) not null check(unit_cost>=0),
 movement_type text not null check(movement_type in ('purchase','opening','waste','adjustment_in','adjustment_out')),
 supplier_id uuid references public.suppliers(id), invoice_number text, notes text,
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
alter table public.packaging_items enable row level security;
alter table public.packaging_movements enable row level security;
revoke all on public.packaging_items,public.packaging_movements from anon,authenticated;
grant select on public.packaging_items,public.packaging_movements to authenticated;
create policy packaging_admin_read on public.packaging_items for select to authenticated using (exists(select 1 from public.profiles where id=auth.uid() and role='admin'));
create policy packaging_movements_admin_read on public.packaging_movements for select to authenticated using (exists(select 1 from public.profiles where id=auth.uid() and role='admin'));
insert into public.packaging_items(sku,name,kind,weight_g) values
('BAG-50','كيس 50 جم','bag',50),
('BAG-100','كيس 100 جم','bag',100),
('BAG-200','كيس 200 جم','bag',200),
('BAG-500','كيس 500 جم','bag',500),
('BAG-1000','كيس 1000 جم','bag',1000),
('LABEL-1-100','استيكر سادة فاتح 50 / 100 جم','label',100),
('LABEL-1-200','استيكر سادة فاتح 200 جم','label',200),
('LABEL-2-100','استيكر سادة وسط 50 / 100 جم','label',100),
('LABEL-2-200','استيكر سادة وسط 200 جم','label',200),
('LABEL-3-100','استيكر سادة غامق 50 / 100 جم','label',100),
('LABEL-3-200','استيكر سادة غامق 200 جم','label',200),
('LABEL-4-100','استيكر محوج فاتح 50 / 100 جم','label',100),
('LABEL-4-200','استيكر محوج فاتح 200 جم','label',200),
('LABEL-5-100','استيكر محوج وسط 50 / 100 جم','label',100),
('LABEL-5-200','استيكر محوج وسط 200 جم','label',200),
('LABEL-6-100','استيكر محوج غامق 50 / 100 جم','label',100),
('LABEL-6-200','استيكر محوج غامق 200 جم','label',200),
('LABEL-7-100','استيكر فرنساوي 50 / 100 جم','label',100),
('LABEL-7-200','استيكر فرنساوي 200 جم','label',200),
('LABEL-8-100','استيكر فرنساوي بندق 50 / 100 جم','label',100),
('LABEL-8-200','استيكر فرنساوي بندق 200 جم','label',200);
create function public.record_packaging_movement(p_id uuid,p_sku text,p_type text,p_quantity bigint,p_unit_cost numeric default null,p_supplier uuid default null,p_invoice text default null,p_notes text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v public.packaging_items%rowtype; d bigint; c numeric; prior public.packaging_movements%rowtype;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then raise exception 'Admin required'; end if;
 if p_id is null or p_quantity is null or p_quantity<=0 or p_type is null or p_type not in ('purchase','opening','waste','adjustment_in','adjustment_out') then raise exception 'Invalid movement'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,0));
 select * into prior from public.packaging_movements where id=p_id;
 if found then
 if prior.sku<>p_sku or prior.movement_type<>p_type or abs(prior.quantity_delta)<>p_quantity or prior.created_by<>auth.uid() then raise exception 'Request ID already used'; end if;
 return p_id; end if;
 select * into strict v from public.packaging_items where sku=p_sku for update;
 d:=case when p_type in ('waste','adjustment_out') then -p_quantity else p_quantity end;
 if v.quantity+d<0 then raise exception 'Insufficient packaging stock'; end if;
 if p_type='opening' and exists(select 1 from public.packaging_movements where sku=p_sku) then raise exception 'Opening already recorded'; end if;
 if p_type='purchase' and p_supplier is null then raise exception 'Supplier required'; end if;
 if p_type in ('purchase','opening','adjustment_in') then
 if p_unit_cost is null or p_unit_cost<0 or p_unit_cost::text in ('NaN','Infinity','-Infinity') then raise exception 'Valid cost required'; end if;
 c:=p_unit_cost;
 else c:=v.average_cost; end if;
 update public.packaging_items set quantity=v.quantity+d,
 average_cost=case when d>0 then (v.quantity*v.average_cost+d*c)/(v.quantity+d) else v.average_cost end where sku=p_sku;
 insert into public.packaging_movements(id,sku,quantity_delta,unit_cost,movement_type,supplier_id,invoice_number,notes,created_by)
 values(p_id,p_sku,d,c,p_type,p_supplier,p_invoice,p_notes,auth.uid());
 return p_id;
end; $$;
revoke all on function public.record_packaging_movement(uuid,text,text,bigint,numeric,uuid,text,text) from public,anon;
grant execute on function public.record_packaging_movement(uuid,text,text,bigint,numeric,uuid,text,text) to authenticated;
commit;