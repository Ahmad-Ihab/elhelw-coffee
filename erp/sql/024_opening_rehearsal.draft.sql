-- Import explicit counts and carrying values into an empty test ledger once.
begin;
create table erp.opening_runs (
  id uuid primary key default gen_random_uuid(), reference text unique not null, as_of date not null,
  expected_lines integer not null check(expected_lines>0),
  expected_value numeric(24,8) not null check(expected_value>=0),
  expected_quantities jsonb not null check(jsonb_typeof(expected_quantities)='object'),
  status text not null default 'draft' check(status in ('draft','posted')),
  posted_by uuid references auth.users, posted_at timestamptz, review_snapshot jsonb
);
create table erp.opening_rows (
  run_id uuid references erp.opening_runs, source_table text not null, source_key text not null,
  lot_code text not null check(trim(lot_code)<>''), location_code text not null,
  base_unit text not null references erp.units, quantity numeric(18,6) not null check(quantity>=0),
  total_value numeric(24,8) not null check(total_value>=0 and (quantity>0 or total_value=0)),
  expires_on date, primary key(run_id,source_table,source_key,lot_code,location_code)
);
alter table erp.opening_runs enable row level security;
alter table erp.opening_rows enable row level security;
create function erp.opening_review(p_run uuid) returns jsonb language sql stable set search_path='' as $$
with mapped as (
  select r.*,i.id item_id,i.base_unit mapped_unit,i.inventory_account_id,loc.id location_id,
    coalesce(s.quantity,0) existing_qty,i.active
  from erp.opening_rows r
  left join erp.legacy_item_map m on (m.source_table,m.source_key)=(r.source_table,r.source_key)
  left join erp.items i on i.id=m.item_id
  left join erp.locations loc on loc.code=r.location_code and loc.active and loc.kind in ('storage','quarantine','channel','custody')
  left join erp.lots l on l.item_id=i.id and l.lot_code=r.lot_code
  left join erp.stock_balances s on (s.item_id,s.lot_id,s.location_id)=(m.item_id,l.id,loc.id)
  where r.run_id=p_run
), problems as (
  select source_key,lot_code,location_code,case
    when item_id is null then 'unmapped_item' when not active then 'inactive_item' when base_unit<>mapped_unit then 'unit_mismatch'
    when base_unit='EA' and quantity<>trunc(quantity) then 'fractional_piece'
    when location_id is null then 'invalid_location' when existing_qty<>0 then 'existing_balance'
    when inventory_account_id is null then 'missing_inventory_account' end reason from mapped
  union all select min(source_key),lot_code,location_code,'duplicate_mapped_count' from mapped
    group by item_id,lot_code,location_code having count(*)>1
  union all select min(source_key),lot_code,null,'inconsistent_expiry' from mapped
    group by item_id,lot_code having count(distinct coalesce(expires_on,'infinity'::date))>1
), totals as (
  select coalesce(jsonb_object_agg(base_unit,qty),'{}'::jsonb) quantities from
    (select base_unit,sum(quantity) qty from mapped group by base_unit) by_unit
)
select coalesce(b.review_snapshot,jsonb_build_object('reference',b.reference,'status',b.status,'lines',(select count(*) from mapped),
  'value',coalesce((select sum(total_value) from mapped),0),'quantities',totals.quantities,
  'problems',coalesce((select jsonb_agg(to_jsonb(p) order by source_key,lot_code) from problems p where reason is not null),'[]'::jsonb),
  'matches',b.expected_lines=(select count(*) from mapped) and b.expected_value=coalesce((select sum(total_value) from mapped),0)
      and b.expected_quantities=totals.quantities and not exists(select from problems where reason is not null)))
from erp.opening_runs b cross join totals where b.id=p_run
$$;
create function erp.post_opening(p_run uuid) returns jsonb language plpgsql set search_path='' as $$
declare b erp.opening_runs%rowtype; r record; l uuid; d uuid; idx int:=0; period uuid; review jsonb; offset_id uuid;
begin
  perform erp.require_permission('migration.stage');
  perform pg_advisory_xact_lock(731904,2);
  select * into strict b from erp.opening_runs where id=p_run for update;
  if b.status='posted' then return jsonb_build_object('posted',true,'reference',b.reference); end if;
  lock table erp.opening_rows,erp.legacy_item_map in share mode;
  -- Exclude concurrent first receipt/issue as well as another opening import.
  lock table erp.stock_documents,erp.stock_balances,erp.item_valuation in share row exclusive mode;
  if exists(select from erp.stock_moves) or exists(select from erp.stock_balances where quantity<>0)
    or exists(select from erp.item_valuation where quantity<>0 or total_value<>0) or exists(select from erp.opening_runs where status='posted')
    then raise exception 'Opening import requires an empty ledger'; end if;
  review:=erp.opening_review(p_run);
  if (review->>'matches')::boolean is distinct from true then raise exception 'Opening counts do not reconcile'; end if;
  period:=erp.open_period(b.as_of); offset_id:=erp.posting_account('opening_equity');
  for r in select rows.*,m.item_id,loc.id destination from erp.opening_rows rows join erp.legacy_item_map m using(source_table,source_key)
    join erp.locations loc on loc.code=rows.location_code where run_id=p_run and rows.quantity>0 order by m.item_id,rows.lot_code,loc.id loop
    idx:=idx+1;
    insert into erp.lots(item_id,lot_code,expires_on) values(r.item_id,r.lot_code,r.expires_on) on conflict(item_id,lot_code) do nothing;
    select id into strict l from erp.lots where item_id=r.item_id and lot_code=r.lot_code and expires_on is not distinct from r.expires_on and quality_status='pending';
    insert into erp.stock_documents(source_type,source_id,idempotency_key,created_by)
      values('opening_stock',p_run::text,'opening:'||p_run||':'||idx,auth.uid()) returning id into d;
    perform erp.post_stock_value(d,r.item_id,l,r.destination,r.quantity,r.total_value,offset_id,period,b.as_of);
  end loop;
  if exists(select from erp.inventory_reconciliation where not reconciled) then raise exception 'Opening ledger mismatch'; end if;
  update erp.opening_runs set status='posted',review_snapshot=review||jsonb_build_object('status','posted'),posted_by=auth.uid(),posted_at=now() where id=p_run;
  insert into erp.audit_log(actor_id,action,entity_type,entity_id,after_data) values(auth.uid(),'migration.open','opening_run',p_run::text,review);
  return jsonb_build_object('posted',true,'reference',b.reference);
end $$;
revoke all on all functions in schema erp from public,anon,authenticated;
commit;
