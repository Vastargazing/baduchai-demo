/**
 * Замер скорости прототипа. Воспроизводимо: одна и та же собранная версия,
 * локальный статический сервер, фиксированное число прогонов, медиана.
 *
 * Запуск: npm run build && npm run perf
 *
 * ВАЖНО: это измерение ТОЛЬКО прототипа. Сравнение с baduchai.ru здесь
 * не проводится — прототип отдаётся с локального диска, а магазин работает
 * на удалённом хостинге WordPress. Условия несопоставимы, поэтому любые
 * «быстрее в N раз» были бы некорректны.
 */
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const DIST = path.join(ROOT, 'dist')
const RUNS = 5
const CPU_THROTTLE = 4 // имитация среднего телефона

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
}

function serve(dir) {
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0])
    let file = path.join(dir, url === '/' ? 'index.html' : url)
    if (!existsSync(file)) file = path.join(dir, 'index.html')
    let body = await readFile(file)
    const headers = {
      'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    }
    // GitHub Pages отдаёт текстовые файлы сжатыми — иначе замер завышал трафик
    const compressible = /\.(html|js|css|json|txt)$/i.test(file)
    if (compressible && (req.headers['accept-encoding'] ?? '').includes('gzip')) {
      body = gzipSync(body)
      headers['Content-Encoding'] = 'gzip'
    }
    headers['Content-Length'] = body.length
    res.writeHead(200, headers)
    res.end(body)
  })
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)))
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const r1 = (x) => Math.round(x * 10) / 10

const CONTROL_LIST = `1. БА — 2 шт.
2. СЮАНЬ — 1 шт.
3. ХАО ХЭ — 1 шт.
4. ДИСК БИ — 1 шт.
5. ПУЭРИН — 1 шт.`

async function loadRun(browser, base, { mobile }) {
  const context = await browser.newContext(
    mobile
      ? { viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2 }
      : { viewport: { width: 1440, height: 950 } },
  )
  const page = await context.newPage()

  let bytes = 0
  let requests = 0
  page.on('response', async (res) => {
    requests++
    try {
      const len = (await res.allHeaders())['content-length']
      if (len) bytes += Number(len)
    } catch {
      /* ресурс мог быть закрыт — на итог это не влияет */
    }
  })

  const client = await context.newCDPSession(page)
  await client.send('Emulation.setCPUThrottlingRate', { rate: mobile ? CPU_THROTTLE : 1 })

  // Наблюдатели ставим до загрузки: LCP доступен только через PerformanceObserver,
  // а момент появления карточек надо поймать в самой странице, а не опросом снаружи.
  await page.addInitScript(() => {
    window.__lcp = null
    new PerformanceObserver((list) => {
      window.__lcp = list.getEntries().at(-1)?.startTime ?? window.__lcp
    }).observe({ type: 'largest-contentful-paint', buffered: true })

    window.__catalogReady = null
    const mo = new MutationObserver(() => {
      if (window.__catalogReady === null && document.querySelector('[data-testid="product-card"]')) {
        window.__catalogReady = performance.now()
        mo.disconnect()
      }
    })
    document.addEventListener('readystatechange', () => {
      if (document.body) mo.observe(document.body, { childList: true, subtree: true })
    })
  })

  await page.goto(base, { waitUntil: 'load' })
  await page.locator('[data-testid="product-card"]').first().waitFor()
  // даём LCP устояться
  await page.waitForTimeout(400)

  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0]
    const paints = performance.getEntriesByType('paint')
    return {
      dcl: n.domContentLoadedEventEnd,
      load: n.loadEventEnd,
      fcp: paints.find((p) => p.name === 'first-contentful-paint')?.startTime ?? null,
      lcp: window.__lcp,
      catalogReady: window.__catalogReady,
    }
  })
  const catalogReady = nav.catalogReady

  await context.close()
  return { ...nav, catalogReady, bytes, requests }
}

async function interactionRun(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } })
  const page = await context.newPage()
  const client = await context.newCDPSession(page)
  await client.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE })
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })

  // Ждём фактического обновления DOM через MutationObserver.
  // rAF здесь не годится: он привязан к кадру и мерил бы вертикальную развёртку,
  // а не работу приложения.
  await page.addInitScript(() => {
    window.__timeToDomUpdate = (selector, action) =>
      new Promise((resolve) => {
        const target = document.querySelector(selector)
        const t0 = performance.now()
        const mo = new MutationObserver(() => {
          mo.disconnect()
          resolve(performance.now() - t0)
        })
        mo.observe(target, { childList: true, subtree: true, characterData: true })
        action()
        // если разметка не изменилась — не зависаем
        setTimeout(() => { mo.disconnect(); resolve(performance.now() - t0) }, 2000)
      })
  })
  await page.reload({ waitUntil: 'networkidle' })

  const setValue = (el, value) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  // 1. Поиск: ввод запроса → перерисованный список
  const search = await page.evaluate(async (setValueSrc) => {
    const setValue = eval(`(${setValueSrc})`)
    const input = document.querySelector('[data-testid="search"]')
    const samples = []
    for (const q of ['пуэр', 'шу', 'SHU-47', 'да хун пао', 'инь чжень', '']) {
      const dt = await window.__timeToDomUpdate('[data-testid="grid"]', () => setValue(input, q))
      samples.push(dt)
    }
    return samples.slice(0, 5)
  }, setValue.toString())

  // 2. Изменение количества в каталоге → пересчитанные итоги
  const qty = await page.evaluate(async () => {
    const samples = []
    for (let i = 0; i < 5; i++) {
      const plus = document.querySelectorAll('[data-testid="product-card"] .stepper button')[1]
      samples.push(await window.__timeToDomUpdate('.side', () => plus.click()))
    }
    return samples
  })

  // 3. Разбор вставленного списка из пяти позиций → предпросмотр
  await page.locator('[data-testid="open-paste"]').click()
  const parse = await page.evaluate(async ([text, setValueSrc]) => {
    const setValue = eval(`(${setValueSrc})`)
    const area = document.querySelector('[data-testid="paste-input"]')
    const samples = []
    for (let i = 0; i < 5; i++) {
      await window.__timeToDomUpdate('.modal-body', () => setValue(area, ''))
      samples.push(await window.__timeToDomUpdate('.modal-body', () => setValue(area, text)))
    }
    return samples
  }, [CONTROL_LIST, setValue.toString()])

  // 4. Применение разобранного списка к корзине
  const apply = await page.evaluate(async () =>
    window.__timeToDomUpdate('.modal-body', () =>
      document.querySelector('[data-testid="apply-replace"]').click(),
    ),
  )

  await context.close()
  return { search, qty, parse, apply }
}

async function main() {
  if (!existsSync(DIST)) throw new Error('нет dist — сначала npm run build')
  const server = await serve(DIST)
  const base = `http://127.0.0.1:${server.address().port}/`
  const browser = await chromium.launch()

  const env = {
    date: new Date().toISOString(),
    os: execSync('uname -sr').toString().trim(),
    cpu: execSync("grep -m1 'model name' /proc/cpuinfo || true").toString().split(':').pop()?.trim() ?? 'н/д',
    cores: execSync('nproc').toString().trim(),
    chromium: browser.version(),
    node: process.version,
    server: 'локальный статический HTTP на 127.0.0.1, Cache-Control: no-store (каждый прогон — холодный)',
    runs: RUNS,
  }

  const scenarios = {}
  for (const [label, opts] of [
    ['десктоп 1440×950, CPU без замедления', { mobile: false }],
    [`мобильный 390×844, CPU ×${CPU_THROTTLE}`, { mobile: true }],
  ]) {
    const runs = []
    for (let i = 0; i < RUNS; i++) runs.push(await loadRun(browser, base, opts))
    scenarios[label] = {
      'First Contentful Paint, мс': r1(median(runs.map((r) => r.fcp).filter(Boolean))),
      'Largest Contentful Paint, мс': r1(median(runs.map((r) => r.lcp).filter(Boolean))),
      'DOMContentLoaded, мс': r1(median(runs.map((r) => r.dcl))),
      'load, мс': r1(median(runs.map((r) => r.load))),
      'каталог отрисован, мс': r1(median(runs.map((r) => r.catalogReady).filter(Boolean))),
      'запросов при первой загрузке': median(runs.map((r) => r.requests)),
      'передано (сжато, как на GitHub Pages), КБ': r1(median(runs.map((r) => r.bytes)) / 1024),
    }
  }

  const inter = await interactionRun(browser, base)
  const interaction = {
    'поиск: ввод → обновлённый список, мс': r1(median(inter.search)),
    'изменение количества в каталоге, мс': r1(median(inter.qty)),
    'разбор списка из 5 позиций → предпросмотр, мс': r1(median(inter.parse)),
    'применение списка к корзине, мс': r1(inter.apply),
    условия: `десктоп 1440×950, CPU ×${CPU_THROTTLE}, медиана из 5 повторов`,
  }

  const sizes = {}
  for (const f of ['index.html']) sizes[f] = statSync(path.join(DIST, f)).size
  const assetsDir = path.join(DIST, 'assets')
  for (const f of execSync(`ls ${assetsDir}`).toString().trim().split('\n')) {
    sizes[`assets/${f}`] = statSync(path.join(assetsDir, f)).size
  }
  const imgTotal = Number(execSync(`du -sb ${path.join(DIST, 'img')} | cut -f1`).toString().trim())

  const report = {
    примечание:
      'Измерен только прототип. Сравнение с baduchai.ru не проводилось: прототип отдаётся с локального диска, магазин — с удалённого хостинга WordPress. Условия несопоставимы, поэтому относительные оценки («быстрее в N раз») здесь не приводятся.',
    условия: env,
    'первая загрузка': scenarios,
    'отклик интерфейса': interaction,
    'размер сборки, байт': {
      ...sizes,
      'img/ (84 изображения, загружаются по мере прокрутки)': imgTotal,
    },
  }

  console.log(JSON.stringify(report, null, 1))
  await writeFile(path.join(ROOT, 'qa', 'perf-report.json'), JSON.stringify(report, null, 1))
  console.log('\nОтчёт: qa/perf-report.json')

  await browser.close()
  server.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
