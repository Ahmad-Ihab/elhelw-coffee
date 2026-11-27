-- Draft ledger integrity hardening; depends on 001–014.
begin;
create function erp.guard_stock_move() returns trigger language plpgsql set search_path='' as $$
declare d uuid; s text;
begin
if tg_op='UPDATE' and new.document_id<>old.document_id then raise exception 'Cannot move ledger row'; end if;
if tg_op='DELETE' then d:=old.document_id; else d:=new.document_id; end if;
select status into s from erp.stock_documents where id=d for update;
if s is distinct from 'draft' then raise exception 'Stock ledger is immutable'; end if;
if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger stock_move_guard before insert or update or delete on erp.stock_moves for each row execute function erp.guard_stock_move();
create function erp.guard_stock_document() returns trigger language plpgsql set search_path='' as $$
begin
if tg_op='INSERT' then
 if new.status<>'draft' or new.posted_at is not null then raise exception 'Create draft first'; end if; return new;
end if;
if old.status<>'draft' then raise exception 'Posted stock document is immutable'; end if;
if tg_op='DELETE' then return old; end if;
if new.status='posted' then
 if not exists(select 1 from erp.stock_moves where document_id=new.id) then raise exception 'Empty stock document'; end if;
 new.posted_at:=now();
elsif new.status<>'draft' or new.posted_at is not null then raise exception 'Invalid document state';
end if;
return new;
end $$;
create trigger stock_document_guard before insert or update or delete on erp.stock_documents for each row execute function erp.guard_stock_document();
revoke all on function erp.guard_stock_move(),erp.guard_stock_document() from public,anon,authenticated;
commit;
-- Reversals must be separate compensating documents; trusted posting APIs still required.
