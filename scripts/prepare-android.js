const fs = require("node:fs");
const path = require("node:path");

const androidRoot = path.resolve(__dirname, "..", "android", "app", "src", "main", "java");
function findMainActivity(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findMainActivity(full);
      if (found) return found;
    } else if (entry.name === "MainActivity.java") return full;
  }
  return null;
}
const mainPath = findMainActivity(androidRoot);
if (!mainPath) throw new Error("Capacitor MainActivity.java was not generated.");
const main = fs.readFileSync(mainPath, "utf8");
const packageName = (main.match(/^package\s+([\w.]+);/m) || [])[1];
if (!packageName) throw new Error("Could not determine Android package name.");
const plugin = [
"package " + packageName + ";",
"",
"import android.content.Context;",
"import android.os.Handler;",
"import android.os.Looper;",
"import android.print.PrintAttributes;",
"import android.print.PrintJob;",
"import android.print.PrintManager;",
"import android.webkit.WebView;",
"import android.webkit.WebViewClient;",
"import android.view.ViewGroup;",
"import android.widget.FrameLayout;",
"import com.getcapacitor.Plugin;",
"import com.getcapacitor.PluginCall;",
"import com.getcapacitor.PluginMethod;",
"import com.getcapacitor.JSObject;",
"import com.getcapacitor.annotation.CapacitorPlugin;",
"import java.util.ArrayList;",
"import java.util.List;",
"",
"@CapacitorPlugin(name = \"InvoicePdf\")",
"public class InvoicePdfPlugin extends Plugin {",
"  private final List<WebView> activeViews = new ArrayList<>();",
"  private final Handler handler = new Handler(Looper.getMainLooper());",
"",
"  @PluginMethod",
"  public void print(PluginCall call) {",
"    final String html = call.getString(\"html\");",
"    final String filename = call.getString(\"filename\", \"ELHELW-INVOICE.pdf\");",
"    if (html == null || html.trim().isEmpty()) { call.reject(\"Invoice HTML is empty.\"); return; }",
"    getActivity().runOnUiThread(() -> {",
"      try {",
"        WebView webView = new WebView(getContext());",
"        webView.getSettings().setJavaScriptEnabled(true);",
"        webView.getSettings().setDefaultTextEncodingName(\"UTF-8\");",
"        webView.setBackgroundColor(android.graphics.Color.WHITE);",
"        activeViews.add(webView);",
"        getActivity().addContentView(webView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));",
"        webView.setAlpha(0.01f);",
"        webView.setWebViewClient(new WebViewClient() {",
"          @Override public void onPageFinished(WebView view, String url) {",
"            handler.postDelayed(() -> startPrint(call, view, filename), 500);",
"          }",
"        });",
"        webView.loadDataWithBaseURL(\"https://localhost/\", html, \"text/html\", \"UTF-8\", null);",
"      } catch (Exception error) { call.reject(\"Unable to prepare native invoice printing: \" + error.getMessage(), error); }",
"    });",
"  }",
"",
"  private void startPrint(PluginCall call, WebView webView, String filename) {",
"    try {",
"      PrintManager manager = (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);",
"      if (manager == null) throw new IllegalStateException(\"Android print service is unavailable.\");",
"      String jobName = filename.replaceAll(\"\\\\.pdf$\", \"\");",
"      PrintAttributes attrs = new PrintAttributes.Builder()",
"        .setMediaSize(PrintAttributes.MediaSize.ISO_A4)",
"        .setResolution(new PrintAttributes.Resolution(\"elhelw\", \"ELHELW\", 300, 300))",
"        .setMinMargins(PrintAttributes.Margins.NO_MARGINS)",
"        .setColorMode(PrintAttributes.COLOR_MODE_COLOR).build();",
"      PrintJob job = manager.print(jobName, webView.createPrintDocumentAdapter(jobName), attrs);",
"      JSObject result = new JSObject(); result.put(\"opened\", true); result.put(\"jobId\", job.getId().toString());",
"      call.resolve(result);",
"      watchJob(job, webView);",
"    } catch (Exception error) {",
"      activeViews.remove(webView); webView.destroy();",
"      call.reject(\"Android could not open the invoice print dialog: \" + error.getMessage(), error);",
"    }",
"  }",
"",
"  private void watchJob(PrintJob job, WebView webView) {",
"    handler.postDelayed(new Runnable() {",
"      @Override public void run() {",
"        if (job.isCompleted() || job.isCancelled() || job.isFailed()) {",
"          activeViews.remove(webView); webView.post(webView::destroy);",
"        } else { handler.postDelayed(this, 1200); }",
"      }",
"    }, 1200);",
"  }",
"}"
].join("\n");
fs.writeFileSync(path.join(path.dirname(mainPath), "InvoicePdfPlugin.java"), plugin, "utf8");
const replacementMain = [
"package " + packageName + ";",
"",
"import android.os.Bundle;",
"import com.getcapacitor.BridgeActivity;",
"",
"public class MainActivity extends BridgeActivity {",
"  @Override public void onCreate(Bundle savedInstanceState) {",
"    registerPlugin(InvoicePdfPlugin.class);",
"    super.onCreate(savedInstanceState);",
"  }",
"}"
].join("\n");
fs.writeFileSync(mainPath, replacementMain, "utf8");
console.log("Registered native InvoicePdf plugin in " + mainPath);
