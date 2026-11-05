package __PACKAGE__;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
  private static final String PREFS = "elhelw_app_updater";
  private static final String DOWNLOAD_ID = "download_id";

  @PluginMethod
  public void getAppInfo(PluginCall call) {
    try {
      android.content.pm.PackageInfo info = getContext().getPackageManager()
        .getPackageInfo(getContext().getPackageName(), 0);
      JSObject result = new JSObject();
      result.put("versionName", info.versionName == null ? "0.0.0" : info.versionName);
      result.put("versionCode", Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode);
      call.resolve(result);
    } catch (Exception e) {
      call.reject("Unable to read installed app version.", e);
    }
  }

  @PluginMethod
  public void downloadUpdate(PluginCall call) {
    String url = call.getString("url");
    String filename = call.getString("filename", "elhelw-distribution-update.apk");
    if (url == null || !url.startsWith("https://")) {
      call.reject("A valid HTTPS update URL is required.");
      return;
    }
    try {
      DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
      if (manager == null) throw new IllegalStateException("Android Download Manager is unavailable.");
      DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
      request.setTitle("تحديث Elhelw Distribution");
      request.setDescription("جارٍ تنزيل إصدار التطبيق الجديد");
      request.setMimeType("application/vnd.android.package-archive");
      request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
      request.setAllowedOverMetered(true);
      request.setAllowedOverRoaming(false);
      request.setDestinationInExternalFilesDir(getContext(), Environment.DIRECTORY_DOWNLOADS, filename);
      long id = manager.enqueue(request);
      getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putLong(DOWNLOAD_ID, id).apply();
      JSObject result = new JSObject();
      result.put("downloadId", id);
      call.resolve(result);
    } catch (Exception e) {
      call.reject("Unable to start update download: " + e.getMessage(), e);
    }
  }

  @PluginMethod
  public void getDownloadStatus(PluginCall call) {
    long id = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(DOWNLOAD_ID, -1);
    if (id < 0) { call.reject("No update download was found."); return; }
    DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
    DownloadManager.Query query = new DownloadManager.Query().setFilterById(id);
    try (Cursor cursor = manager.query(query)) {
      if (cursor == null || !cursor.moveToFirst()) { call.reject("Update download is unavailable."); return; }
      int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
      int reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
      String state = status == DownloadManager.STATUS_SUCCESSFUL ? "success"
        : status == DownloadManager.STATUS_FAILED ? "failed"
        : status == DownloadManager.STATUS_PAUSED ? "paused" : "running";
      JSObject result = new JSObject();
      result.put("status", state);
      result.put("reason", reason);
      result.put("bytesDownloaded", cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)));
      result.put("totalBytes", cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)));
      call.resolve(result);
    } catch (Exception e) {
      call.reject("Unable to read update download status.", e);
    }
  }

  @PluginMethod
  public void installUpdate(PluginCall call) {
    long id = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(DOWNLOAD_ID, -1);
    if (id < 0) { call.reject("No downloaded update was found."); return; }
    try {
      DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
      Uri apkUri = manager.getUriForDownloadedFile(id);
      if (apkUri == null) { call.reject("The update has not finished downloading."); return; }
      if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
        Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
          Uri.parse("package:" + getContext().getPackageName()));
        settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(settings);
        JSObject result = new JSObject();
        result.put("permissionRequired", true);
        call.resolve(result);
        return;
      }
      Intent install = new Intent(Intent.ACTION_VIEW);
      install.setDataAndType(apkUri, "application/vnd.android.package-archive");
      install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
      getContext().startActivity(install);
      JSObject result = new JSObject();
      result.put("permissionRequired", false);
      call.resolve(result);
    } catch (Exception e) {
      call.reject("Unable to open Android package installer: " + e.getMessage(), e);
    }
  }
}
