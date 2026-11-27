-- An inspection owns its checklist. Capture applicable requirements before the first reading.
begin;
alter table erp.quality_specs add column expected_text text;
alter table erp.quality_specs add column mandatory boolean not null default true;
alter table erp.inspections add column stage text;
alter table erp.lots add column producing_operation_id uuid references erp.operations;
create unique index one_open_inspection_per_lot on erp.inspections(lot_id) where status='pending';
create table erp.inspection_checks (
  inspection_id uuid references erp.inspections,
  spec_id uuid references erp.quality_specs,
  snapshot jsonb not null,
  primary key (inspection_id, spec_id)
);
alter table erp.inspection_checks enable row level security;
insert into erp.permissions values
 ('quality.inspect','Record inspection readings'), ('quality.release','Release inspected lots'),
 ('quality.configure','Maintain inspection specifications'), ('quality.read','Read inspection queue');

create function erp.require_permission(p_code text) returns void
language plpgsql stable set search_path='' as $$
begin
  if not erp.has_permission(p_code) then
    raise exception 'Missing permission: %', p_code using errcode='42501';
  end if;
end $$;

create function erp.begin_inspection(p_lot uuid) returns uuid
language plpgsql set search_path='' as $$
declare
  lot erp.lots%rowtype;
  inspection uuid;
  stage_code text := 'receipt';
begin
  perform erp.require_permission('quality.inspect');
  select * into strict lot from erp.lots where id=p_lot for update;
  if lot.quality_status not in ('pending','quarantine') then raise exception 'Lot unavailable for inspection'; end if;
  select id into inspection from erp.inspections where lot_id=p_lot and status='pending';
  if found then return inspection; end if;
  if lot.producing_operation_id is not null then
    select stage into strict stage_code from erp.operations where id=lot.producing_operation_id and status='completed';
  end if;
  insert into erp.inspections(lot_id,operation_id,stage) values(p_lot,lot.producing_operation_id,stage_code) returning id into inspection;
  insert into erp.inspection_checks
    select inspection,id,jsonb_build_object('name',test_name,'kind',result_kind,'min',min_value,'max',max_value,
      'expected',expected_text,'unit',unit,'mandatory',mandatory)
    from erp.quality_specs where active and stage=stage_code and (item_id is null or item_id=lot.item_id);
  if not exists(select from erp.inspection_checks where inspection_id=inspection and (snapshot->>'mandatory')::boolean) then
    raise exception 'No mandatory quality specification for this item and stage';
  end if;
  return inspection;
end $$;

create function erp.record_inspection(p_inspection uuid,p_values jsonb) returns text
language plpgsql set search_path='' as $$
declare
  c record; l uuid; inspection erp.inspections%rowtype; val jsonb; kind text;
  n numeric; b boolean; t text; ok boolean; overall boolean := true; result text;
begin
  perform erp.require_permission('quality.inspect');
  select lot_id into strict l from erp.inspections where id=p_inspection;
  perform id from erp.lots where id=l for update;
  select * into strict inspection from erp.inspections where id=p_inspection for update;
  if inspection.status<>'pending' then raise exception 'Inspection is final'; end if;
  if jsonb_typeof(p_values) is distinct from 'object' then raise exception 'Expected named readings'; end if;
  if exists(select from jsonb_object_keys(p_values) k where not exists
    (select from erp.inspection_checks where inspection_id=p_inspection and spec_id::text=k)) then raise exception 'Unknown check'; end if;
  if not exists(select from erp.inspection_checks where inspection_id=p_inspection and (snapshot->>'mandatory')::boolean)
    then raise exception 'Inspection has no mandatory checklist'; end if;
  for c in select * from erp.inspection_checks where inspection_id=p_inspection loop
    val:=p_values->c.spec_id::text; kind:=c.snapshot->>'kind';
    if val is null and not (c.snapshot->>'mandatory')::boolean then continue; end if;
    if jsonb_typeof(val) is distinct from (case kind when 'numeric' then 'number' when 'text' then 'string' else 'boolean' end)
      then raise exception 'Missing or invalid reading: %',c.snapshot->>'name'; end if;
    n:=null; b:=null; t:=null;
    if kind='numeric' then n:=(val#>>'{}')::numeric;
    elsif kind='boolean' then b:=(val#>>'{}')::boolean;
    else t:=val#>>'{}'; end if;
    ok:=erp.evaluate_quality_result(kind,n,b,t,(c.snapshot->>'min')::numeric,(c.snapshot->>'max')::numeric,c.snapshot->>'expected');
    insert into erp.inspection_results(inspection_id,spec_id,spec_snapshot,numeric_result,boolean_result,text_result,passed)
      values(p_inspection,c.spec_id,c.snapshot,n,b,t,ok);
    overall:=overall and ok;
  end loop;
  result:=case when overall then 'passed' else 'failed' end;
  update erp.inspections set status=result,inspected_by=auth.uid(),inspected_at=clock_timestamp() where id=p_inspection;
  if not overall then update erp.lots set quality_status='quarantine' where id=l; end if;
  insert into erp.audit_log(actor_id,action,entity_type,entity_id,after_data)
    values(auth.uid(),'quality.inspect','inspection',p_inspection::text,jsonb_build_object('result',result));
  return result;
end $$;

create or replace function erp.release_inspected_lot(p_lot uuid,p_inspection uuid) returns void
language plpgsql set search_path='' as $$
declare lot erp.lots%rowtype; inspection erp.inspections%rowtype;
begin
  perform erp.require_permission('quality.release');
  select * into strict lot from erp.lots where id=p_lot for update;
  select * into strict inspection from erp.inspections where id=p_inspection and lot_id=p_lot and status='passed' for share;
  if exists(select from erp.inspections where lot_id=p_lot and id<>p_inspection
      and (status='pending' or inspected_at>=inspection.inspected_at)) then raise exception 'Inspection superseded'; end if;
  if lot.quality_status='released' then return; end if;
  if lot.quality_status not in ('pending','quarantine') or lot.expires_on<current_date then raise exception 'Lot cannot be released'; end if;
  if inspection.inspected_by is null or inspection.inspected_at is null or inspection.stage is null or
     not exists(select from erp.inspection_checks where inspection_id=p_inspection and (snapshot->>'mandatory')::boolean) or
     exists(select from erp.inspection_checks c left join erp.inspection_results r using(inspection_id,spec_id)
       where c.inspection_id=p_inspection and (((c.snapshot->>'mandatory')::boolean and r.id is null)
         or (r.id is not null and (r.passed is distinct from true or r.spec_snapshot<>c.snapshot)))) then
    raise exception 'Incomplete or failed inspection';
  end if;
  update erp.lots set quality_status='released' where id=p_lot;
  insert into erp.audit_log(actor_id,action,entity_type,entity_id,after_data)
    values(auth.uid(),'quality.release','lot',p_lot::text,jsonb_build_object('inspection',p_inspection));
end $$;
revoke all on all functions in schema erp from public,anon,authenticated;
commit;
