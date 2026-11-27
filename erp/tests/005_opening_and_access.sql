begin;
do $$
declare actor uuid:=gen_random_uuid(); r uuid; item uuid; a uuid; eq uuid; run uuid; data jsonb; review jsonb;
begin
 insert into auth.users values(actor);
 insert into erp.roles(code,name) values('OPS','Operations') returning id into r;
 insert into erp.role_permissions values(r,'migration.stage'),(r,'inventory.read');
 insert into erp.user_roles values(actor,r);
 perform set_config('request.jwt.claim.sub',actor::text,true);
 if not erp.has_permission('inventory.read') then raise exception 'Missing role permission'; end if;
 insert into erp.user_permissions values(actor,'inventory.read',false);
 if erp.has_permission('inventory.read') then raise exception 'Explicit deny lost'; end if;
 insert into erp.accounts(code,name,kind) values('RAW','Raw','asset') returning id into a;
 insert into erp.accounts(code,name,kind) values('EQ','Opening','equity') returning id into eq;
 insert into erp.posting_accounts values('opening_equity',eq);
 insert into erp.fiscal_periods(starts_on,ends_on) values(current_date,current_date);
 insert into erp.items(sku,name,kind,base_unit,inventory_account_id) values('B','Beans','RM','KG',a) returning id into item;
 insert into erp.locations(code,name,kind) values('W','Warehouse','storage');
 data:=jsonb_build_object('reference','COUNT','as_of',current_date,'expected_lines',1,'expected_value',125,'expected_quantities','{"KG":2.5}'::jsonb,
   'rows','[{"source_table":"warehouse","source_key":"B-old","lot_code":"L1","location_code":"W","base_unit":"KG","quantity":2.5,"total_value":125}]'::jsonb);
 run:=erp.stage_opening(data);
 review:=erp.opening_review(run);
 if review#>>'{problems,0,reason}' is distinct from 'unmapped_item' or (review->>'matches')::boolean then raise exception 'Unmapped opening count accepted'; end if;
 begin perform erp.post_opening(run); raise exception 'Unexpected opening success';
 exception when others then if sqlerrm<>'Opening counts do not reconcile' then raise; end if; end;
 if exists(select from erp.stock_documents) then raise exception 'Unmatched opening mutated stock'; end if;
 insert into erp.legacy_item_map values('warehouse','B-old',item),('warehouse','B-en',item);
 insert into erp.opening_rows values(run,'warehouse','B-en','L1','W','KG',2.5,125,null);
 if not (erp.opening_review(run)->'problems' @> '[{"reason":"duplicate_mapped_count"}]') then raise exception 'Bilingual duplicate count accepted'; end if;
 delete from erp.opening_rows where run_id=run and source_key='B-en';
 if not (erp.opening_review(run)->>'matches')::boolean then raise exception 'Opening review mismatch'; end if;
 perform erp.post_opening(run); perform erp.post_opening(run);
 if (select count(*) from erp.stock_documents)<>1 or exists(select from erp.inventory_reconciliation where not reconciled)
   or (select total_value from erp.item_valuation where item_id=item)<>125 then raise exception 'Opening posted twice or did not reconcile'; end if;
end $$;
rollback;
