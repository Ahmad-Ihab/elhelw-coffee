-- Admin-only destructive reset for demo/operational data.
-- Retains auth users, profiles, distributors, products, prices and commission rules.
create or replace function public.admin_reset_demo_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_counts jsonb := '{}'::jsonb;
  v_count bigint;
begin
  if not public.is_admin() then
    raise exception 'Only admins can reset demo data' using errcode = '42501';
  end if;

  -- Delete dependent ledgers first; keep this operation atomic.
  delete from public.payment_allocations where true;
  delete from public.remittance_allocations where true;
  delete from public.remittance_commission_allocations where true;
  delete from public.sales_return_refunds where true;
  delete from public.return_quarantine_movements where true;
  delete from public.distributor_commission_adjustments where true;
  delete from public.sales_return_items where true;
  delete from public.sales_returns where true;
  delete from public.sales_invoice_items where true;
  delete from public.sales_invoices where true;
  delete from public.order_items where true;
  delete from public.orders where true;
  delete from public.sample_items where true;
  delete from public.samples where true;
  delete from public.cafe_payments where true;
  delete from public.distributor_expenses where true;
  delete from public.distributor_remittances where true;
  delete from public.stock_movements where true;
  delete from public.stock_balances where true;
  delete from public.company_stock_movements where true;
  delete from public.company_stock_balances where true;
  delete from public.cafes where true;

  -- Restart business-facing document numbers for the next clean test run.
  perform pg_catalog.setval(pg_catalog.pg_get_serial_sequence('public.orders','order_number'), 1, false);
  perform pg_catalog.setval(pg_catalog.pg_get_serial_sequence('public.sales_invoices','invoice_number'), 1, false);
  perform pg_catalog.setval(pg_catalog.pg_get_serial_sequence('public.sales_returns','return_number'), 1, false);

  return jsonb_build_object(
    'success', true,
    'reset_at', pg_catalog.now(),
    'preserved', jsonb_build_array('auth.users','profiles','distributors','products','product_prices','commission_rules')
  );
end;
$function$;

revoke all on function public.admin_reset_demo_data() from public, anon;
grant execute on function public.admin_reset_demo_data() to authenticated;
