-- Create a cafe and optionally record the samples it received in one transaction.
create or replace function public.create_cafe_with_optional_sample(
 p_cafe jsonb,
 p_product_id uuid default null,
 p_bags jsonb default null,
 p_feedback text default null
) returns uuid
language plpgsql security definer set search_path='pg_catalog','public' as $$
declare
 v_distributor uuid;
 v_cafe_id uuid;
 v_kg numeric;
 v_cost numeric;
 v_stock jsonb;
 v_remaining jsonb;
 v_sample_id uuid;
begin
 if public.is_admin() then
   v_distributor:=nullif(p_cafe->>'distributor_id','')::uuid;
   if v_distributor is null or not exists(select 1 from public.distributors where id=v_distributor and active=true) then
     raise exception 'Select a valid active distributor';
   end if;
 else
   v_distributor:=public.current_distributor_id();
   if v_distributor is null then raise exception 'Distributor account required'; end if;
 end if;
 if coalesce(trim(p_cafe->>'name'),'')='' then raise exception 'Cafe name is required'; end if;

 insert into public.cafes(distributor_id,name,contact_name,phone,address,notes,latitude,longitude)
 values(
   v_distributor,trim(p_cafe->>'name'),
   nullif(trim(p_cafe->>'contact_name'),''),nullif(trim(p_cafe->>'phone'),''),
   nullif(trim(p_cafe->>'address'),''),nullif(trim(p_cafe->>'notes'),''),
   nullif(p_cafe->>'latitude','')::double precision,nullif(p_cafe->>'longitude','')::double precision
 ) returning id into v_cafe_id;

 if p_product_id is not null then
   v_kg:=public.bags_to_kg(p_bags);
   select cost_per_unit into v_cost from public.products where id=p_product_id and active=true;
   if not found then raise exception 'Invalid active product'; end if;
   select bag_counts into v_stock from public.sample_stock_balances
    where distributor_id=v_distributor and product_id=p_product_id for update;
   if v_stock is null then raise exception 'No sample stock available for this distributor'; end if;
   v_remaining:=public.bags_subtract(v_stock,p_bags);
   update public.sample_stock_balances set quantity=quantity-v_kg,bag_counts=v_remaining,updated_at=now()
    where distributor_id=v_distributor and product_id=p_product_id;

   insert into public.samples(distributor_id,cafe_id,sample_date,feedback,marketing_cost,created_by)
    values(v_distributor,v_cafe_id,current_date,p_feedback,v_kg*coalesce(v_cost,0),auth.uid()) returning id into v_sample_id;
   insert into public.sample_items(sample_id,product_id,quantity,unit_cost,total_cost,bag_counts)
    values(v_sample_id,p_product_id,v_kg,coalesce(v_cost,0),v_kg*coalesce(v_cost,0),p_bags);
   insert into public.sample_stock_movements(distributor_id,product_id,movement_type,quantity,bag_counts,reference_id,notes,created_by)
    values(v_distributor,p_product_id,'distributed_to_cafe',v_kg,p_bags,v_sample_id,p_feedback,auth.uid());
   insert into public.distributor_expenses(distributor_id,expense_type,amount,reference_id,notes)
    values(v_distributor,'sample',v_kg*coalesce(v_cost,0),v_sample_id,'Coffee samples at cafe creation'||case when p_feedback is null then '' else ': '||p_feedback end);
 end if;
 return v_cafe_id;
end; $$;
revoke all on function public.create_cafe_with_optional_sample(jsonb,uuid,jsonb,text) from public,anon;
grant execute on function public.create_cafe_with_optional_sample(jsonb,uuid,jsonb,text) to authenticated;
