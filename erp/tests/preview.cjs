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
    async function openTask(title) {
      await page.getByRole("searchbox").fill(title);
      await page.getByRole("button",{name:title,exact:true}).click();
    }
    await openTask("ملفات الموردين");
    await page.getByRole("button",{name:"إضافة مورد",exact:true}).click();
    await page.locator("input[name=name]").fill("مورد أسعار الاختبار");
    await page.locator("form [type=submit]").click();
    await page.getByRole("heading",{name:"مورد أسعار الاختبار",exact:true}).waitFor();
    await page.getByRole("button",{name:"إضافة صنف بسعره"}).click();
    const item=page.locator("form select[name=item]");
    await item.selectOption({index:1});
    for(const price of ["210","270","185.5"]){
      const priceInput=page.locator("form input[name=price]");
      await priceInput.fill(price);
      await page.getByRole("button",{name:"حفظ السعر"}).click();
      const row=page.locator(".supplier-price-row");
      await row.getByText(new Intl.NumberFormat("ar-EG").format(Number(price)),{exact:false}).waitFor();
      assert.equal(await row.count(),1);
      if(price!=="185.5")await row.getByRole("button").click();
    }
    await page.locator("#actor").selectOption("2");
    await page.getByRole("searchbox").fill("ملفات الموردين");
    assert.equal(await page.getByRole("button",{name:"ملفات الموردين",exact:true}).count(),0);
    await page.locator("#actor").selectOption("1");
    await openTask("رصيد المخزون");
    await page.getByText("GREEN-01",{exact:true}).waitFor();
    await page.locator("#actor").selectOption("2");
    await openTask("مراجعة اعتماد");
    const form = page.locator("form");
    await form.locator("[name=order]").selectOption({label:"PO-DEMO-01"});
    await form.locator("[name=decision]").selectOption("approved");
    await form.locator("[type=submit]").click();
    await form.waitFor({state:"detached"});
    await page.locator("#actor").selectOption("1");
    await openTask("استلام تشغيلة");
    assert.match(await page.locator("select[name=line]").textContent(),/PO-DEMO-01/);
    assert.deepEqual(outbound,[]);
    console.log("Offline mobile-viewport preview and two-account approval passed");
  } finally {await browser.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
