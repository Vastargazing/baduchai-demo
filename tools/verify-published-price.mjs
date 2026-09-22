/** Скачивает прайс с опубликованной версии и проверяет закрепление и итоги. */
import { chromium } from 'playwright'
import { unzipSync, strFromU8 } from 'fflate'
import { readFile } from 'node:fs/promises'
const SITE = 'https://vastargazing.github.io/baduchai-demo/'
const b = await chromium.launch()
const ctx = await b.newContext({ viewport:{width:1440,height:950}, acceptDownloads:true })
const p = await ctx.newPage()
await p.goto(SITE, { waitUntil:'networkidle', timeout:90000 })
await p.locator('[data-testid="product-card"]').first().waitFor()
await p.locator('[data-testid="open-excel"]').click()
const [d] = await Promise.all([p.waitForEvent('download'), p.locator('[data-testid="download-template"]').click()])
const file = '/tmp/published-prays.xlsx'
await d.saveAs(file)
const xml = strFromU8(unzipSync(new Uint8Array(await readFile(file)))['xl/worksheets/sheet1.xml'])
const styles = strFromU8(unzipSync(new Uint8Array(await readFile(file)))['xl/styles.xml'])
console.log(JSON.stringify({
  файл: d.suggestedFilename(),
  шапкаЗакреплена: /<pane ySplit="3"[^>]*state="frozen"/.test(xml),
  итогКоличества: /SUMPRODUCT\(IFERROR\(G4:G\d+\*1,0\)\)/.test(xml),
  итогСуммы: /<f>SUM\(H4:H\d+\)<\/f>/.test(xml),
  автофильтр: xml.includes('<autoFilter'),
  шрифтСайта: styles.includes('<name val="Neucha"/>'),
  колонкаСумма: xml.includes('Сумма'),
}, null, 1))
await b.close()
