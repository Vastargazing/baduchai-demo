import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
const DIST = path.resolve(import.meta.dirname, '..', 'dist')
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.txt':'text/plain'}
const server = createServer(async (req,res)=>{
  const u=decodeURIComponent((req.url??'/').split('?')[0])
  let f=path.join(DIST,u==='/'?'index.html':u)
  if(!existsSync(f)) f=path.join(DIST,'index.html')
  res.writeHead(200,{'Content-Type':MIME[path.extname(f)]??'application/octet-stream'})
  res.end(await readFile(f))
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const base=`http://127.0.0.1:${server.address().port}/`
const b=await chromium.launch()
const p=await (await b.newContext({viewport:{width:1440,height:950}})).newPage()
await p.goto(base,{waitUntil:'networkidle'})
await p.locator('[data-testid="product-card"]').first().waitFor()
await p.locator('[data-testid="chip-chaj"]').click(); await p.waitForTimeout(250)
await p.locator('[data-testid="chip-ulun"]').click(); await p.waitForTimeout(400)
await p.screenshot({path:path.join(DIST,'..','qa/screenshots/08-categories.png')})
await b.close(); server.close()
console.log('ok')
