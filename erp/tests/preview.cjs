const assert = require("node:assert/strict");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {chromium} = require("playwright-core");

async function main() {
  const [file, executable] = process.argv.slice(2);
  assert.ok(file && executable,"Pass the offline HTML and Chromium executable paths");
  const browser = await chromium.launch({executablePath:executable,args:["--no-sandbox","--disable-dev-shm-usage"]});
  try {
    const page = await browser.newPage({offline:true,viewport:{width:393,height:873}});
    const outbound = [];
    page.on("request", request => {if(/^https?:/.test(request.url()))outbound.push(request.url());});
    await page.goto(pathToFileURL(path.resolve(file)).href);
    await page.waitForFunction(()=>!document.getElementById("actor").disabled || document.getElementById("state").textContent.includes("تعذّر"),null,{timeout:60000});
    assert.equal(await page.locator("#actor").isDisabled(),false,await page.locator("#state").innerText());
    await page.getByRole("button",{name:"رصيد المخزون"}).click();
    await page.getByText("GREEN-01",{exact:true}).waitFor();
    await page.locator("#actor").selectOption("2");
    await page.locator("summary",{hasText:"المشتريات"}).click();
    await page.getByRole("button",{name:"مراجعة اعتماد"}).click();
    const form = page.locator("form");
    await form.locator("[name=order]").selectOption({label:"PO-DEMO-01"});
    await form.locator("[name=decision]").selectOption("approved");
    await form.locator("[type=submit]").click();
    await form.waitFor({state:"detached"});
    await page.locator("#actor").selectOption("1");
    await page.locator("summary",{hasText:"المشتريات"}).click();
    await page.getByRole("button",{name:"استلام تشغيلة"}).click();
    assert.match(await page.locator("select[name=line]").textContent(),/PO-DEMO-01/);
    assert.deepEqual(outbound,[]);
    console.log("Offline mobile-viewport preview and two-account approval passed");
  } finally {await browser.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
