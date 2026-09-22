import { chromium } from 'playwright'
import path from 'node:path'
const OUT = path.resolve(import.meta.dirname, '..', 'qa', 'original')
const b = await chromium.launch()
const p = await (await b.newContext({ viewport:{width:390,height:844}, isMobile:true, deviceScaleFactor:2 })).newPage()
await p.goto('https://baduchai.ru/', { waitUntil:'domcontentloaded', timeout:90000 })
await p.waitForTimeout(7000)
await p.screenshot({ path: path.join(OUT,'home-mobile.png') })
console.log('ok')
await b.close()
