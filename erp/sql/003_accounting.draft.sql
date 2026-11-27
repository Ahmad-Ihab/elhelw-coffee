-- Draft accounting foundation. Depends on 001. No posting API yet.
begin;
create table erp.accounts(id uuid primary key default gen_random_uuid(), code text unique not null, name text not null, kind text not null check(kind in ('asset','liability','equity','revenue','expense')), parent_id uuid references erp.accounts, active boolean not null default true, posting_allowed boolean not null default true, check(parent_id is distinct from id));
create table erp.fiscal_periods(id uuid primary key default gen_random_uuid(), starts_on date not null, ends_on date not null, status text not null default 'open' check(status in ('open','closed')), check(ends_on>=starts_on), exclude using gist (daterange(starts_on,ends_on,'[]') with &&));
create table erp.journal_entries(id uuid primary key default gen_random_uuid(), period_id uuid not null references erp.fiscal_periods, entry_date date not null, source_type text not null, source_id text not null, idempotency_key text unique not null, status text not null default 'draft' check(status in ('draft','posted')), reversal_of uuid unique references erp.journal_entries, description text not null, created_by uuid references auth.users, posted_at timestamptz);
create table erp.journal_lines(id bigint generated always as identity primary key, entry_id uuid not null references erp.journal_entries, account_id uuid not null references erp.accounts, debit numeric(24,8) not null default 0, credit numeric(24,8) not null default 0, check((debit>0 and credit=0) or (credit>0 and debit=0)));
create table erp.treasuries(id uuid primary key default gen_random_uuid(), account_id uuid unique not null references erp.accounts, name text not null, kind text not null check(kind in ('cash','bank','wallet','gateway','courier','advance')), active boolean not null default true);
create index on erp.journal_lines(entry_id);
create index on erp.journal_lines(account_id);
do $$ declare t record; begin for t in select tablename from pg_tables where schemaname='erp' loop execute format('alter table erp.%I enable row level security',t.tablename); end loop; end $$;
commit;
-- Before deployment: enforce balanced posting, period locking, immutability,
-- account eligibility, reversal matching and atomic stock/journal posting.
