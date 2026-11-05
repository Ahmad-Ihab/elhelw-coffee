import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { registerPlugin } from "@capacitor/core";

// Keep Capacitor's registered plugin proxy intact. Spreading it drops its
// dynamically provided methods such as writeFile().
window.APP_FILESYSTEM = Filesystem;
window.APP_FILESYSTEM_DIRECTORY = Directory;
window.APP_SHARE = Share;
// Explicitly register the custom native PDF bridge for Capacitor 7.
window.APP_INVOICE_PDF = registerPlugin("InvoicePdf");
window.APP_PDF_READY = Promise.resolve(true);
