/** Снимает оформление исходного сайта: шрифты, цвета, структуру шапки. Только чтение. */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
const OUT = path.resolve(import.meta.dirname, '..', 'qa', 'original')
await mkdir(OUT, { recursive: true })
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1440, height: 1200 } })
const p = await ctx.newPage()
await p.goto('https://baduchai.ru/', { waitUntil: 'domcontentloaded', timeout: 90000 })
await p.waitForTimeout(6000)
await p.screenshot({ path: path.join(OUT, 'home-desktop.png') })

const styles = await p.evaluate(() => {
  const cs = (el) => (el ? getComputedStyle(el) : null)
  const pick = (el, props) => {
    const s = cs(el); if (!s) return null
    return Object.fromEntries(props.map((k) => [k, s[k]]))
  }
  const body = pick(document.body, ['fontFamily','fontSize','color','backgroundColor','lineHeight'])
  const h = document.querySelector('h1,h2,.site-title,.elementor-heading-title')
  const heading = pick(h, ['fontFamily','fontSize','fontWeight','color','letterSpacing','textTransform'])
  const link = document.querySelector('nav a, .menu-item a')
  const nav = pick(link, ['fontFamily','fontSize','fontWeight','color','textTransform','letterSpacing'])
  const fonts = [...new Set([...document.querySelectorAll('*')].slice(0,3000)
    .map((e) => getComputedStyle(e).fontFamily).filter(Boolean))].slice(0, 12)
  const sheets = [...document.querySelectorAll('link[rel=stylesheet]')].map((l) => l.href).slice(0, 25)
  const title = document.title
  const logo = document.querySelector('.site-logo img, .custom-logo, header img')?.src ?? null
  return { body, heading, nav, fonts, sheets, title, logo }
})
console.log(JSON.stringify(styles, null, 1))
await b.close()
