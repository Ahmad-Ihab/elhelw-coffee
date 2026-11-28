begin;
do $test$
declare
  owner_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  ordinary uuid := gen_random_uuid();
  admin_role uuid;
  reviewer uuid;
  supplier uuid;
  rule uuid;
  actor uuid;
  po uuid;
  po_a uuid;
  visible jsonb;
  decision jsonb;
begin
  insert into auth.users(id) values (owner_a), (owner_b), (ordinary);
  insert into erp.roles(code, name) values ('ERP_ADMIN', 'Owner') returning id into admin_role;
  select id into strict reviewer from erp.roles where code = 'STAFF_PURCHASE_REVIEW';
  insert into erp.role_permissions values (admin_role, 'purchases.approve'), (admin_role, 'purchases.review_own');
  insert into erp.user_roles values (owner_a, admin_role), (owner_b, admin_role), (ordinary, admin_role),
    (owner_a, reviewer), (owner_b, reviewer), (ordinary, reviewer);
  insert into erp.user_permissions values (owner_a, 'purchases.review_own', true), (owner_b, 'purchases.review_own', true);
  insert into erp.suppliers(code, name) values ('S', 'Supplier') returning id into supplier;
  insert into erp.approval_rules(document_type) values ('purchase') returning id into rule;
  insert into erp.approval_rule_steps values (rule, 1, reviewer);

  foreach actor in array array[owner_a, owner_b, ordinary] loop
    insert into erp.purchase_orders(code, supplier_id, status) values (actor::text, supplier, 'pending') returning id into po;
    insert into erp.approval_requests(rule_id, document_type, document_id, requested_by, rule_snapshot)
      values (rule, 'purchase', po, actor, jsonb_build_array(reviewer));
    if actor = owner_a then po_a := po; end if;
    perform set_config('request.jwt.claim.sub', actor::text, true);
    visible := public.elhelw_erp_workspace() #> '{choices,approvals}';
    if (visible @> jsonb_build_array(jsonb_build_object('id', po))) is distinct from (actor <> ordinary) then
      raise exception 'Own order visibility differs from individual grant';
    end if;
    if actor = ordinary then
      begin
        perform public.elhelw_erp_command('purchase_decide', jsonb_build_object('order',po,'decision','approved'), gen_random_uuid());
        raise exception 'Unexpected self-approval';
      exception when raise_exception then
        if sqlerrm <> 'Requester cannot approve own purchase' then raise; end if;
      end;
    else
      -- The second owner can also see the first owner's pending order.
      if actor = owner_b and not (visible @> jsonb_build_array(jsonb_build_object('id', po_a))) then
        raise exception 'Other owner cannot review the pending order';
      end if;
      if actor = owner_b then
        decision := public.elhelw_erp_command('purchase_decide', jsonb_build_object('order',po,'decision','approved'), gen_random_uuid());
        if decision is distinct from '"approved"'::jsonb then raise exception 'Own approval failed'; end if;
      end if;
    end if;
  end loop;
  perform set_config('request.jwt.claim.sub', owner_a::text, true);
  delete from erp.user_roles where user_id=owner_a and role_id=reviewer;
  if public.elhelw_erp_workspace() #> '{choices,approvals}' @> jsonb_build_array(jsonb_build_object('id', po_a)) then
    raise exception 'Order visible without assigned step role';
  end if;
  begin
    perform public.elhelw_erp_command('purchase_decide', jsonb_build_object('order',po_a,'decision','approved'), gen_random_uuid());
    raise exception 'Missing step role was ignored';
  exception when insufficient_privilege then null;
  end;
  insert into erp.user_roles values (owner_a, reviewer);
  decision := public.elhelw_erp_command('purchase_decide', jsonb_build_object('order',po_a,'decision','approved'), gen_random_uuid());
  if decision is distinct from '"approved"'::jsonb or
      (select count(*) from erp.approval_decisions where actor_id in (owner_a, owner_b)) <> 2 then
    raise exception 'Decisions must record the actual reviewers';
  end if;
end
$test$;
rollback;
