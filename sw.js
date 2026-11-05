const CACHE="elhelw-coffee-v20";
const CORE=["./","./index.html","./styles.css","./app.js","./production-calculator.css","./production-calculator.js","./production-calculator/index.html","./config.js","./manifest.webmanifest","./assets/pwa-icon.svg","./assets/icon-192.png","./assets/brand-logo.svg"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE))));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener("fetch",e=>{
  const u=new URL(e.request.url);
  if(u.origin===location.origin && e.request.method==="GET"){
    e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request).then(r=>{
      const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r;
    }).catch(()=>caches.match("./index.html"))));
  }
});