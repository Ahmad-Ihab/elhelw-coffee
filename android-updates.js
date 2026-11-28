(() => {
  "use strict";
  const feed = "https://api.github.com/repos/Ahmad-Ihab/elhelw-coffee/releases/tags/erp-android-current";
  const checkButton = document.getElementById("check-app-update");
  const panel = document.getElementById("app-update");
  const message = document.getElementById("update-message");
  const action = document.getElementById("update-action");
  let plugin, busy = false, timer, lastCheck = 0, pending = false;

  function show(text, label, click) {
    panel.hidden = false;
    message.textContent = text;
    action.textContent = label || "";
    action.hidden = !label;
    action.onclick = click || null;
  }

  async function download(release) {
    if (busy) return;
    busy = true;
    show("بيبدأ تنزيل التحديث…");
    try {
      await plugin.downloadUpdate(release);
      await showDownload();
    } catch (error) {
      show(error.message || "تعذّر التنزيل.", "إعادة المحاولة", () => check(true));
    } finally { busy = false; }
  }

  async function showDownload() {
    clearTimeout(timer);
    const result = await plugin.getDownloadState();
    pending = result.state === "pending";
    if (pending) {
      show("تحديث التطبيق بيتنزّل. تقدر تكمل شغلك.");
      timer = setTimeout(() => { if (!document.hidden) check(false); }, 3000);
    } else if (result.state === "ready") {
      show("التحديث جاهز. افتح ملف " + result.name + " واضغط «تحديث».", "فتح التنزيلات للتثبيت", async () => {
        try { await plugin.openDownloads(); }
        catch (error) { show(error.message || "افتح الملف من التنزيلات."); }
      });
    }
    return result.state;
  }

  async function check(manual = false) {
    if (!plugin || busy) return;
    busy = true;
    try {
      const state = await showDownload();
      if (state === "ready" || state === "pending") return;
      if (!manual && state === "failed") {
        show("التنزيل ما اكتملش.", "إعادة المحاولة", () => check(true)); return;
      }
      if (!manual && Date.now() - lastCheck < 30 * 60 * 1000) return;
      if (manual) show("بنراجع آخر إصدار…");
      const current = await plugin.getAppInfo();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      let release;
      try {
        const response = await fetch(feed, {cache:"no-store", signal:controller.signal});
        if (!response.ok) throw Error("تعذّر الوصول لقناة تحديثات التطبيق.");
        const entry = await response.json();
        if (entry.tag_name !== "erp-android-current" || entry.draft) throw Error("بيانات التحديث غير مكتملة.");
        release = JSON.parse(entry.body);
      } finally { clearTimeout(timeout); }
      const match = /^erp-v(\d+\.\d+\.\d+)-\d+$/.exec(release.tag);
      if (!match || match[1] !== release.versionName || !Number.isSafeInteger(release.versionCode) ||
          release.versionCode <= 0 || !/^[a-f0-9]{64}$/.test(release.sha256)) throw Error("بيانات التحديث غير صالحة.");
      lastCheck = Date.now();
      if (release.versionCode > current.versionCode) {
        show("متاح تحديث " + release.versionName + " · الإصدار الحالي " + current.versionName,
          "تنزيل التحديث", () => download(release));
      } else if (manual) show("عندك آخر إصدار · " + current.versionName);
      else panel.hidden = true;
    } catch (error) {
      if (manual || pending) show("تعذّر التحقق من التحديث. راجع الاتصال وحاول تاني.", "إعادة المحاولة", () => check(true));
    } finally { busy = false; }
  }

  async function start() {
    for (let attempt = 0; attempt < 48; attempt++) {
      plugin = window.Capacitor?.Plugins?.AppUpdater;
      if (plugin && typeof plugin.getDownloadState === "function") break;
      plugin = null;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!plugin) return;
    checkButton.hidden = false;
    checkButton.onclick = () => check(true);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) check(false); });
    window.addEventListener("online", () => check(false));
    check(false);
  }
  start();
})();
