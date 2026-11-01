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
  delete from public.payment_allocations;
  delete from public.remittance_allocations;
  delete from public.remittance_commission_allocations;
  delete from public.sales_return_refunds;
  delete from public.return_quarantine_movements;
  delete from public.distributor_commission_adjustments;
  delete from public.sales_return_items;
  delete from public.sales_returns;
  delete from public.sales_invoice_items;
  delete from public.sales_invoices;
  delete from public.order_items;
  delete from public.orders;
  delete from public.sample_items;
  delete from public.samples;
  delete from public.cafe_payments;
  delete from public.distributor_expenses;
  delete from public.distributor_remittances;
  delete from public.stock_movements;
  delete from public.stock_balances;
  delete from public.company_stock_movements;
  delete from public.company_stock_balances;
  delete from public.cafes;

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
