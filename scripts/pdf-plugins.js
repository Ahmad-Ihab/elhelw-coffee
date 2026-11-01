import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

// Bundle these Capacitor plugins into the local WebView assets. This avoids
// runtime CDN fetches and unresolved bare module specifiers in Android WebView.
window.APP_FILESYSTEM = Filesystem;
window.APP_FILESYSTEM.Directory = Directory;
window.APP_SHARE = Share;
window.APP_PDF_READY = Promise.resolve(true);
