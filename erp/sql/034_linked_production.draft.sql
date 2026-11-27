begin;
create function erp.linked_work_order(p jsonb) returns uuid language plpgsql set search_path='' as $$
declare wo uuid; step record; previous_item uuid; new_item uuid; qty numeric:=(p->>'qty')::numeric; absorbed int:=0;
begin
 perform erp.require_permission('manufacturing.post');
 if nullif(trim(p->>'code'),'') is null or jsonb_typeof(p->'steps') is distinct from 'array' or jsonb_array_length(p->'steps')=0 then raise exception 'Work order number and stages required';end if;
 insert into erp.work_orders(code,planned_quantity,status) values(p->>'code',qty,'approved') returning id into wo;
 for step in select x.n,(x.v->>'recipe')::uuid version_id,(x.v->>'direct')::numeric direct from jsonb_array_elements(p->'steps') with ordinality x(v,n) order by n loop
  select b.output_item_id into strict new_item from erp.boms b join erp.bom_versions v on v.bom_id=b.id and v.status='approved' where v.id=step.version_id;
  if previous_item is not null and not exists(select from erp.bom_components c where c.version_id=step.version_id and c.item_id=previous_item) then raise exception 'The next recipe must consume the preceding stage output';end if;
  if (select apply_overhead from erp.manufacturing_policy where version_id=step.version_id) then absorbed:=absorbed+1;end if;
  insert into erp.operations(work_order_id,sequence_no,recipe_version_id,stage) select wo,step.n,step.version_id,stage from erp.manufacturing_policy where version_id=step.version_id;
  if step.direct is not null and step.direct<>0 then insert into erp.operation_costs(operation_id,category,amount)
    select id,'other',step.direct from erp.operations where work_order_id=wo and sequence_no=step.n;end if;
  previous_item:=new_item;
 end loop;
 if absorbed>1 then raise exception 'Select one overhead-bearing stage per work order'; end if;
 return wo;
end $$;

-- Per-warehouse component requirements, using an explicitly selected recipe for each output.
create table erp.planning_recipes (
 item_id uuid references erp.items, location_id uuid references erp.locations, version_id uuid not null references erp.bom_versions,
 primary key(item_id,location_id)
);
alter table erp.planning_recipes enable row level security;
create function erp.component_plan(p_item uuid,p_location uuid,p_qty numeric)
returns table(item_id uuid,required numeric,available numeric,shortage numeric) language plpgsql stable set search_path='' as $$
begin
 if p_qty is null or p_qty<=0 then raise exception 'Positive planned quantity required'; end if;
 if not exists(select from erp.planning_recipes where planning_recipes.item_id=p_item and location_id=p_location) then raise exception 'Select a planning recipe for this item and location'; end if;
 if exists(with recursive tree(id,path,cycle) as (
   select p_item,array[p_item],false
   union all select c.item_id,t.path||c.item_id,c.item_id=any(t.path) from tree t join erp.planning_recipes r on r.item_id=t.id and r.location_id=p_location
    join erp.bom_components c on c.version_id=r.version_id where not t.cycle
 )select from tree where cycle) then raise exception 'Cyclic planning recipes';end if;
 -- Process all parents before their shared child so on-hand components are netted only once.
 return query with recursive paths(id,path) as (
  select p_item,array[p_item] union all
  select c.item_id,t.path||c.item_id from paths t join erp.planning_recipes r on r.item_id=t.id and r.location_id=p_location
   join erp.bom_components c on c.version_id=r.version_id
 ), ranked as (
  select t.id,max(cardinality(t.path)) depth from paths t group by t.id
 ), ordered as (
  select r.id,row_number() over(order by depth,id) seq,coalesce((select sum(s.available) from erp.suggest_lots(r.id,p_location,1e30) s),0) avail
  from ranked r
 ), computation(seq,needs,results) as (
  select 0::bigint,jsonb_build_object(p_item::text,p_qty),'[]'::jsonb
  union all
  select o.seq,c.needs||coalesce(e.children,'{}'::jsonb),
   c.results||jsonb_build_array(jsonb_build_object('id',o.id,'qty',n.qty,'avail',o.avail,'short',greatest(n.qty-o.avail,0)))
  from computation c join ordered o on o.seq=c.seq+1 cross join lateral(select coalesce((c.needs->>o.id::text)::numeric,0) qty) n
  cross join lateral(
   select jsonb_object_agg(x.id::text,coalesce((c.needs->>x.id::text)::numeric,0)+x.new_qty) children from (
    select b.item_id id,sum(b.quantity*greatest(n.qty-o.avail,0)/v.output_quantity) new_qty
    from erp.planning_recipes r join erp.bom_versions v on v.id=r.version_id and v.status='approved' join erp.bom_components b on b.version_id=v.id
    where r.item_id=o.id and r.location_id=p_location group by b.item_id
   ) x
  ) e
 )
 select k.id,k.qty,k.avail,k.short from (select c.results from computation c order by c.seq desc limit 1) done
 cross join lateral jsonb_to_recordset(done.results) k(id uuid,qty numeric,avail numeric,short numeric);
end $$;
revoke all on function erp.linked_work_order(jsonb),erp.component_plan(uuid,uuid,numeric) from public,anon,authenticated;
commit;
