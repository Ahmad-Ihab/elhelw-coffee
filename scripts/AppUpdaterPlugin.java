package __PACKAGE__;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

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
  public void openUpdate(PluginCall call) {
    String url = call.getString("url");
    if (url == null || !url.matches("https://github\\.com/Ahmad-Ihab/elhelw-coffee/releases/download/v[0-9]+\\.[0-9]+\\.[0-9]+/app-release\\.apk")) {
      call.reject("Invalid official update URL."); return;
    }
    try {
      Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
      intent.addCategory(Intent.CATEGORY_BROWSABLE);
      getActivity().startActivity(intent);
      call.resolve();
    } catch (Exception e) { call.reject("Unable to open update in browser.", e); }
  }
}
