import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
const DIST='/home/va/Documents/code/baduchai/dist'
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2','.txt':'text/plain'}
const server=createServer(async(req,res)=>{const u=decodeURIComponent((req.url??'/').split('?')[0]);let f=path.join(DIST,u==='/'?'index.html':u);if(!existsSync(f))f=path.join(DIST,'index.html');res.writeHead(200,{'Content-Type':MIME[path.extname(f)]??'application/octet-stream'});res.end(await readFile(f))})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const base=`http://127.0.0.1:${server.address().port}/`
const b=await chromium.launch()
for (const [w,h,name] of [[390,844,'mobile'],[900,1000,'tablet']]) {
  const p=await (await b.newContext({viewport:{width:w,height:h},isMobile:w<=480,deviceScaleFactor:w<=480?2:1})).newPage()
  await p.goto(base,{waitUntil:'networkidle'})
  await p.locator('[data-testid="product-card"]').first().waitFor()
  await p.waitForTimeout(400)
  const hasMore = await p.locator('[data-testid="chips-more"]').count()
  console.log(`${w}px: кнопка «ещё» ${hasMore? 'есть':'не нужна'}`)
  await p.screenshot({path:`/home/va/Documents/code/baduchai/qa/widths/default-${name}.png`})
}
await b.close(); server.close()
