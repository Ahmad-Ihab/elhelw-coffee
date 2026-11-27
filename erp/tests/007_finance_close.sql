begin;
do $$
declare actor uuid:=gen_random_uuid(); cash uuid; exp uuid; variance uuid; fiscal uuid; cost uuid; j uuid; period2 uuid; id2 uuid; p jsonb;
begin
 insert into auth.users values(actor); insert into erp.user_permissions select actor,code,true from erp.permissions;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 insert into erp.accounts(code,name,kind) values('C','Cash','asset') returning id into cash;
 insert into erp.accounts(code,name,kind) values('O','Overhead','expense') returning id into exp;
 insert into erp.accounts(code,name,kind) values('V','Variance','expense') returning id into variance;
 insert into erp.posting_accounts values('overhead_absorption',exp),('abnormal_loss',variance);
 insert into erp.fiscal_periods(starts_on,ends_on) values(current_date,current_date+29) returning id into fiscal;
 insert into erp.fiscal_periods(starts_on,ends_on) values(current_date+30,current_date+59) returning id into period2;
 j:=(erp.finance_action('journal',jsonb_build_object('date',current_date,'reason','Entry','lines',jsonb_build_array(jsonb_build_object('account',cash,'debit',50),jsonb_build_object('account',exp,'credit',50))))#>>'{}')::uuid;
 perform erp.finance_action('reverse',jsonb_build_object('entry',j,'date',current_date,'reason','Correction'));
 if (select sum(abs(net)) from erp.trial_balance)<>0 then raise exception 'Reversal did not offset entry';end if;
 cost:=(erp.finance_action('open_cost',jsonb_build_object('period',fiscal,'capacity',100,'initial_rate',2))#>>'{}')::uuid;
 perform erp.finance_action('overhead',jsonb_build_object('cost_period',cost,'date',current_date,'amount',1000,'account',cash,'category','rent','behavior','fixed'));
 begin perform erp.finance_action('close_cost',jsonb_build_object('cost_period',cost,'lines','[]'::jsonb));raise exception 'Unexpected success';
 exception when others then if sqlerrm<>'Cost variance allocations do not reconcile' then raise;end if;end;
 perform erp.finance_action('close_cost',jsonb_build_object('cost_period',cost,'lines','[{"destination":"abnormal_expense","amount":1000}]'::jsonb));
 perform erp.finance_action('close',jsonb_build_object('period',fiscal));
 begin perform erp.post_pair(current_date,'test',gen_random_uuid(),'Closed',cash,exp,1);raise exception 'Unexpected posting';
 exception when others then if sqlerrm<>'Open fiscal period required' then raise;end if;end;
 id2:=(erp.finance_action('open_cost',jsonb_build_object('period',period2,'capacity',100))#>>'{}')::uuid;
 if (select applied_rate_per_kg from erp.cost_periods where id=id2) is distinct from 10::numeric then raise exception 'Prior rate mismatch';end if;
end $$;
rollback;
