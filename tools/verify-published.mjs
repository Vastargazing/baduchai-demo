/** Проверка опубликованной версии: работает ли она и нет ли на ней лишнего. */
import { chromium } from 'playwright'
const SITE = process.argv[2] ?? 'https://vastargazing.github.io/baduchai-demo/'
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } })
const p = await ctx.newPage()
const errs = []
p.on('pageerror', (e) => errs.push(String(e)))
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()))
const t0 = Date.now()
await p.goto(SITE, { waitUntil: 'networkidle' })
const cards = await p.locator('[data-testid="product-card"]').count()
const demo = await p.locator('.demo-bar').innerText()
const robots = await p.locator('meta[name="robots"]').getAttribute('content')

// собираем контрольный заказ прямо на опубликованной версии
await p.locator('[data-testid="open-paste"]').click()
await p.locator('[data-testid="paste-input"]').fill(`1. БА — 2 шт.
2. СЮАНЬ — 1 шт.
3. ХАО ХЭ — 1 шт.
4. ДИСК БИ — 1 шт.
5. ПУЭРИН — 1 шт.`)
await p.waitForTimeout(400)
await p.locator('[data-testid="apply-replace"]').click()
await p.waitForTimeout(200)
await p.locator('.modal-foot .btn').click()
const totals = {
  positions: await p.locator('[data-testid="t-positions"]').first().innerText(),
  packages: await p.locator('[data-testid="t-packages"]').first().innerText(),
  weight: await p.locator('[data-testid="t-weight"]').first().innerText(),
  amount: await p.locator('[data-testid="t-amount"]').first().innerText(),
}
const robotsTxt = await (await p.request.get(new URL('robots.txt', SITE).href)).text()
const storage = await p.evaluate(() => Object.keys(localStorage))

console.log(JSON.stringify({
  url: SITE,
  'загрузка, мс': Date.now() - t0,
  карточек: cards,
  'пометка демо': demo.slice(0, 60),
  'meta robots': robots,
  'robots.txt': robotsTxt.trim().split('\n').slice(-2).join(' / '),
  'контрольный заказ': totals,
  'ключи localStorage': storage,
  'ошибки в консоли': errs,
}, null, 1))
await b.close()
