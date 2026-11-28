package __PACKAGE__;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private static final String RELEASES = "https://github.com/Ahmad-Ihab/elhelw-coffee/releases/download/";
    private static final Pattern TAG = Pattern.compile("erp-v([0-9]+\\.[0-9]+\\.[0-9]+)-[0-9]+");

    private SharedPreferences prefs() { return getContext().getSharedPreferences("official_updates", Context.MODE_PRIVATE); }
    private DownloadManager manager() { return (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE); }
    private PackageInfo installed() throws Exception {
        return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
    }
    private long code(PackageInfo p) { return Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode; }

    @PluginMethod
    public void getAppInfo(PluginCall call) {
        try {
            PackageInfo p = installed();
            JSObject out = new JSObject();
            out.put("versionName", p.versionName);
            out.put("versionCode", code(p));
            call.resolve(out);
        } catch (Exception e) { call.reject("تعذّر قراءة إصدار التطبيق.", e); }
    }

    private int status(long id) {
        if (id < 0) return DownloadManager.STATUS_FAILED;
        try (Cursor c = manager().query(new DownloadManager.Query().setFilterById(id))) {
            if (c != null && c.moveToFirst()) return c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
        }
        return DownloadManager.STATUS_FAILED;
    }

    @PluginMethod
    public void downloadUpdate(PluginCall call) {
        String tag = call.getString("tag", "");
        String digest = call.getString("sha256", "");
        int next = call.getInt("versionCode", 0);
        Matcher match = TAG.matcher(tag);
        try {
            if (!match.matches() || !digest.matches("[a-f0-9]{64}") || next <= code(installed())) {
                call.reject("بيانات إصدار التحديث غير صالحة."); return;
            }
            SharedPreferences p = prefs();
            if (tag.equals(p.getString("tag", "")) && digest.equals(p.getString("sha", "")) &&
                status(p.getLong("id", -1)) != DownloadManager.STATUS_FAILED) { call.resolve(); return; }
            String name = "Elhelw-Distribution-" + match.group(1) + "-" + System.currentTimeMillis() + ".apk";
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(RELEASES + tag + "/app-release.apk"));
            request.setTitle(name);
            request.setDescription("تحديث Elhelw Distribution");
            request.setMimeType("application/vnd.android.package-archive");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            long id = manager().enqueue(request);
            p.edit().putLong("id", id).putString("tag", tag).putString("sha", digest)
                .putString("name", name).putInt("code", next).apply();
            call.resolve();
        } catch (Exception e) { call.reject("تعذّر بدء تنزيل التحديث.", e); }
    }

    @PluginMethod
    public void getDownloadState(PluginCall call) {
        try {
            SharedPreferences p = prefs();
            JSObject out = new JSObject();
            long id = p.getLong("id", -1);
            String state = "none";
            if (id >= 0 && p.getInt("code", 0) > code(installed())) {
                int download = status(id);
                if (download == DownloadManager.STATUS_SUCCESSFUL) {
                    MessageDigest hash = MessageDigest.getInstance("SHA-256");
                    try (InputStream in = new ParcelFileDescriptor.AutoCloseInputStream(manager().openDownloadedFile(id))) {
                        byte[] buffer = new byte[65536];
                        int length;
                        while ((length = in.read(buffer)) != -1) hash.update(buffer, 0, length);
                    } catch (java.io.FileNotFoundException e) {
                        p.edit().clear().apply(); out.put("state", "failed"); call.resolve(out); return;
                    }
                    StringBuilder hex = new StringBuilder();
                    for (byte b : hash.digest()) hex.append(String.format(java.util.Locale.ROOT, "%02x", b & 0xff));
                    state = hex.toString().equals(p.getString("sha", "")) ? "ready" : "failed";
                    if (state.equals("failed")) { manager().remove(id); p.edit().clear().apply(); }
                } else state = download == DownloadManager.STATUS_FAILED ? "failed" : "pending";
                out.put("name", p.getString("name", ""));
                out.put("versionCode",p.getInt("code", 0));
            }
            out.put("state", state);
            call.resolve(out);
        } catch (Exception e) { call.reject("تعذّر التحقق من تنزيل التحديث.", e); }
    }

    @PluginMethod
    public void openDownloads(PluginCall call) {
        try {
            getActivity().startActivity(new Intent(DownloadManager.ACTION_VIEW_DOWNLOADS));
            call.resolve();
        } catch (Exception e) { call.reject("افتح التنزيلات من تطبيق الملفات على موبايلك.", e); }
    }
}
