-- Correct cafe receivables after returns: the cafe debt is reduced by the full refund,
-- not merely the company's net share after distributor commission.
CREATE OR REPLACE FUNCTION public.record_cafe_payment(
    p_cafe_id uuid,
    p_amount numeric,
    p_payment_method text DEFAULT 'cash'::text,
    p_received_by text DEFAULT 'distributor'::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_dist uuid;
    v_payment uuid;
    v_left numeric := p_amount;
    inv record;
    v_due numeric;
    v_alloc numeric;
    v_paid numeric;
    v_returned numeric;
    v_is_admin boolean;
BEGIN
    IF p_cafe_id IS NULL THEN RAISE EXCEPTION 'Cafe is required'; END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
    IF p_payment_method IS NULL OR btrim(p_payment_method) = '' THEN RAISE EXCEPTION 'Payment method is required'; END IF;
    IF p_received_by IS NULL OR p_received_by NOT IN ('distributor', 'company') THEN RAISE EXCEPTION 'Invalid receiver'; END IF;
    v_is_admin := public.is_admin();
    IF NOT v_is_admin AND p_received_by <> 'distributor' THEN RAISE EXCEPTION 'Distributor can only record payments received by distributor'; END IF;
    SELECT distributor_id INTO v_dist FROM public.cafes WHERE id=p_cafe_id AND status='active' FOR UPDATE;
    IF NOT FOUND OR v_dist IS NULL THEN RAISE EXCEPTION 'Cafe is inactive or missing'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.distributors WHERE id=v_dist AND active=true) THEN RAISE EXCEPTION 'Distributor is inactive or missing'; END IF;
    IF NOT v_is_admin AND v_dist<>public.current_distributor_id() THEN RAISE EXCEPTION 'Not authorized'; END IF;
    PERFORM 1 FROM public.sales_invoices WHERE cafe_id=p_cafe_id AND status='issued' ORDER BY invoice_date,id FOR UPDATE;

    SELECT COALESCE(SUM(GREATEST(si.total_amount-COALESCE(r.returned_amount,0)-COALESCE(p.paid_amount,0),0)),0)
    INTO v_due
    FROM public.sales_invoices si
    LEFT JOIN (
        SELECT sr.invoice_id,SUM(sri.refund_amount) returned_amount
        FROM public.sales_returns sr JOIN public.sales_return_items sri ON sri.return_id=sr.id GROUP BY sr.invoice_id
    ) r ON r.invoice_id=si.id
    LEFT JOIN (
        SELECT pa.invoice_id,SUM(pa.amount) paid_amount FROM public.payment_allocations pa GROUP BY pa.invoice_id
    ) p ON p.invoice_id=si.id
    WHERE si.cafe_id=p_cafe_id AND si.status='issued';
    IF p_amount>v_due THEN RAISE EXCEPTION 'Payment exceeds outstanding balance by %',p_amount-v_due; END IF;

    INSERT INTO public.cafe_payments(cafe_id,distributor_id,amount,received_by,payment_method,created_by)
    VALUES(p_cafe_id,v_dist,p_amount,p_received_by,btrim(p_payment_method),auth.uid()) RETURNING id INTO v_payment;

    FOR inv IN SELECT * FROM public.sales_invoices WHERE cafe_id=p_cafe_id AND status='issued' ORDER BY invoice_date,id FOR UPDATE LOOP
        SELECT COALESCE(SUM(pa.amount),0) INTO v_paid FROM public.payment_allocations pa WHERE pa.invoice_id=inv.id;
        SELECT COALESCE(SUM(sri.refund_amount),0) INTO v_returned
        FROM public.sales_returns sr JOIN public.sales_return_items sri ON sri.return_id=sr.id WHERE sr.invoice_id=inv.id;
        v_due:=GREATEST(inv.total_amount-v_paid-v_returned,0);
        IF v_due>0 AND v_left>0 THEN
            v_alloc:=LEAST(v_due,v_left);
            INSERT INTO public.payment_allocations(payment_id,invoice_id,amount) VALUES(v_payment,inv.id,v_alloc);
            v_left:=v_left-v_alloc;
        END IF;
    END LOOP;
    IF v_left>0 THEN RAISE EXCEPTION 'Unable to allocate full payment'; END IF;
    RETURN v_payment;
END;
$function$;
REVOKE ALL ON FUNCTION public.record_cafe_payment(uuid,numeric,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_cafe_payment(uuid,numeric,text,text) TO authenticated;

-- Under the agreed cash model, the company funds the complete refund immediately.
CREATE OR REPLACE FUNCTION public.fund_sales_return_refund(p_return_id uuid,p_notes text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_invoice_id uuid; v_invoice public.sales_invoices%ROWTYPE; v_amount numeric; v_refund_id uuid;
BEGIN
    IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only admin can allocate a return refund'; END IF;
    IF p_return_id IS NULL THEN RAISE EXCEPTION 'Return ID is required'; END IF;
    SELECT invoice_id INTO v_invoice_id FROM public.sales_returns WHERE id=p_return_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Return not found'; END IF;
    SELECT * INTO v_invoice FROM public.sales_invoices WHERE id=v_invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Original invoice not found'; END IF;
    PERFORM 1 FROM public.sales_returns WHERE id=p_return_id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM public.sales_return_refunds WHERE return_id=p_return_id) THEN RAISE EXCEPTION 'Refund has already been allocated for this return'; END IF;
    SELECT COALESCE(SUM(refund_amount),0) INTO v_amount FROM public.sales_return_items WHERE return_id=p_return_id;
    IF v_amount<=0 THEN RAISE EXCEPTION 'No positive refund amount to allocate'; END IF;
    INSERT INTO public.sales_return_refunds(return_id,amount,distributor_held_amount,company_funded_amount,funded_at,funded_by,notes)
    VALUES(p_return_id,v_amount,0,v_amount,NULL,NULL,p_notes) RETURNING id INTO v_refund_id;
    RETURN v_refund_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.fund_sales_return_refund(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fund_sales_return_refund(uuid,text) TO authenticated;