begin;
create view erp.inventory_account_reconciliation with (security_invoker=true) as
with carrying as (
 select i.inventory_account_id account_id,sum(coalesce(v.total_value,0)) stock_value from erp.items i left join erp.item_valuation v on v.item_id=i.id
 where i.inventory_account_id is not null group by i.inventory_account_id
), gl as (select account_id,sum(net) gl_value from erp.trial_balance group by account_id)
select a.code,c.stock_value,coalesce(g.gl_value,0) gl_value,c.stock_value=coalesce(g.gl_value,0) reconciled
from carrying c join erp.accounts a on a.id=c.account_id left join gl g on g.account_id=c.account_id;

create function erp.refund_direct_cash(p_return uuid,p_treasury uuid,p_date date) returns uuid language plpgsql set search_path='' as $$
declare r erp.sales_returns%rowtype; value numeric; acct uuid; doc uuid; j uuid;
begin
 perform erp.require_permission('sales.manage');
 select * into strict r from erp.sales_returns where id=p_return and refund_voucher_id is null for update;
 perform i.id from erp.sales_invoices i join erp.sales_orders o on o.id=i.order_id join erp.channels c on c.id=o.channel_id
   where i.id=r.invoice_id and o.distributor_id is null and c.fulfillment='direct' for update of i;
 if not found then raise exception 'Direct sale required';end if;
 select least(erp.cash_refund_due(r.invoice_id),sum(refund_amount)) into value from erp.sales_return_lines where return_id=p_return;
 if value=0 then return null;end if;
 select account_id into strict acct from erp.treasuries where id=p_treasury and active and kind in ('cash','bank','wallet') for update;
 insert into erp.vouchers(code,kind,treasury_id,amount,voucher_date) values('REF-'||p_return,'payment',p_treasury,value,p_date) returning id into doc;
 j:=erp.post_pair(p_date,'direct_refund',p_return,'Direct customer refund',erp.posting_account('receivables'),acct,value);
 update erp.vouchers set journal_entry_id=j where id=doc;
 update erp.sales_returns set refund_voucher_id=doc where id=p_return;
 return doc;
end $$;
revoke all on function erp.refund_direct_cash(uuid,uuid,date) from public,anon,authenticated;
revoke all on erp.inventory_account_reconciliation from public,anon,authenticated;
commit;
