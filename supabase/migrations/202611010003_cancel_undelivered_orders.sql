alter table public.orders
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text,
  add column if not exists cancelled_by uuid references auth.users(id);

create or replace function public.cancel_undelivered_order(
  p_order_id uuid,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if not (public.is_admin() or v_order.distributor_id = public.current_distributor_id()) then
    raise exception 'Not authorized';
  end if;

  if v_order.status not in ('confirmed', 'preparing') then
    raise exception 'Only undelivered orders can be cancelled';
  end if;

  update public.orders
  set status = 'cancelled',
      cancelled_at = now(),
      cancellation_reason = nullif(btrim(p_reason), ''),
      cancelled_by = auth.uid()
  where id = p_order_id;

  return p_order_id;
end;
$function$;

revoke all on function public.cancel_undelivered_order(uuid,text) from public, anon;
grant execute on function public.cancel_undelivered_order(uuid,text) to authenticated;
