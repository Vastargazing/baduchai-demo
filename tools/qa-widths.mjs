/**
 * Проверка вёрстки на всех типичных ширинах: нет горизонтальной прокрутки,
 * рубрики не обрезаны, до каждой можно добраться, шапка и корзина работают.
 *
 * Запуск: npm run build && node tools/qa-widths.mjs
 */
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'
import { readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const DIST = path.join(ROOT, 'dist')
const SHOTS = path.join(ROOT, 'qa', 'widths')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

function serve(dir) {
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0])
    let file = path.join(dir, url === '/' ? 'index.html' : url)
    if (!existsSync(file)) file = path.join(dir, 'index.html')
    let body = await readFile(file)
    const headers = { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' }
    if (/\.(html|js|css|json|txt)$/i.test(file) && (req.headers['accept-encoding'] ?? '').includes('gzip')) {
      body = gzipSync(body)
      headers['Content-Encoding'] = 'gzip'
    }
    headers['Content-Length'] = body.length
    res.writeHead(200, headers)
    res.end(body)
  })
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)))
}

/** Ширины: узкие телефоны, обычные телефоны, планшеты, ноутбуки. */
const WIDTHS = [
  { w: 320, h: 640, label: 'узкий телефон' },
  { w: 360, h: 800, label: 'телефон' },
  { w: 390, h: 844, label: 'телефон (эталон задания)' },
  { w: 414, h: 896, label: 'крупный телефон' },
  { w: 480, h: 900, label: 'телефон в ландшафте' },
  { w: 600, h: 900, label: 'узкий планшет' },
  { w: 768, h: 1024, label: 'планшет' },
  { w: 900, h: 1000, label: 'планшет в ландшафте' },
  { w: 1024, h: 900, label: 'маленький ноутбук' },
  { w: 1280, h: 900, label: 'ноутбук' },
  { w: 1440, h: 950, label: 'десктоп' },
]

const results = []
const fail = (width, msg) => results.push({ width, status: 'FAIL', msg })
const pass = (width, msg) => results.push({ width, status: 'PASS', msg })

async function main() {
  if (!existsSync(DIST)) throw new Error('нет dist — сначала npm run build')
  await mkdir(SHOTS, { recursive: true })
  const server = await serve(DIST)
  const base = `http://127.0.0.1:${server.address().port}/`
  const browser = await chromium.launch()

  for (const { w, h, label } of WIDTHS) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      isMobile: w <= 480,
      hasTouch: w <= 480,
      deviceScaleFactor: w <= 480 ? 2 : 1,
    })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(base, { waitUntil: 'networkidle' })
    await page.locator('[data-testid="product-card"]').first().waitFor()
    await page.waitForTimeout(250)

    const tag = `${w}px`

    // 1. Нет горизонтальной прокрутки страницы
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    if (overflow > 1) fail(tag, `горизонтальная прокрутка ${overflow} px`)
    else pass(tag, 'нет горизонтальной прокрутки')

    // 2. Ни один элемент не выходит за правый край
    const spill = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.right > vw + 1) {
          return `${el.tagName}.${String(el.className).slice(0, 40)} до ${Math.round(r.right)} px`
        }
      }
      return null
    })
    if (spill) fail(tag, `элемент выходит за край: ${spill}`)
    else pass(tag, 'элементы в пределах экрана')

    // 3. Рубрики переносятся, а не прокручиваются вбок
    const chips = await page.evaluate(() => {
      const el = document.querySelector('.chips')
      if (!el) return null
      const cs = getComputedStyle(el)
      return { wrap: cs.flexWrap, overflowX: cs.overflowX, clipped: el.scrollWidth > el.clientWidth + 1 }
    })
    if (!chips) fail(tag, 'ряд рубрик не найден')
    else if (chips.wrap !== 'wrap') fail(tag, `рубрики не переносятся (flex-wrap: ${chips.wrap})`)
    else if (chips.clipped) fail(tag, 'ряд рубрик обрезан по ширине')
    else pass(tag, 'рубрики переносятся по строкам')

    // 4. Каждая рубрика доступна: либо видна, либо открывается кнопкой «ещё»
    const more = page.locator('[data-testid="chips-more"]')
    if (await more.count()) await more.click()
    await page.waitForTimeout(200)
    const hidden = await page.evaluate(() => {
      const row = document.querySelector('.chips')
      const out = []
      for (const chip of row.querySelectorAll('.chip')) {
        const r = chip.getBoundingClientRect()
        const rowRect = row.getBoundingClientRect()
        if (r.right > rowRect.right + 1 || r.bottom > rowRect.bottom + 1) out.push(chip.textContent.trim())
      }
      return out
    })
    if (hidden.length) fail(tag, `рубрики недоступны: ${hidden.join(', ')}`)
    else pass(tag, 'все рубрики доступны')

    // 5. Фильтр по рубрике работает на этой ширине
    await page.locator('[data-testid="chip-chaj"]').click()
    await page.waitForTimeout(300)
    const count = await page.locator('[data-testid="result-count"]').innerText()
    if (!/Найдено 84/.test(count)) fail(tag, `фильтр «ЧАЙ» дал: ${count}`)
    else pass(tag, 'фильтр по рубрике работает')

    // 6. Вложенные рубрики видны и не обрезаны
    const subClipped = await page.evaluate(() => {
      const sub = document.querySelector('.chips-sub')
      if (!sub) return 'второй ряд не появился'
      return sub.scrollWidth > sub.clientWidth + 1 ? 'второй ряд обрезан' : null
    })
    if (subClipped) fail(tag, subClipped)
    else pass(tag, 'подрубрики видны полностью')

    // 7. Сборка заказа доступна на этой ширине
    await page.locator('[data-testid="product-card"]').first().scrollIntoViewIfNeeded()
    await page.locator('[data-testid="product-card"]').first().locator('.stepper button').nth(1).click()
    await page.waitForTimeout(200)
    const inCart = w >= 1100
      ? await page.locator('[data-testid="t-packages"]').first().innerText()
      : await page.locator('.mobile-bar-meta').innerText().then((t) => t.match(/(\d+) упак/)?.[1])
    if (String(inCart) !== '1') fail(tag, `товар не добавился в корзину (${inCart})`)
    else pass(tag, 'товар добавляется в корзину')

    if (errors.length) fail(tag, `ошибки в консоли: ${errors[0]}`)
    else pass(tag, 'консоль чистая')

    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: path.join(SHOTS, `w${String(w).padStart(4, '0')}.png`) })
    await ctx.close()

    const bad = results.filter((r) => r.width === tag && r.status === 'FAIL')
    console.log(`${bad.length ? 'FAIL' : 'PASS'}  ${String(w).padStart(4)} px — ${label}` +
      (bad.length ? `\n      ${bad.map((b) => b.msg).join('\n      ')}` : ''))
  }

  await browser.close()
  server.close()

  const failed = results.filter((r) => r.status === 'FAIL')
  console.log(`\n${'─'.repeat(60)}\nИТОГО: проверок ${results.length}, провалов ${failed.length}`)
  console.log(`Скриншоты: qa/widths/`)
  if (failed.length) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
