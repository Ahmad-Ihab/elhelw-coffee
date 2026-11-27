-- Run only on an isolated database after applying drafts 001–015.
begin;
do $$
declare r record;
begin
select * into r from erp.calculate_receipt_value(100,25000,50,15500);
if r.quantity<>150 or r.total_value<>40500 or r.average_cost<>270 then raise exception 'Receipt valuation failed'; end if;
select * into r from erp.calculate_issue_value(150,40500,30);
if r.quantity<>120 or r.total_value<>32400 or r.issue_value<>8100 then raise exception 'Issue valuation failed'; end if;
select * into r from erp.calculate_issue_value(3,10,3);
if r.quantity<>0 or r.total_value<>0 or r.issue_value<>10 then raise exception 'Full depletion failed'; end if;
end $$;
do $$
declare p uuid; a uuid; b uuid; j uuid;
begin
insert into erp.fiscal_periods(starts_on,ends_on) values('2199-01-01','2199-01-31') returning id into p;
insert into erp.accounts(code,name,kind) values('TEST-A','Test asset','asset') returning id into a;
insert into erp.accounts(code,name,kind) values('TEST-B','Test equity','equity') returning id into b;
insert into erp.journal_entries(period_id,entry_date,source_type,source_id,idempotency_key,description) values(p,'2199-01-01','test','1','test:1','Test') returning id into j;
insert into erp.journal_lines(entry_id,account_id,debit,credit) values(j,a,100,0);
begin
update erp.journal_entries set status='posted' where id=j;
raise exception 'Unexpected success';
exception when raise_exception then if sqlerrm<>'Unbalanced journal' then raise; end if;
end;
insert into erp.journal_lines(entry_id,account_id,debit,credit) values(j,b,0,100);
update erp.journal_entries set status='posted' where id=j;
begin
delete from erp.journal_lines where entry_id=j;
raise exception 'Unexpected success';
exception when raise_exception then if sqlerrm<>'Journal is not editable' then raise; end if;
end;
end $$;
rollback;
