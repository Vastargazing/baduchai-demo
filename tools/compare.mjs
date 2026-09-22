/** Кладёт рядом шапку оригинала и прототипа — для визуального сравнения. */
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
import path from 'node:path'
const OUT = path.resolve(import.meta.dirname, '..', 'qa', 'screenshots')
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1280, height: 560 } })

const p1 = await ctx.newPage()
await p1.goto('https://baduchai.ru/', { waitUntil: 'domcontentloaded', timeout: 90000 })
await p1.waitForTimeout(7000)
await p1.evaluate(() => document.querySelectorAll('.wppouups, [class*=popup], [id*=popup]').forEach(e => e.remove()))
await p1.screenshot({ path: '/tmp/cmp-orig.png' })

const p2 = await ctx.newPage()
await p2.goto('https://vastargazing.github.io/baduchai-demo/', { waitUntil: 'networkidle', timeout: 60000 })
await p2.locator('[data-testid="product-card"]').first().waitFor()
await p2.waitForTimeout(1200)
await p2.screenshot({ path: '/tmp/cmp-demo.png' })
await b.close()

execSync(`magick /tmp/cmp-orig.png -bordercolor '#d00' -border 3 /tmp/a.png`)
execSync(`magick /tmp/cmp-demo.png -bordercolor '#0a0' -border 3 /tmp/b.png`)
execSync(`magick /tmp/a.png /tmp/b.png -append ${path.join(OUT, '09-sravnenie.png')}`)
console.log('готово')
