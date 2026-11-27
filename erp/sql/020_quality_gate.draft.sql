-- Draft quality release gate. Numeric and boolean checks are evaluated from snapshots.
begin;
create function erp.evaluate_quality_result(p_kind text,p_numeric numeric,p_boolean boolean,p_text text,p_min numeric,p_max numeric,p_expected_text text)
returns boolean language plpgsql immutable set search_path='' as $$
begin
if p_kind='numeric' then return p_numeric is not null and (p_min is null or p_numeric>=p_min) and (p_max is null or p_numeric<=p_max);
elsif p_kind='boolean' then return p_boolean is true;
elsif p_kind='text' then return p_text is not null and p_expected_text is not null and p_text=p_expected_text;
else raise exception 'Unknown quality result kind';
end if;
end $$;
create function erp.release_inspected_lot(p_lot uuid,p_inspection uuid) returns void language plpgsql set search_path='' as $$
declare l erp.lots%rowtype;
begin
select * into l from erp.lots where id=p_lot for update;
if not found or l.quality_status not in ('pending','quarantine') then raise exception 'Lot cannot be released'; end if;
perform id from erp.inspections where id=p_inspection and lot_id=p_lot and status='passed' for update;
if not found then raise exception 'Passed inspection required'; end if;
if not exists(select 1 from erp.inspection_results where inspection_id=p_inspection) or exists(select 1 from erp.inspection_results where inspection_id=p_inspection and passed is distinct from true) then raise exception 'Incomplete or failed inspection'; end if;
-- Fail closed: completeness against mandatory stage/item specifications is not implemented.
raise exception 'Quality specification completeness gate not implemented';
end $$;
revoke all on function erp.evaluate_quality_result(text,numeric,boolean,text,numeric,numeric,text),erp.release_inspected_lot(uuid,uuid) from public,anon,authenticated;
commit;
