-- Draft genealogy integrity; serialize graph writes to prevent concurrent cycles.
begin;
create function erp.guard_genealogy() returns trigger language plpgsql set search_path='' as $$
declare s text;
begin
perform pg_advisory_xact_lock(731904,1);
if tg_op<>'INSERT' then raise exception 'Genealogy is append only'; end if;
select status into s from erp.stock_documents where id=new.document_id for update;
if s is distinct from 'draft' then raise exception 'Genealogy requires draft document'; end if;
if exists(with recursive descendants(id) as (select new.child_lot_id union select g.child_lot_id from erp.lot_genealogy g join descendants d on g.parent_lot_id=d.id) select 1 from descendants where id=new.parent_lot_id) then raise exception 'Genealogy cycle'; end if;
return new;
end $$;
create trigger genealogy_guard before insert or update or delete on erp.lot_genealogy for each row execute function erp.guard_genealogy();
create function erp.trace_lot_ancestors(p_lot uuid) returns table(lot_id uuid)
language sql stable set search_path='' as $$
with recursive ancestors(id) as (
select g.parent_lot_id from erp.lot_genealogy g join erp.stock_documents d on d.id=g.document_id where g.child_lot_id=p_lot and d.status='posted'
union
select g.parent_lot_id from erp.lot_genealogy g join ancestors a on g.child_lot_id=a.id join erp.stock_documents d on d.id=g.document_id where d.status='posted'
) select id from ancestors;
$$;
revoke all on function erp.guard_genealogy(),erp.trace_lot_ancestors(uuid) from public,anon,authenticated;
commit;
-- Posting API must reconcile genealogy quantities to actual input/output moves.
