const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../../android-updates.js"), "utf8");

function phone(release, state = "none") {
  const nodes = Object.fromEntries(["app-update","check-app-update","update-action","update-message"].map(id=>[id,{hidden:true}]));
  const downloaded = [], viewed = [];
  const plugin = {
    getAppInfo: async () => ({versionCode:58, versionName:"2.3.1"}),
    getDownloadState: async () => ({state, name:"Elhelw.apk"}),
    downloadUpdate: async item => {downloaded.push(item);state="pending";},
    openDownloads: async () => viewed.push(true)
  };
  const fetch = async url => {
    assert.equal(url,"https://api.github.com/repos/Ahmad-Ihab/elhelw-coffee/releases/tags/erp-android-current");
    return {ok:true,json:async()=>({tag_name:"erp-android-current",draft:false,body:JSON.stringify(release)})};
  };
  const document = {getElementById:id=>nodes[id],addEventListener(){}};
  vm.runInNewContext(source,{window:{Capacitor:{Plugins:{AppUpdater:plugin}},addEventListener(){}},
    document,fetch,AbortController,setTimeout:()=>1,clearTimeout(){}});
  return {nodes,downloaded,viewed,changeState:next=>{state=next}};
}
const next = {versionCode:59,versionName:"2.3.2",tag:"erp-v2.3.2-211",sha256:"b".repeat(64)};
const settled=()=>new Promise(resolve=>setImmediate(resolve));

test("ERP update starts only on confirmation, resumes and opens Android downloads",async()=>{
  const p=phone(next);await settled();
  assert.equal(p.downloaded.length,0);
  assert.equal(p.nodes["update-action"].textContent,"تنزيل التحديث");
  await p.nodes["update-action"].onclick();
  assert.equal(p.downloaded[0].sha256,next.sha256);
  assert.match(p.nodes["update-message"].textContent,/بيتنزّل/);
  p.changeState("ready");await p.nodes["check-app-update"].onclick();
  await p.nodes["update-action"].onclick();
  assert.equal(p.viewed.length,1);
});
test("same version and invalid/untrusted release metadata never offer installation",async()=>{
  for(const release of [{...next,versionCode:58},{...next,tag:"other"},{...next,sha256:"bad"}]){
    const p=phone(release);await settled();await p.nodes["check-app-update"].onclick();
    assert.notEqual(p.nodes["update-action"].textContent,"تنزيل التحديث");assert.equal(p.downloaded.length,0);
  }
});
test("a completed or interrupted download survives app restart",async()=>{
  const ready=phone(next,"ready");await settled();assert.equal(ready.nodes["update-action"].textContent,"فتح التنزيلات للتثبيت");
  const retry=phone(next,"failed");await settled();assert.equal(retry.nodes["update-action"].textContent,"إعادة المحاولة");
  await retry.nodes["update-action"].onclick();assert.equal(retry.nodes["update-action"].textContent,"تنزيل التحديث");
});
