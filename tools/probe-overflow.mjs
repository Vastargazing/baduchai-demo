import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
const DIST = '/home/va/Documents/code/baduchai/dist'
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.txt':'text/plain'}
const server = createServer(async (req,res)=>{
  const u=decodeURIComponent((req.url??'/').split('?')[0])
  let f=path.join(DIST,u==='/'?'index.html':u)
  if(!existsSync(f)) f=path.join(DIST,'index.html')
  res.writeHead(200,{'Content-Type':MIME[path.extname(f)]??'application/octet-stream'})
  res.end(await readFile(f))
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const b=await chromium.launch()
const p=await (await b.newContext({viewport:{width:390,height:844},isMobile:true})).newPage()
await p.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'networkidle'})
const out = await p.evaluate(() => {
  const vw = document.documentElement.clientWidth
  const bad = []
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect()
    if (r.right > vw + 1 || r.width > vw + 1) {
      bad.push({ tag: el.tagName, cls: el.className?.toString().slice(0,50), w: Math.round(r.width), right: Math.round(r.right), scrollW: el.scrollWidth })
    }
  }
  return { vw, docScroll: document.documentElement.scrollWidth, bad: bad.slice(0, 14) }
})
console.log(JSON.stringify(out,null,1))
await b.close(); server.close()
