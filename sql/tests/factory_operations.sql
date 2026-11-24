do $$
declare a uuid:=gen_random_uuid(); d uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); v uuid; b uuid:=gen_random_uuid(); k uuid:=gen_random_uuid(); failed boolean;
begin
 insert into public.profiles(id,full_name,role) values(a,'Test admin','admin'),(d,'Test distributor','distributor');
 perform set_config('request.jwt.claim.sub',a::text,true);
 insert into public.raw_materials(id,name,factory_kind) values(m,'Test beans','green_coffee');
 insert into public.raw_material_stock_balances(raw_material_id,quantity_kg) values(m,10);
 insert into public.production_recipes(id,name) values(r,'Test blend');
 insert into public.products(id,name) values(p,'Test product');
 perform public.record_roasting_batch(gen_random_uuid(),m,'medium',10,8,100,0,null);
 v:=public.save_factory_blend_version(r,jsonb_build_array(jsonb_build_object('material_id',m,'kind','roasted','roast_degree','medium','ratio',1)));
 perform public.set_factory_product_mapping(v,p,1);
 update public.packaging_items set quantity=100,average_cost=1;
 perform public.record_factory_direct_pack(b,k,v,1,'{"50":10,"100":5}'::jsonb);
 perform public.record_factory_direct_pack(b,k,v,1,'{"50":10,"100":5}'::jsonb);
 if (select quantity from public.company_stock_balances where product_id=p)<>1 then raise exception 'Finished stock mismatch'; end if;
 if (select quantity from public.packaging_items where sku='LABEL-1-100')<>85 then raise exception 'Shared label mismatch'; end if;
 if (select quantity_kg from public.roasted_stock where raw_material_id=m)<>7 then raise exception 'Roasted stock mismatch'; end if;
 failed:=false;
 begin perform public.record_factory_direct_pack(gen_random_uuid(),gen_random_uuid(),v,8,'{"100":80}'::jsonb); exception when others then failed:=true; end;
 if not failed then raise exception 'Oversell accepted'; end if;
 perform set_config('request.jwt.claim.sub',d::text,true);
 failed:=false;
 begin perform public.record_factory_packing(gen_random_uuid(),v,'{"100":1}'::jsonb); exception when others then failed:=true; end;
 if not failed then raise exception 'Distributor allowed'; end if;
end $$;