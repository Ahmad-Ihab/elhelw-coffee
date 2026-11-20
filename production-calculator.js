(() => {
  function render(userId, supabase) {
    const host = document.getElementById("production-calculator");
    if (!host) return;
    if (host.__elhelwPcHandler) window.removeEventListener("message", host.__elhelwPcHandler);
    host.innerHTML = "";
    const frame = document.createElement("iframe");
    frame.title = "حاسبة إنتاج بن الحلو";
    frame.style.cssText = "display:block;width:100%;height:1100px;border:0;border-radius:14px;background:#f7f1e8";
    frame.setAttribute("loading", "eager");
    frame.setAttribute("title", "حاسبة إنتاج بن الحلو");
    host.appendChild(frame);
    host.__elhelwPcHandler = async event => {
      if (event.source !== frame.contentWindow) return;
      const message = event.data || {};
      const send = data => frame.contentWindow.postMessage(data, "*");
      try {
        if (message.type === "elhelw-pc-resize") {
          frame.style.height = Math.max(850, Math.min(7000, Number(message.height) || 1100)) + "px";
        } else if (message.type === "elhelw-pc-catalog") {
          const [recipes, recipeItems, materials, prices, suppliers, stock] = await Promise.all([
            supabase.from("production_recipes").select("id,name,roast_loss_percent").eq("active",true).order("sort_order"),
            supabase.from("production_recipe_items").select("id,recipe_id,raw_material_id,output_kg_per_kg,apply_roast_loss"),
            supabase.from("raw_materials").select("id,name,unit").eq("active",true),
            supabase.from("supplier_material_prices").select("supplier_id,raw_material_id,unit_price"),
            supabase.from("suppliers").select("id,name").eq("active",true),
            supabase.from("raw_material_stock_balances").select("raw_material_id,quantity_kg")
          ]);
          for (const result of [recipes,recipeItems,materials,prices,suppliers]) if(result.error) throw result.error;
          send({type:"elhelw-pc-catalog-data",recipes:recipes.data||[],recipeItems:recipeItems.data||[],materials:materials.data||[],prices:prices.data||[],suppliers:suppliers.data||[],stock:stock.data||[]});
        } else if (message.type === "elhelw-pc-create-purchase") {
          const groups = new Map();
          for (const line of (message.items||[])) {
            if (!line.supplier_id || !(Number(line.quantity_kg)>0)) continue;
            if (!groups.has(line.supplier_id)) groups.set(line.supplier_id,[]);
            groups.get(line.supplier_id).push(line);
          }
          const created=[];
          for (const [supplierId, lines] of groups) {
            const {data:order,error}=await supabase.from("supplier_purchase_orders").insert({
              supplier_id:supplierId,status:"ordered",notes:"تم إنشاؤها من حاسبة الإنتاج"
            }).select("id,order_number").single();
            if(error) throw error;
            const {error:itemsError}=await supabase.from("supplier_purchase_order_items").insert(lines.map(line=>({
              purchase_order_id:order.id,raw_material_id:line.raw_material_id,
              ordered_quantity_kg:line.quantity_kg,unit_price:line.unit_price
            })));
            if(itemsError) throw itemsError;
            created.push({order_number:order.order_number,supplier_id:supplierId});
          }
          send({type:"elhelw-pc-purchase-created",orders:created});
        } else if (message.type === "elhelw-pc-refresh") {
          const { data, error } = await supabase.from("production_calculations")
            .select("id,label,inputs,result,created_at")
            .order("created_at", { ascending: false }).limit(100);
          if (error) throw error;
          send({ type: "elhelw-pc-history", rows: data || [] });
        } else if (message.type === "elhelw-pc-print") {
          const nativePdf = window.APP_INVOICE_PDF || window.Capacitor?.Plugins?.InvoicePdf;
          if (!nativePdf?.print) throw new Error("مكوّن الطباعة الأصلي غير متاح. حدّث التطبيق إلى أحدث إصدار.");
          await nativePdf.print({ html: String(message.html || ""), filename: String(message.filename || "ELHELW-PRODUCTION.pdf") });
          send({ type: "elhelw-pc-printed" });
        } else if (message.type === "elhelw-pc-save") {
          const { error } = await supabase.from("production_calculations").insert({
            created_by: userId,
            label: String(message.label || "طلبية محفوظة").slice(0, 100),
            inputs: message.inputs,
            result: message.result
          });
          if (error) throw error;
          send({ type: "elhelw-pc-saved" });
        } else if (message.type === "elhelw-pc-delete") {
          const { error } = await supabase.from("production_calculations").delete().eq("id", message.id);
          if (error) throw error;
          send({ type: "elhelw-pc-deleted" });
        }
      } catch (error) {
        send({ type: "elhelw-pc-error", message: error?.message || "حدث خطأ غير متوقع" });
      }
    };
    window.addEventListener("message", host.__elhelwPcHandler);
    frame.onload = () => frame.contentWindow.postMessage({type:"elhelw-pc-catalog"}, "*");
    frame.src = "./production-calculator/index.html";
  }
  window.renderElhelwProductionCalculator = render;
})();