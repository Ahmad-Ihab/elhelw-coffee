import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

// Keep Capacitor's registered plugin proxy intact. Spreading it drops its
// dynamically provided methods such as writeFile().
window.APP_FILESYSTEM = Filesystem;
window.APP_FILESYSTEM_DIRECTORY = Directory;
window.APP_SHARE = Share;
window.APP_PDF_READY = Promise.resolve(true);
