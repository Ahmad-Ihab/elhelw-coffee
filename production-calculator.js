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
        } else if (message.type === "elhelw-pc-refresh") {
          const { data, error } = await supabase.from("production_calculations")
            .select("id,label,inputs,result,created_at")
            .order("created_at", { ascending: false }).limit(100);
          if (error) throw error;
          send({ type: "elhelw-pc-history", rows: data || [] });
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
    frame.src = "./production-calculator/index.html";
  }
  window.renderElhelwProductionCalculator = render;
})();