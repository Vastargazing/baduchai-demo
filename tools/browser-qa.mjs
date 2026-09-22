/**
 * Браузерная проверка прототипа на собранной версии (dist).
 *
 * Запуск: npm run build && npm run qa:browser
 * Результат: отчёт PASS/FAIL в консоли + скриншоты в qa/screenshots.
 */
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const DIST = path.join(ROOT, 'dist')
const SHOTS = path.join(ROOT, 'qa', 'screenshots')
const DOWNLOADS = path.join(ROOT, 'qa', 'downloads')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
}

function serve(dir) {
  const server = createServer(async (req, res) => {
    try {
      const url = decodeURIComponent((req.url ?? '/').split('?')[0])
      let file = path.join(dir, url === '/' ? 'index.html' : url)
      if (!file.startsWith(dir)) return res.writeHead(403).end()
      if (!existsSync(file)) file = path.join(dir, 'index.html')
      const body = await readFile(file)
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(500).end()
    }
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

const results = []
let currentName = null

/** Закрывает оставшиеся окна и прокручивает наверх, чтобы сбой одной проверки не ломал следующие. */
async function resetUi(page) {
  for (let i = 0; i < 4; i++) {
    if ((await page.locator('.overlay').count()) === 0) break
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
  }
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(60)
}

let activePage = null

async function check(name, fn) {
  currentName = name
  if (activePage) await resetUi(activePage).catch(() => {})
  try {
    const detail = await fn()
    results.push({ name, status: 'PASS', detail: detail ?? '' })
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } catch (e) {
    results.push({ name, status: 'FAIL', detail: e.message.split('\n')[0] })
    console.log(`FAIL  ${name} — ${e.message.split('\n')[0]}`)
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

function eq(actual, expected, label) {
  if (String(actual) !== String(expected)) {
    throw new Error(`${label}: ожидалось «${expected}», получено «${actual}»`)
  }
}

const T = (page, id) => page.locator(`[data-testid="${id}"]`)
const totalsOf = async (page) => ({
  positions: await T(page, 't-positions').first().innerText(),
  packages: await T(page, 't-packages').first().innerText(),
  weight: await T(page, 't-weight').first().innerText(),
  amount: await T(page, 't-amount').first().innerText(),
})

const CONTROL_LIST = `1. БА — 2 шт.
2. СЮАНЬ — 1 шт.
3. ХАО ХЭ — 1 шт.
4. ДИСК БИ — 1 шт.
5. ПУЭРИН — 1 шт.`

async function main() {
  assert(existsSync(DIST), 'нет папки dist — сначала npm run build')
  // чистим только свои папки: в qa/ лежат ещё отчёты ширин и снимки оригинала
  await rm(SHOTS, { recursive: true, force: true })
  await rm(DOWNLOADS, { recursive: true, force: true })
  await mkdir(SHOTS, { recursive: true })
  await mkdir(DOWNLOADS, { recursive: true })

  const server = await serve(DIST)
  const base = `http://127.0.0.1:${server.address().port}/`
  const browser = await chromium.launch()

  // ── Десктоп ──────────────────────────────────────────────
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true })
  const page = await desktop.newPage()
  const consoleErrors = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
  page.on('pageerror', (e) => consoleErrors.push(String(e)))
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.locator('[data-testid="product-card"]').first().waitFor()
  activePage = page

  await check('каталог открывается и показывает товары', async () => {
    const n = await T(page, 'product-card').count()
    assert(n >= 20, `карточек ${n}`)
    return `${n} карточек`
  })

  await check('видна пометка «Демонстрационный прототип»', async () => {
    const bar = await page.locator('.demo-bar').innerText()
    assert(/Демонстрационный прототип/i.test(bar), `текст: ${bar}`)
    return bar.slice(0, 48) + '…'
  })

  await check('индексация запрещена', async () => {
    const robots = await page.locator('meta[name="robots"]').getAttribute('content')
    assert(/noindex/.test(robots ?? ''), `meta robots = ${robots}`)
    const res = await page.request.get(`${base}robots.txt`)
    const txt = await res.text()
    assert(/Disallow: \//.test(txt), 'robots.txt не запрещает обход')
    return `meta: ${robots}`
  })

  await check('поиск по названию', async () => {
    await T(page, 'search').fill('ХАО ХЭ')
    await page.waitForTimeout(120)
    const n = await T(page, 'product-card').count()
    assert(n >= 1, 'ничего не найдено')
    const first = await T(page, 'product-card').first().getAttribute('data-sku')
    eq(first, 'SHU-32', 'первый результат')
    return `${n} результат(ов), первый SHU-32`
  })

  await check('поиск по артикулу', async () => {
    await T(page, 'search').fill('SHU-49')
    await page.waitForTimeout(120)
    const first = await T(page, 'product-card').first().getAttribute('data-sku')
    eq(first, 'SHU-49', 'первый результат')
    return 'SHU-49 найден'
  })

  await check('поиск ничего не находит по бессмысленному запросу', async () => {
    await T(page, 'search').fill('zzzqqq')
    await page.waitForTimeout(120)
    eq(await T(page, 'product-card').count(), 0, 'карточек')
    const txt = await T(page, 'result-count').innerText()
    assert(/Ничего не найдено/.test(txt), txt)
    return 'показано сообщение «Ничего не найдено»'
  })

  await check('фильтр по рубрике верхнего уровня', async () => {
    await T(page, 'search').fill('')
    await page.locator('[data-testid="chip-chaj"]').click()
    await page.waitForTimeout(200)
    const n = await T(page, 'product-card').count()
    assert(n > 20 && n < 200, `в рубрике ЧАЙ ${n} товаров`)
    return `${n} товаров в «ЧАЙ»`
  })

  await check('вложенные рубрики раскрываются, как в меню сайта', async () => {
    // после выбора «ЧАЙ» должен появиться второй ряд с подрубриками
    const sub = page.locator('.chips-sub').first()
    assert(await sub.isVisible(), 'второй ряд рубрик не появился')
    const names = await sub.innerText()
    for (const expected of ['Шу Пуэр', 'Улун', 'Красный']) {
      assert(names.includes(expected), `нет подрубрики ${expected}: ${names}`)
    }

    await page.locator('[data-testid="chip-ulun"]').click()
    await page.waitForTimeout(200)
    const rows = await page.locator('.chips-sub').count()
    eq(rows, 2, 'рядов подрубрик после выбора «Улун»')
    const deep = await page.locator('.chips-sub').nth(1).innerText()
    assert(/Цин Хо/.test(deep), `нет третьего уровня: ${deep}`)
    return 'ЧАЙ → Улун → Цин Хо: три уровня'
  })

  await check('родительская рубрика включает товары вложенных', async () => {
    await page.locator('[data-testid="chip-czin-ho-lyogkaya-prozharka"]').click()
    await page.waitForTimeout(200)
    const deepCount = await T(page, 'product-card').count()
    await page.locator('[data-testid="chip-chaj"]').click() // снимаем выбор до ЧАЙ
    await page.waitForTimeout(200)
    await page.locator('[data-testid="chip-chaj"]').click()
    await page.waitForTimeout(200)
    const all = await T(page, 'product-card').count()
    assert(deepCount > 0, 'во вложенной рубрике пусто')
    assert(all > deepCount, `родительская рубрика (${all}) не больше вложенной (${deepCount})`)
    return `Цин Хо: ${deepCount}, весь каталог: ${all}`
  })

  await check('рубрики переносятся по строкам, а не прокручиваются вбок', async () => {
    const info = await page.evaluate(() => {
      const el = document.querySelector('.chips')
      return {
        wrap: getComputedStyle(el).flexWrap,
        clipped: el.scrollWidth > el.clientWidth + 1,
      }
    })
    eq(info.wrap, 'wrap', 'перенос рубрик')
    assert(!info.clipped, 'ряд рубрик обрезан по ширине')
    return 'перенос по строкам, обрезки нет'
  })

  await check('свёрнутые рубрики раскрываются кнопкой', async () => {
    // на широком экране все рубрики помещаются и кнопка не нужна
    const more = T(page, 'chips-more')
    if ((await more.count()) === 0) {
      const visible = await page.locator('.chips .chip').count()
      assert(visible >= 11, `видно рубрик: ${visible}`)
      return 'все рубрики помещаются, кнопка не нужна'
    }
    const before = await page.locator('.chips').first().evaluate((el) => el.clientHeight)
    await more.click()
    await page.waitForTimeout(200)
    const after = await page.locator('.chips').first().evaluate((el) => el.clientHeight)
    assert(after > before, `высота не выросла: ${before} → ${after}`)
    eq(await more.getAttribute('aria-expanded'), 'true', 'состояние кнопки')
    await more.click()
    await page.waitForTimeout(150)
    return `раскрытие ${before} → ${after} px`
  })

  await check('ввод количества и кнопки плюс/минус в каталоге', async () => {
    await T(page, 'search').fill('SHU-47')
    await page.waitForTimeout(120)
    const card = T(page, 'product-card').first()
    await card.locator('.stepper button').nth(1).click() // +
    await card.locator('.stepper button').nth(1).click()
    eq(await card.locator('.stepper input').inputValue(), '2', 'после двух «+»')
    await card.locator('.stepper button').nth(0).click() // −
    eq(await card.locator('.stepper input').inputValue(), '1', 'после «−»')
    await card.locator('.stepper input').fill('4')
    await page.waitForTimeout(80)
    const t = await totalsOf(page)
    eq(t.packages, '4', 'упаковок в корзине')
    eq(t.amount, '$120', 'сумма 4 × $30')
    return '± и прямой ввод работают'
  })

  await check('корзина восстанавливается после перезагрузки', async () => {
    const before = await totalsOf(page)
    await page.reload({ waitUntil: 'networkidle' })
    await page.locator('[data-testid="product-card"]').first().waitFor()
    const after = await totalsOf(page)
    eq(after.packages, before.packages, 'упаковок после перезагрузки')
    eq(after.amount, before.amount, 'сумма после перезагрузки')
    return `сохранилось ${after.packages} упак., ${after.amount}`
  })

  await check('вставка контрольного списка из пяти товаров', async () => {
    await T(page, 'open-paste').click()
    await T(page, 'paste-input').fill(CONTROL_LIST)
    await page.waitForTimeout(200)
    const okRows = await page.locator('.preview-row.ok').count()
    eq(okRows, 5, 'распознанных строк')
    await T(page, 'apply-replace').click()
    await page.waitForTimeout(120)
    await page.locator('.modal-foot .btn').click() // Закрыть
    const t = await totalsOf(page)
    eq(t.positions, '5', 'позиций')
    eq(t.packages, '6', 'упаковок')
    eq(t.weight, '1,154 кг', 'общий вес')
    eq(t.amount, '$206', 'сумма')
    return `5 поз. / 6 упак. / ${t.weight} / ${t.amount}`
  })

  await check('повторное нажатие не удваивает заказ', async () => {
    await T(page, 'open-paste').click()
    await T(page, 'paste-input').fill(CONTROL_LIST)
    await page.waitForTimeout(200)
    await T(page, 'apply-replace').click()
    await page.waitForTimeout(100)
    const note = await T(page, 'applied-note').innerText()
    assert(await T(page, 'apply-replace').count() === 0, 'кнопка применения осталась доступной')
    await page.locator('.modal-foot .btn').click()
    const t = await totalsOf(page)
    eq(t.packages, '6', 'упаковок после повторного применения')
    eq(t.amount, '$206', 'сумма после повторного применения')
    return `итог не изменился; подсказка: «${note.slice(0, 40)}…»`
  })

  await check('«добавить» и «заменить» ведут себя по-разному', async () => {
    await T(page, 'open-paste').click()
    await T(page, 'paste-input').fill('БА — 1')
    await page.waitForTimeout(200)
    await T(page, 'apply-add').click()
    await page.waitForTimeout(100)
    await page.locator('.modal-foot .btn').click()
    const added = await totalsOf(page)
    eq(added.packages, '7', 'после «добавить» к 6 упаковкам')

    await T(page, 'open-paste').click()
    await T(page, 'paste-input').fill('БА — 1')
    await page.waitForTimeout(200)
    await T(page, 'apply-replace').click()
    await page.waitForTimeout(100)
    await page.locator('.modal-foot .btn').click()
    const replaced = await totalsOf(page)
    eq(replaced.positions, '1', 'позиций после «заменить»')
    eq(replaced.packages, '1', 'упаковок после «заменить»')
    return 'добавление 6→7, замена → 1 позиция'
  })

  await check('неизвестное название не подставляет товар', async () => {
    await T(page, 'open-paste').click()
    await T(page, 'paste-input').fill('Лапсанг Сушонг Премиум 2077 — 2')
    await page.waitForTimeout(200)
    eq(await page.locator('.preview-row.not_found').count(), 1, 'строк «не найдено»')
    eq(await page.locator('.preview-row.ok').count(), 0, 'распознанных строк')
    assert(await T(page, 'apply-replace').isDisabled(), 'применение доступно при нуле распознанных')
    await page.locator('.modal-foot .btn').click()
    return 'строка помечена «Не найдено», применение заблокировано'
  })

  await check('неоднозначное название требует выбора', async () => {
    await T(page, 'open-paste').click()
    await T(page, 'paste-input').fill('Инь Чжень — 1')
    await page.waitForTimeout(200)
    eq(await page.locator('.preview-row.ambiguous').count(), 1, 'неоднозначных строк')
    const choices = await page.locator('.preview-row.ambiguous .choice').count()
    assert(choices > 1, `вариантов для выбора: ${choices}`)
    await page.locator('.preview-row.ambiguous .choice').first().click()
    await page.waitForTimeout(120)
    eq(await page.locator('.preview-row.ok').count(), 1, 'после выбора')
    await page.locator('.modal-foot .btn').click()
    return `${choices} варианта(ов), выбор разрешает строку`
  })

  await check('дубликаты объединяются явно', async () => {
    await T(page, 'open-paste').click()
    await T(page, 'paste-input').fill('БА — 2\nСЮАНЬ — 1\nБА — 3')
    await page.waitForTimeout(200)
    eq(await page.locator('.preview-row').count(), 2, 'строк предпросмотра')
    const text = await page.locator('.preview-list').innerText()
    assert(/Дубликат/.test(text), 'нет пометки о дубликате')
    assert(/×\s*5/.test(text), 'количества не сложились')
    await page.locator('.modal-foot .btn').click()
    return 'строки 1 и 3 объединены в × 5'
  })

  await check('некорректные количества отклоняются', async () => {
    await T(page, 'open-paste').click()
    await T(page, 'paste-input').fill('БА — 0\nСЮАНЬ — -2\nХАО ХЭ — 1,5\nДИСК БИ — две')
    await page.waitForTimeout(200)
    eq(await page.locator('.preview-row.invalid_qty').count(), 4, 'строк с ошибкой количества')
    eq(await page.locator('.preview-row.ok').count(), 0, 'распознанных строк')
    await page.locator('.modal-foot .btn').click()
    return '0, отрицательное, дробное и нечисловое отклонены'
  })

  await check('список по артикулам', async () => {
    await T(page, 'open-paste').click()
    await T(page, 'paste-input').fill('SHU-47 — 2\nSHU-38 — 1')
    await page.waitForTimeout(200)
    eq(await page.locator('.preview-row.ok').count(), 2, 'распознанных строк')
    await T(page, 'apply-replace').click()
    await page.waitForTimeout(100)
    await page.locator('.modal-foot .btn').click()
    const t = await totalsOf(page)
    eq(t.amount, '$108', 'сумма 2×$30 + $48')
    return `${t.positions} поз. / ${t.amount}`
  })

  // ── Скриншоты каталога и корзины ─────────────────────────
  await check('вставка контрольного списка восстановлена для скриншотов', async () => {
    await T(page, 'open-paste').click()
    await T(page, 'paste-input').fill(CONTROL_LIST)
    await page.waitForTimeout(200)
    await T(page, 'apply-replace').click()
    await page.waitForTimeout(100)
    await page.locator('.modal-foot .btn').click()
    await T(page, 'search').fill('')
    await page.waitForTimeout(150)
    await page.screenshot({ path: path.join(SHOTS, '01-catalog-desktop.png'), fullPage: false })
    return 'скриншот каталога сохранён'
  })

  await check('корзина показывает позиции, вес и сумму', async () => {
    const t = await totalsOf(page)
    eq(t.positions, '5', 'позиций')
    eq(t.weight, '1,154 кг', 'вес')
    await T(page, 'open-cart').click()
    await page.waitForTimeout(200)
    await page.screenshot({ path: path.join(SHOTS, '02-cart-desktop.png') })
    const lines = await page.locator('.modal [data-testid="cart-lines"] .cart-line').count()
    eq(lines, 5, 'строк в корзине')
    await page.locator('.modal-head button').click()
    return '5 строк, редактирование и удаление доступны'
  })

  await check('удаление и изменение позиции в корзине', async () => {
    await T(page, 'open-cart').click()
    await page.waitForTimeout(150)
    await page.locator('.modal [data-testid="remove-line"]').first().click()
    await page.waitForTimeout(120)
    const t = await totalsOf(page)
    eq(t.positions, '4', 'позиций после удаления')
    await page.locator('.modal-head button').click()
    return 'позиция удалена, итоги пересчитаны'
  })

  await check('предупреждение о весе называет конкретные позиции', async () => {
    // БУ ЧЖИ ДАО (SHU-50) вес публикует, БИН ДАО ГУН ТИН (SHU-40) — нет.
    // Сообщение должно называть вторую позицию и не трогать первую.
    await T(page, 'open-paste').click()
    await T(page, 'paste-input').fill('SHU-50 — 1\nSHU-40 — 1')
    await page.waitForTimeout(300)
    await T(page, 'apply-replace').click()
    await page.waitForTimeout(150)
    await page.locator('.modal-foot .btn').click()

    const note = await T(page, 'weight-note').first().innerText()
    assert(/SHU-40/.test(note), `в предупреждении нет SHU-40: ${note}`)
    assert(!/SHU-50/.test(note), `в предупреждении зря упомянут SHU-50: ${note}`)
    return note.replace(/\s+/g, ' ').slice(0, 90)
  })

  await check('у товара с опубликованным весом предупреждения нет', async () => {
    await T(page, 'open-paste').click()
    await T(page, 'paste-input').fill('SHU-50 — 1')
    await page.waitForTimeout(300)
    await T(page, 'apply-replace').click()
    await page.waitForTimeout(150)
    await page.locator('.modal-foot .btn').click()
    eq(await T(page, 'weight-note').count(), 0, 'блоков предупреждения о весе')
    eq((await totalsOf(page)).weight, '357 г', 'вес БУ ЧЖИ ДАО')
    return 'вес показан точно, без оговорок'
  })

  await check('нечайный товар не считается позицией без веса', async () => {
    await T(page, 'search').fill('ЧАЙНИКИ')
    await page.waitForTimeout(200)
    await page.locator('[data-testid="chip-chajniki"]').click()
    await page.waitForTimeout(250)
    await T(page, 'search').fill('')
    await page.waitForTimeout(250)
    await T(page, 'product-card').first().locator('.stepper button').nth(1).click()
    await page.waitForTimeout(200)
    eq(await T(page, 'weight-note').count(), 0, 'предупреждений о весе для чайника')
    return 'для предметов вес не считается пробелом'
  })

  await check('изменение количества не переставляет позиции корзины', async () => {
    await T(page, 'open-paste').click()
    await T(page, 'paste-input').fill('SHU-29 — 9\nSHU-47 — 9\nSHU-32 — 2')
    await page.waitForTimeout(300)
    await T(page, 'apply-replace').click()
    await page.waitForTimeout(150)
    await page.locator('.modal-foot .btn').click()

    const order = async () =>
      page.locator('[data-testid="cart-lines"] .cart-line').first().locator('..').innerHTML()
        .then(() => page.locator('[data-testid="cart-lines"] .cart-line')
          .evaluateAll((els) => els.map((e) => e.getAttribute('data-sku'))))

    const before = await order()
    eq(before.join(','), 'SHU-29,SHU-47,SHU-32', 'порядок до изменения')

    // жмём «+» у первой строки десять раз — раньше она уезжала в конец списка
    for (let i = 0; i < 10; i++) {
      await page.locator('[data-testid="cart-lines"] .cart-line').first()
        .locator('.stepper button').nth(1).click()
      await page.waitForTimeout(40)
    }
    const after = await order()
    eq(after.join(','), before.join(','), 'порядок после изменения')

    const firstQty = await page.locator('[data-testid="cart-lines"] .cart-line').first()
      .locator('.stepper input').inputValue()
    eq(firstQty, '19', 'количество первой строки')
    eq((await totalsOf(page)).packages, '30', 'всего упаковок')
    return 'строка осталась на месте, количество 9 → 19'
  })

  await check('уменьшение количества тоже не двигает строку', async () => {
    const skus = () => page.locator('[data-testid="cart-lines"] .cart-line')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-sku')))
    const before = await skus()
    const middle = page.locator('[data-testid="cart-lines"] .cart-line').nth(1)
    await middle.locator('.stepper button').nth(0).click()
    await page.waitForTimeout(120)
    eq((await skus()).join(','), before.join(','), 'порядок после «−»')
    return 'порядок сохранён'
  })

  await check('прямой ввод количества в корзине не двигает строку', async () => {
    const skus = () => page.locator('[data-testid="cart-lines"] .cart-line')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-sku')))
    const before = await skus()
    await page.locator('[data-testid="cart-lines"] .cart-line').first()
      .locator('.stepper input').fill('4')
    await page.waitForTimeout(150)
    eq((await skus()).join(','), before.join(','), 'порядок после ввода')
    return 'порядок сохранён'
  })

  await check('изменение количества из каталога не двигает корзину', async () => {
    const skus = () => page.locator('[data-testid="cart-lines"] .cart-line')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-sku')))
    const before = await skus()
    // предыдущие проверки могли оставить выбранную рубрику — возвращаемся ко всему каталогу
    await page.locator('.chips .chip').first().click()
    await page.waitForTimeout(200)
    await T(page, 'search').fill('SHU-29')
    // ждём саму карточку, а не таймаут: список обновляется отложенно
    const card = page.locator('[data-testid="product-card"][data-sku="SHU-29"]')
    await card.waitFor({ state: 'visible' })
    await page.evaluate(() => window.scrollTo(0, 0))
    await card.locator('.stepper button').nth(1).click()
    await page.waitForTimeout(150)
    await T(page, 'search').fill('')
    await page.waitForTimeout(200)
    eq((await skus()).join(','), before.join(','), 'порядок после правки из каталога')
    return 'порядок сохранён'
  })

  // ── Excel ────────────────────────────────────────────────
  let templatePath = null
  await check('скачивание прайса-шаблона .xlsx', async () => {
    await T(page, 'open-excel').click()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      T(page, 'download-template').click(),
    ])
    templatePath = path.join(DOWNLOADS, download.suggestedFilename())
    await download.saveAs(templatePath)
    assert(existsSync(templatePath), 'файл не сохранён')
    const buf = await readFile(templatePath)
    assert(buf[0] === 0x50 && buf[1] === 0x4b, 'это не zip/xlsx')
    assert(!buf.includes(Buffer.from('<f>')), 'в выгрузке найдена формула')
    await page.locator('.modal-foot .btn').click()
    return `${download.suggestedFilename()}, ${(buf.length / 1024).toFixed(1)} КБ, формул нет`
  })

  await check('импорт заполненного шаблона даёт контрольный итог', async () => {
    // заполняем скачанный файл теми же количествами, что в контрольном списке
    const filled = path.join(DOWNLOADS, 'filled.xlsx')
    const { fillTemplate } = await import('./fill-template.mjs')
    await fillTemplate(templatePath, filled, {
      'SHU-47': 2, 'SHU-38': 1, 'SHU-32': 1, 'SHU-49': 1, 'SHU-10': 1,
    })

    await T(page, 'open-excel').click()
    await T(page, 'file-input').setInputFiles(filled)
    await page.waitForTimeout(400)
    eq(await page.locator('.preview-row.ok').count(), 5, 'распознанных строк из файла')
    await T(page, 'apply-replace').click()
    await page.waitForTimeout(150)
    await page.locator('.modal-foot .btn').click()
    const t = await totalsOf(page)
    eq(t.positions, '5', 'позиций')
    eq(t.packages, '6', 'упаковок')
    eq(t.weight, '1,154 кг', 'вес')
    eq(t.amount, '$206', 'сумма')
    return `экспорт → заполнение → импорт: ${t.positions} поз. / ${t.packages} упак. / ${t.weight} / ${t.amount}`
  })

  await check('импорт применяет те же проверки количества', async () => {
    const bad = path.join(DOWNLOADS, 'bad.xlsx')
    const { fillTemplate } = await import('./fill-template.mjs')
    await fillTemplate(templatePath, bad, { 'SHU-47': '0', 'SHU-38': '-2', 'SHU-32': '1,5' })
    await T(page, 'open-excel').click()
    await T(page, 'file-input').setInputFiles(bad)
    await page.waitForTimeout(400)
    eq(await page.locator('.preview-row.invalid_qty').count(), 3, 'строк с ошибкой количества')
    assert(await T(page, 'apply-replace').isDisabled(), 'применение доступно при нуле корректных строк')
    await page.locator('.modal-foot .btn').click()
    return '0, отрицательное и дробное отклонены и при импорте'
  })

  await check('посторонний файл отклоняется с понятной ошибкой', async () => {
    const junk = path.join(DOWNLOADS, 'junk.xlsx')
    await writeFile(junk, 'это не книга Excel')
    await T(page, 'open-excel').click()
    await T(page, 'file-input').setInputFiles(junk)
    await page.waitForTimeout(300)
    const note = await page.locator('.note-danger').innerText()
    assert(/Ошибка чтения/.test(note), note)
    await page.locator('.modal-foot .btn').click()
    return note.slice(0, 60)
  })

  // ── Повтор закупки ───────────────────────────────────────
  await check('сохранение и повтор набора', async () => {
    await T(page, 'open-paste').click()
    await T(page, 'paste-input').fill(CONTROL_LIST)
    await page.waitForTimeout(200)
    await T(page, 'apply-replace').click()
    await page.waitForTimeout(100)
    await page.locator('.modal-foot .btn').click()

    await T(page, 'open-cart').click()
    await page.waitForTimeout(150)
    await page.locator('.modal input[aria-label="Комментарий к сохраняемому набору"]').fill('Ежемесячная закупка')
    await page.locator('.modal [data-testid="save-set"]').click()
    await page.waitForTimeout(120)
    await page.locator('.modal-head button').click()

    // очищаем корзину и восстанавливаем из набора
    await T(page, 'open-cart').click()
    await page.waitForTimeout(150)
    await page.locator('.modal .btn-danger').click()
    await page.waitForTimeout(120)
    await page.locator('.modal-head button').click()
    // при пустой корзине блок итогов не отображается — смотрим счётчик в шапке
    eq(await page.locator('.cart-count').innerText(), '0', 'счётчик корзины после очистки')

    await T(page, 'open-sets').click()
    await page.waitForTimeout(150)
    eq(await page.locator('[data-testid="set-list"] .set-item').count(), 1, 'сохранённых наборов')
    await T(page, 'set-replace').click()
    await page.waitForTimeout(150)
    const note = await T(page, 'set-note').innerText()
    assert(/пересчитаны по снимку каталога/.test(note), `сообщение: ${note}`)
    await page.locator('.modal-foot .btn').click()
    const t = await totalsOf(page)
    eq(t.packages, '6', 'упаковок после повтора')
    eq(t.amount, '$206', 'сумма после повтора')
    return `набор восстановлен: ${t.positions} поз. / ${t.amount}`
  })

  await check('набор сохраняется без ввода названия', async () => {
    await T(page, 'open-paste').click()
    await T(page, 'paste-input').fill('SHU-32 — 2')
    await page.waitForTimeout(250)
    await T(page, 'apply-replace').click()
    await page.waitForTimeout(150)
    await page.locator('.modal-foot .btn').click()

    await T(page, 'open-cart').click()
    await page.waitForTimeout(200)
    // поля «название набора» больше нет — сохраняем как есть
    eq(await page.locator('.modal input[placeholder*="Название"]').count(), 0, 'полей «название набора»')
    await page.locator('.modal [data-testid="save-set"]').click()
    await page.waitForTimeout(200)
    await page.locator('.modal-head button').click()

    await T(page, 'open-sets').click()
    await page.waitForTimeout(250)
    const label = await page.locator('[data-testid="set-list"] .set-name').first().innerText()
    assert(/ХАО ХЭ/.test(label), `подпись набора не описывает состав: ${label}`)
    await page.locator('.modal-foot .btn').click()
    return `подпись сформирована сама: «${label}»`
  })

  await check('наборы переживают перезагрузку', async () => {
    await T(page, 'open-sets').click()
    await page.waitForTimeout(250)
    const before = await page.locator('[data-testid="set-list"] .set-item').count()
    assert(before > 0, 'до перезагрузки наборов нет')
    await page.locator('.modal-foot .btn').click()

    await page.reload({ waitUntil: 'networkidle' })
    await page.locator('[data-testid="product-card"]').first().waitFor()
    await T(page, 'open-sets').click()
    await page.waitForTimeout(250)
    const after = await page.locator('[data-testid="set-list"] .set-item').count()
    eq(after, before, 'наборов после перезагрузки')
    await page.locator('.modal-foot .btn').click()
    return `${after} набор(ов) сохранились между сессиями`
  })

  // ── Оформление ───────────────────────────────────────────
  await check('корзина наполнена перед оформлением', async () => {
    await T(page, 'open-paste').click()
    await T(page, 'paste-input').fill(CONTROL_LIST)
    await page.waitForTimeout(250)
    await T(page, 'apply-replace').click()
    await page.waitForTimeout(150)
    await page.locator('.modal-foot .btn').click()
    eq((await totalsOf(page)).amount, '$206', 'сумма перед оформлением')
    return 'контрольный заказ собран'
  })

  await check('оформление проверяет обязательные поля', async () => {
    await T(page, 'open-cart').click()
    await page.waitForTimeout(200)
    await page.locator('.modal [data-testid="to-checkout"]').click()
    await page.waitForTimeout(200)
    await T(page, 'checkout-submit').click()
    await page.waitForTimeout(150)
    const errors = await page.locator('.error-text').count()
    assert(errors >= 3, `сообщений об ошибках: ${errors}`)
    assert(await T(page, 'checkout-success').count() === 0, 'демонстрация завершилась при пустой форме')
    return `${errors} обязательных поля отмечены`
  })

  await check('оформление отклоняет неверную почту', async () => {
    await T(page, 'open-cart').click()
    await page.waitForTimeout(200)
    await page.locator('.modal [data-testid="to-checkout"]').click()
    await page.waitForTimeout(200)
    await page.locator('#co-email').fill('не-почта')
    await page.locator('#co-recipient').fill('Иванов Иван')
    await page.locator('#co-address').fill('190000, Санкт-Петербург, ул. Чайная, 7')
    await T(page, 'checkout-submit').click()
    await page.waitForTimeout(150)
    const err = await page.locator('.error-text').first().innerText()
    assert(await T(page, 'checkout-success').count() === 0, 'принята некорректная почта')
    return err
  })

  await check('демонстрационное оформление завершается экраном успеха', async () => {
    await T(page, 'open-cart').click()
    await page.waitForTimeout(200)
    await page.locator('.modal [data-testid="to-checkout"]').click()
    await page.waitForTimeout(200)
    await T(page, 'fill-sample').click()
    await page.waitForTimeout(120)
    await T(page, 'checkout-submit').click()
    await page.waitForTimeout(250)
    const text = await T(page, 'checkout-success').innerText()
    assert(/Настоящий заказ не создан/.test(text), 'нет явного указания, что заказ не создан')
    assert(/WooCommerce/.test(text), 'нет пояснения про отсутствие связи с магазином')
    await page.screenshot({ path: path.join(SHOTS, '04-checkout-success.png') })
    return 'экран успеха явно помечен как демонстрация'
  })

  await check('персональные данные не попали в localStorage', async () => {
    const dump = await page.evaluate(() => JSON.stringify(localStorage))
    for (const needle of ['demo@example.com', 'Иванов', 'Чайная', '190000']) {
      assert(!dump.includes(needle), `в localStorage найдено «${needle}»`)
    }
    const keys = await page.evaluate(() => Object.keys(localStorage))
    return `ключи: ${keys.join(', ')} — только товары и количества`
  })

  await check('в консоли нет ошибок', async () => {
    const real = consoleErrors.filter((e) => !/favicon/i.test(e))
    assert(real.length === 0, real.slice(0, 3).join(' | '))
    return 'чисто'
  })

  activePage = null
  await desktop.close()

  // ── Мобильная ширина ─────────────────────────────────────
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  const m = await mobile.newPage()
  await m.goto(base, { waitUntil: 'networkidle' })
  await m.locator('[data-testid="product-card"]').first().waitFor()
  activePage = m

  await check('мобильная ширина 390 px: нет горизонтальной прокрутки', async () => {
    const overflow = await m.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    assert(overflow <= 1, `переполнение по ширине ${overflow} px`)
    await m.screenshot({ path: path.join(SHOTS, '05-catalog-mobile.png'), fullPage: false })
    return 'переполнения нет'
  })

  await check('мобильная: сборка заказа и нижняя панель', async () => {
    await T(m, 'search').fill('SHU-47')
    await m.waitForTimeout(150)
    await T(m, 'product-card').first().locator('.stepper button').nth(1).click()
    await m.waitForTimeout(120)
    const bar = await m.locator('.mobile-bar').isVisible()
    assert(bar, 'нижняя панель корзины не видна')
    const sum = await m.locator('.mobile-bar-sum').innerText()
    eq(sum, '$30', 'сумма в нижней панели')
    return `нижняя панель показывает ${sum}`
  })

  await check('мобильная: корзина открывается на весь экран', async () => {
    await T(m, 'mobile-cart').click()
    await m.waitForTimeout(250)
    const lines = await m.locator('.modal [data-testid="cart-lines"] .cart-line').count()
    eq(lines, 1, 'строк в корзине')
    const overflow = await m.evaluate(() => {
      const el = document.querySelector('.modal')
      return el ? el.scrollWidth - el.clientWidth : 0
    })
    assert(overflow <= 1, `переполнение корзины ${overflow} px`)
    await m.screenshot({ path: path.join(SHOTS, '06-cart-mobile.png') })
    await m.locator('.modal-head button').click()
    return 'корзина читается без горизонтальной прокрутки'
  })

  await check('мобильная: вставка списка работает', async () => {
    await T(m, 'open-paste').click()
    await T(m, 'paste-input').fill(CONTROL_LIST)
    await m.waitForTimeout(250)
    eq(await m.locator('.preview-row.ok').count(), 5, 'распознанных строк')
    await m.screenshot({ path: path.join(SHOTS, '07-paste-mobile.png') })
    await T(m, 'apply-replace').click()
    await m.waitForTimeout(150)
    await m.locator('.modal-foot .btn').click()
    const sum = await m.locator('.mobile-bar-sum').innerText()
    eq(sum, '$206', 'сумма после вставки')
    return `итог ${sum}`
  })

  activePage = null
  await mobile.close()

  // ── Скриншот предпросмотра на десктопе ───────────────────
  const shot = await browser.newContext({ viewport: { width: 1440, height: 950 } })
  const sp = await shot.newPage()
  await sp.goto(base, { waitUntil: 'networkidle' })
  await sp.locator('[data-testid="product-card"]').first().waitFor()
  await T(sp, 'open-paste').click()
  await T(sp, 'paste-input').fill(`1. БА — 2 шт.
2. Инь Чжень — 1 шт.
3. ХАО ХЭ — 1 шт.
4. Лапсанг Сушонг 2077 — 1
5. БА — 1 шт.
6. ДИСК БИ — 0`)
  await sp.waitForTimeout(350)
  await sp.screenshot({ path: path.join(SHOTS, '03-paste-preview.png') })
  await shot.close()

  await browser.close()
  server.close()

  const pass = results.filter((r) => r.status === 'PASS').length
  const fail = results.filter((r) => r.status === 'FAIL').length
  console.log(`\n${'─'.repeat(60)}\nИТОГО: PASS ${pass} · FAIL ${fail} · всего ${results.length}`)
  await writeFile(
    path.join(ROOT, 'qa', 'browser-qa-report.json'),
    JSON.stringify({ ranAt: new Date().toISOString(), pass, fail, results }, null, 1),
  )
  console.log(`Отчёт: qa/browser-qa-report.json · скриншоты: qa/screenshots/`)
  if (fail > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error(`Сбой проверки${currentName ? ` на шаге «${currentName}»` : ''}:`, e)
  process.exit(1)
})
