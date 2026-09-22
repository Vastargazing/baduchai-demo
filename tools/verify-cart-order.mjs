/** Воспроизводит сообщённый сценарий на опубликованной версии. */
import { chromium } from 'playwright'
const SITE = 'https://vastargazing.github.io/baduchai-demo/'
const b = await chromium.launch()
const p = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage()
await p.goto(SITE, { waitUntil: 'networkidle', timeout: 90000 })
await p.locator('[data-testid="product-card"]').first().waitFor()

await p.locator('[data-testid="open-paste"]').click()
await p.locator('[data-testid="paste-input"]').fill('SHU-29 — 9\nSHU-47 — 9')
await p.waitForTimeout(500)
await p.locator('[data-testid="apply-replace"]').click()
await p.waitForTimeout(250)
await p.locator('.modal-foot .btn').click()

const state = async () =>
  p.locator('[data-testid="cart-lines"] .cart-line').evaluateAll((els) =>
    els.map((e) => ({
      sku: e.getAttribute('data-sku'),
      name: e.querySelector('.cart-line-name')?.textContent,
      qty: e.querySelector('.stepper input')?.value,
    })),
  )

console.log('до:  ', JSON.stringify(await state()))
for (let i = 0; i < 10; i++) {
  await p.locator('[data-testid="cart-lines"] .cart-line').first().locator('.stepper button').nth(1).click()
  await p.waitForTimeout(40)
}
console.log('после:', JSON.stringify(await state()))
console.log('упаковок:', await p.locator('[data-testid="t-packages"]').first().innerText())
await b.close()
