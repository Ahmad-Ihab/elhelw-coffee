-- Draft journal posting guard. Internal only; no client grants.
begin;
create function erp.guard_journal_line() returns trigger language plpgsql set search_path='' as $$
declare v_id uuid; v_status text;
begin
if tg_op='UPDATE' and new.entry_id<>old.entry_id then raise exception 'Cannot move journal line'; end if;
if tg_op='DELETE' then v_id:=old.entry_id; else v_id:=new.entry_id; end if;
select status into v_status from erp.journal_entries where id=v_id for update;
if v_status is distinct from 'draft' then raise exception 'Journal is not editable'; end if;
if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger journal_line_guard before insert or update or delete on erp.journal_lines for each row execute function erp.guard_journal_line();
create function erp.guard_journal_entry() returns trigger language plpgsql set search_path='' as $$
declare p erp.fiscal_periods%rowtype; n bigint; balance numeric;
begin
if tg_op='INSERT' then
 if new.status<>'draft' or new.posted_at is not null then raise exception 'Create draft first'; end if; return new;
end if;
if old.status='posted' then raise exception 'Posted journal is immutable'; end if;
if tg_op='DELETE' then return old; end if;
if new.status='posted' then
 select * into p from erp.fiscal_periods where id=new.period_id for update;
 if p.status is distinct from 'open' or new.entry_date not between p.starts_on and p.ends_on then raise exception 'Invalid fiscal period'; end if;
 select count(*),coalesce(sum(debit-credit),0) into n,balance from erp.journal_lines where entry_id=new.id;
 if n<2 or balance<>0 then raise exception 'Unbalanced journal'; end if;
 perform a.id from erp.accounts a where a.id in (select account_id from erp.journal_lines where entry_id=new.id) order by a.id for share;
 if exists(select 1 from erp.journal_lines l join erp.accounts a on a.id=l.account_id where l.entry_id=new.id and (not a.active or not a.posting_allowed)) then raise exception 'Invalid posting account'; end if;
 if new.reversal_of is not null then raise exception 'Reversal API not implemented'; end if;
 new.posted_at:=now();
elsif new.posted_at is not null then raise exception 'Draft cannot have posting timestamp';
end if;
return new;
end $$;
create trigger journal_entry_guard before insert or update or delete on erp.journal_entries for each row execute function erp.guard_journal_entry();
revoke all on function erp.guard_journal_entry(),erp.guard_journal_line() from public,anon,authenticated;
commit;
-- Pending: authorized posting RPC, approval gates, period reopening, exact reversals,
-- integration with stock posting and concurrency tests.
