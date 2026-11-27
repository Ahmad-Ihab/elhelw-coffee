-- Draft foundation; apply only to isolated test database.
begin;
create schema erp;
revoke all on schema erp from public, anon, authenticated;
create table erp.roles(id uuid primary key default gen_random_uuid(), code text unique not null, name text not null);
create table erp.permissions(code text primary key, description text not null);
create table erp.role_permissions(role_id uuid references erp.roles on delete cascade, permission_code text references erp.permissions on delete cascade, primary key(role_id,permission_code));
create table erp.user_roles(user_id uuid references auth.users on delete cascade, role_id uuid references erp.roles on delete cascade, primary key(user_id,role_id));
create table erp.user_permissions(user_id uuid references auth.users on delete cascade, permission_code text references erp.permissions on delete cascade, allowed boolean not null, primary key(user_id,permission_code));
create table erp.units(code text primary key, name text not null, dimension text not null check(dimension in ('mass','count','volume')));
create table erp.items(id uuid primary key default gen_random_uuid(), sku text unique not null check(length(trim(sku))>0), name text not null, kind text not null check(kind in ('RM','ADD','GB','RB','GC','FB','PK','FG')), base_unit text not null references erp.units, net_weight_kg numeric(18,6) check(net_weight_kg>0), shelf_life_days integer check(shelf_life_days>0), reorder_point numeric(18,6) not null default 0 check(reorder_point>=0), active boolean not null default true, created_at timestamptz not null default now(), check(kind<>'FG' or net_weight_kg is not null));
create table erp.item_units(item_id uuid references erp.items, unit_code text references erp.units, factor_to_base numeric(24,12) not null check(factor_to_base>0), primary key(item_id,unit_code));
create table erp.locations(id uuid primary key default gen_random_uuid(), code text unique not null, name text not null, parent_id uuid references erp.locations, kind text not null check(kind in ('warehouse','storage','channel','custody','quarantine')), active boolean not null default true, check(parent_id is distinct from id));
create table erp.legacy_item_map(source_table text not null, source_key text not null, item_id uuid not null references erp.items, primary key(source_table,source_key));
create table erp.audit_log(id bigint generated always as identity primary key, actor_id uuid, action text not null, entity_type text not null, entity_id text not null, before_data jsonb, after_data jsonb, occurred_at timestamptz not null default now());
create function erp.has_permission(p_code text) returns boolean language sql stable security definer set search_path = '' as $$
select coalesce((select allowed from erp.user_permissions where user_id=auth.uid() and permission_code=p_code), exists(select 1 from erp.user_roles ur join erp.role_permissions rp on rp.role_id=ur.role_id where ur.user_id=auth.uid() and rp.permission_code=p_code)) and auth.uid() is not null;
$$;
revoke all on function erp.has_permission(text) from public, anon, authenticated;
do $$ declare t record; begin for t in select tablename from pg_tables where schemaname='erp' loop execute format('alter table erp.%I enable row level security',t.tablename); end loop; end $$;
insert into erp.units values ('KG','Kilogram','mass'),('G','Gram','mass'),('EA','Piece','count'),('L','Litre','volume'),('ML','Millilitre','volume');
insert into erp.permissions values ('items.read','Read items'),('items.write','Manage items'),('roles.manage','Manage roles'),('locations.manage','Manage locations'),('audit.read','Read audit');
commit;
