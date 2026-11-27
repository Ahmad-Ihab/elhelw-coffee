-- Draft reconciliation views; private schema, no client access.
begin;
create view erp.inventory_reconciliation with (security_invoker=true) as
with balances as (select item_id,sum(quantity) quantity from erp.stock_balances group by item_id),
moves as (select m.item_id,sum(m.quantity_delta) quantity,sum(m.value_delta) total_value from erp.stock_moves m join erp.stock_documents d on d.id=m.document_id where d.status='posted' group by m.item_id)
select i.id item_id,i.sku,coalesce(b.quantity,0) balance_quantity,coalesce(v.quantity,0) valuation_quantity,coalesce(m.quantity,0) ledger_quantity,coalesce(v.total_value,0) valuation_value,coalesce(m.total_value,0) ledger_value,
coalesce(b.quantity,0)=coalesce(v.quantity,0) and coalesce(b.quantity,0)=coalesce(m.quantity,0) and coalesce(v.total_value,0)=coalesce(m.total_value,0) as reconciled
from erp.items i left join balances b on b.item_id=i.id left join erp.item_valuation v on v.item_id=i.id left join moves m on m.item_id=i.id;
create view erp.trial_balance with (security_invoker=true) as
select a.id account_id,a.code,a.name,e.period_id,sum(l.debit) debit,sum(l.credit) credit,sum(l.debit-l.credit) net
from erp.journal_lines l join erp.journal_entries e on e.id=l.entry_id join erp.accounts a on a.id=l.account_id where e.status='posted' group by a.id,a.code,a.name,e.period_id;
revoke all on erp.inventory_reconciliation,erp.trial_balance from public,anon,authenticated;
commit;
