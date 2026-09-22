/** Проверяет рубрики на опубликованной версии на нескольких ширинах. */
import { chromium } from 'playwright'
const SITE = 'https://vastargazing.github.io/baduchai-demo/'
const b = await chromium.launch()
for (const [w, h] of [[320,640],[390,844],[768,1024],[900,1000],[1440,950]]) {
  const p = await (await b.newContext({ viewport:{width:w,height:h}, isMobile:w<=480 })).newPage()
  await p.goto(SITE, { waitUntil:'networkidle', timeout:90000 })
  await p.locator('[data-testid="product-card"]').first().waitFor()
  await p.waitForTimeout(300)
  const r = await p.evaluate(() => {
    const el = document.querySelector('.chips')
    return {
      перенос: getComputedStyle(el).flexWrap,
      обрезкаПоШирине: el.scrollWidth > el.clientWidth + 1,
      прокруткаСтраницы: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      кнопкаЕщё: !!document.querySelector('[data-testid="chips-more"]'),
      видноРубрик: el.querySelectorAll('.chip').length,
    }
  })
  console.log(`${String(w).padStart(4)}px`, JSON.stringify(r))
  await p.close()
}
await b.close()
