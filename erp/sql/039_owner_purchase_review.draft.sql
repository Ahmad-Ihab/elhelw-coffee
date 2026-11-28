begin;
insert into erp.permissions(code, description)
values ('purchases.review_own', 'Allow a designated owner to review their own purchase at an assigned step');

-- An owner needs an individual grant; inheriting all permissions through a role is insufficient.
create function erp.purchase_requester_can_review(requester uuid)
returns boolean language sql stable set search_path='' as $$
  select requester <> auth.uid() or (
    erp.staff_owner(auth.uid()) and exists (
      select from erp.user_permissions
      where user_id = auth.uid() and permission_code = 'purchases.review_own' and allowed
    )
  )
$$;
revoke all on function erp.purchase_requester_can_review(uuid) from public, anon, authenticated;

-- Update the requester check in both existing RPC paths. Preserve their other
-- predicates, including the role in the saved approval step, and their ACLs.
do $migration$
declare
  target record;
  definition text;
begin
  for target in select * from (values
    ('erp.workspace()'::regprocedure,
     'a.requested_by<>auth.uid()', 'erp.purchase_requester_can_review(a.requested_by)'),
    ('erp.decide_purchase(uuid,text)'::regprocedure,
     'if req.requested_by=auth.uid() then', 'if not erp.purchase_requester_can_review(req.requested_by) then')
  ) as changes(routine, previous_check, updated_check)
  loop
    definition := pg_get_functiondef(target.routine);
    if array_length(string_to_array(definition, target.previous_check), 1) <> 2 then
      raise exception 'Expected exactly one requester check in %', target.routine;
    end if;
    execute replace(definition, target.previous_check, target.updated_check);
  end loop;
end
$migration$;
commit;
