-- Initial empty warehouses and posting accounts. No opening quantities, financial amounts or WooCommerce entries.
insert into erp.locations(code,name,kind) values
 ('RAW','مخزن الخامات','storage'),('PACK','مخزن مواد التعبئة','storage'),
 ('WIP','مخزن تحت التشغيل','storage'),('FINISHED','مخزن الإنتاج التام','storage'),
 ('DIRECT','مخزن البيع المباشر','channel'),('QC','مخزن الحجر والمرتجعات','quarantine');
insert into erp.accounts(code,name,kind) values
 ('raw_inventory','مخزون الخامات','asset'),('pack_inventory','مخزون مواد التعبئة','asset'),
 ('wip_inventory','مخزون تحت التشغيل','asset'),('finished_inventory','مخزون الإنتاج التام','asset'),
 ('opening_equity','مقابل الأرصدة الافتتاحية','equity'),('goods_received_unbilled','استلامات بانتظار الفاتورة','liability'),
 ('freight_clearing','تسوية نقل المشتريات','liability'),('payables','ذمم الموردين','liability'),
 ('cogs','تكلفة المبيعات','expense'),('receivables','ذمم العملاء','asset'),('sales','إيراد المبيعات','revenue'),
 ('direct_absorption','مقابل تحميل التكاليف المباشرة','expense'),('overhead_absorption','مقابل تحميل التكاليف غير المباشرة','expense'),
 ('abnormal_loss','فاقد غير طبيعي','expense'),('payroll_payable','رواتب مستحقة','liability'),
 ('commission_expense','مصروف العمولات','expense'),('commission_payable','عمولات مستحقة','liability'),
 ('maintenance_expense','مصروف الصيانة','expense'),('maintenance_clearing','تسوية تكاليف الصيانة','liability');
insert into erp.posting_accounts(purpose,account_id)
 select code,id from erp.accounts where code not in ('raw_inventory','pack_inventory','wip_inventory','finished_inventory');
