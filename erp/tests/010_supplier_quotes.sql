begin;
do $$
declare staff uuid:=gen_random_uuid(); vendor uuid; item uuid; po uuid; key0 uuid:=gen_random_uuid(); p jsonb;
begin
 insert into auth.users(id) values(staff);
 perform set_config('request.jwt.claim.sub',staff::text,true);
 if public.elhelw_erp_workspace()->'choices' ? 'quotes' then raise exception 'Quotes visible without permission';end if;
 insert into erp.user_permissions values(staff,'setup.configure',true),(staff,'purchases.manage',true);
 insert into erp.suppliers(code,name) values('V','Vendor') returning id into vendor;
 insert into erp.items(sku,name,kind,base_unit) values('M','Beans','RM','KG') returning id into item;
 p:=jsonb_build_object('supplier',vendor,'item',item,'price',240);
 perform public.elhelw_erp_command('supplier_quote',p,gen_random_uuid());
 if (public.elhelw_erp_workspace()#>>'{choices,quotes,0,price}')::numeric<>240 then raise exception 'Missing price';end if;
 p:=jsonb_build_object('supplier',vendor,'code','PO-1','lines',jsonb_build_array(jsonb_build_object('item',item,'price',240,'qty',2)));
 po:=(public.elhelw_erp_command('purchase_quoted',p,key0)#>>'{}')::uuid;
 perform public.elhelw_erp_command('supplier_quote',jsonb_build_object('supplier',vendor,'item',item,'price',250),gen_random_uuid());
 if public.elhelw_erp_command('purchase_quoted',p,key0)<>to_jsonb(po) or (select unit_price from erp.purchase_order_lines where order_id=po)<>240 then raise exception 'Changed order snapshot'; end if;
 begin perform public.elhelw_erp_command('purchase_quoted',p||'{"code":"PO-2"}',gen_random_uuid());
 raise exception 'Unexpected stale quote acceptance'; exception when others then if position('سعر المورد' in sqlerrm)=0 then raise; end if; end;
end $$;
rollback;
