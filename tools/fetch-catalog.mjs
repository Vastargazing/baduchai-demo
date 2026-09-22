/**
 * Строит снимок каталога из ПУБЛИЧНОГО WooCommerce Store API магазина baduchai.ru.
 *
 * Только чтение. Корзина и заказы исходного магазина не затрагиваются,
 * cookies и админские данные не используются. robots.txt на 22.09.2026: "Disallow:" (пусто).
 *
 * Запуск: npm run catalog:fetch
 * Результат: src/data/catalog.json + public/img/<sku>.webp
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'

const run = promisify(execFile)
const ROOT = path.resolve(import.meta.dirname, '..')
const API = 'https://baduchai.ru/wp-json/wc/store/v1'
const TEA_CATEGORY = 39 // «ЧАЙ»
const UA = 'baduchai-demo-prototype/1.0 (single-pass catalog snapshot; contact: repo owner)'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** «ЧАЙ» — это корневая рубрика; для фильтра нужна конкретная подкатегория. */
const ROOT_CATEGORY_NAME = 'ЧАЙ'

const stripTags = (s) =>
  (s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8212;/g, '—')
    .replace(/&#171;/g, '«')
    .replace(/&#187;/g, '»')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#036;/g, '$')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const CJK = /[㐀-鿿豈-﫿　-〿]/gu
const stripCjk = (s) => s.replace(CJK, ' ').replace(/\s+/g, ' ').trim()

/** Фасовка из опубликованного текста. Ничего не выдумываем: нет текста — нет веса. */
const WEIGHT_RE = /(\d+(?:[.,]\d+)?)\s*(килограмм\w*|кг|граммов|грамма|грамм|гр|г)(?![а-яёa-z])/iu

function parsePack(product) {
  const short = stripTags(product.short_description)
  const name = product.name

  // «7 блинчиков по 8 гр» / «Цена за 1 тун 56г» — итоговый вес туна указан в short_description.
  const sources = [
    { text: short, from: 'short_description' },
    { text: name, from: 'name' },
  ]
  for (const { text, from } of sources) {
    const m = text.match(WEIGHT_RE)
    if (!m) continue
    const value = parseFloat(m[1].replace(',', '.'))
    const unit = m[2].toLowerCase()
    const grams = /^(кг|килограмм)/.test(unit) ? Math.round(value * 1000) : Math.round(value)
    return { weight_g: grams, pack_label: short || `${grams} г`, weight_source: from }
  }
  // Последний источник — текст описания, но только если он называет ровно один
  // вес. При нескольких числах («блин 8 г, тун 56 г») угадывать нельзя.
  const desc = stripTags(product.description)
  const found = [...desc.matchAll(new RegExp(WEIGHT_RE.source, 'giu'))]
  const distinct = new Set(
    found.map((m) => {
      const v = parseFloat(m[1].replace(',', '.'))
      return /^(кг|килограмм)/i.test(m[2]) ? Math.round(v * 1000) : Math.round(v)
    }),
  )
  if (distinct.size === 1) {
    const grams = [...distinct][0]
    return { weight_g: grams, pack_label: short || `${grams} г`, weight_source: 'description' }
  }

  return { weight_g: null, pack_label: short || null, weight_source: null }
}

/** Единица продажи — то, что покупатель кладёт в корзину. Всегда штучная упаковка. */
function sellUnit(name, packLabel) {
  const hay = `${name} ${packLabel || ''}`.toLowerCase()
  if (/(?<![а-яё])тун(?![а-яё])/.test(hay)) return 'тун'
  if (/блинчик/.test(hay)) return 'блинчик'
  if (/блин/.test(hay)) return 'блин'
  if (/кирпич/.test(hay)) return 'кирпич'
  if (/плитка|плитк/.test(hay)) return 'плитка'
  if (/мешочек/.test(hay)) return 'мешочек'
  return 'упаковка'
}

/** Короткое имя: ведущий блок ПРОПИСНЫХ слов, иначе — имя без служебных слов. */
const DESCRIPTORS =
  /\s+(?:рассыпн[а-яё]*|блинчик[а-яё]*|блин[а-яё]*|кирпич[а-яё]*|плитк[а-яё]*|в таблетках|мешоч[а-яё]*|шу\s*пу\s*-?\s*эр[а-яё]*|шен\s*пу\s*-?\s*эр[а-яё]*|шэн\s*пу\s*-?\s*эр[а-яё]*|пу\s*-?\s*эр[а-яё]*)(?![а-яё])/giu

function shortName(name) {
  const clean = stripCjk(stripTags(name))
    .replace(/№\s*\d+/g, (m) => m.replace(/\s+/g, ' ')) // «ПУ ЭР № 7» сохраняем
  const words = clean.split(/\s+/).filter(Boolean)

  const isUpper = (w) => /^[А-ЯЁA-Z][А-ЯЁA-Z\-]*$/u.test(w)
  let n = 0
  while (n < words.length && isUpper(words[n])) n++
  // «ПУ ЭР № 7» → ведущий блок + номер
  if (n > 0 && words[n] === '№' && words[n + 1]) n += 2

  // Ведущий блок прописных берём только если дальше идёт служебное слово,
  // число или конец строки. Иначе «У И Ба Сянь» обрезалось бы до «У И».
  const next = words[n]
  const blockEnds = next === undefined || /^[0-9«(]/u.test(next) || /^[а-яёa-z]/u.test(next)
  if (n > 0 && blockEnds && words.slice(0, n).join(' ').length >= 2) {
    return words.slice(0, n).join(' ').trim()
  }

  let s = clean.replace(DESCRIPTORS, ' ').replace(WEIGHT_RE, ' ').replace(/\s+/g, ' ').trim()
  s = s.replace(/\s+\d{4}\s*г?\.?$/u, '').trim() // хвостовой год
  return s || clean
}

/** Псевдонимы для поиска и разбора вставленного списка. */
function buildAliases(p, short, cats) {
  const out = new Set()
  const add = (v) => {
    const s = stripTags(String(v || '')).trim()
    if (s.length >= 2) out.add(s)
  }
  add(short)
  add(p.sku)
  add(stripCjk(p.name))
  // китайское название как отдельный псевдоним
  const cjk = (p.name.match(CJK) || []).join('').trim()
  if (cjk.length >= 2) out.add(cjk)
  // имя без служебных слов и веса
  add(stripCjk(p.name).replace(DESCRIPTORS, ' ').replace(WEIGHT_RE, ' ').replace(/\s+/g, ' ').trim())
  // слитное написание короткого имени («ХАОХЭ», «ДИСКБИ»)
  if (/\s/.test(short)) add(short.replace(/\s+/g, ''))
  add(short.replace(/Ё/g, 'Е').replace(/ё/g, 'е'))
  out.delete('')
  return [...out]
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return res.json()
}

async function downloadImage(product, sku) {
  const img = product.images?.[0]
  if (!img) return { image: null, image_note: 'изображение не опубликовано' }
  const safe = sku.replace(/[^\w\-]/g, '_')
  const outWebp = path.join(ROOT, 'public', 'img', `${safe}.webp`)
  if (existsSync(outWebp)) return { image: `img/${safe}.webp`, image_note: null }

  // берём опубликованную превью-версию (300x300), а не полноразмерный файл
  const src = img.thumbnail || img.src
  const res = await fetch(src, { headers: { 'User-Agent': UA } })
  if (!res.ok) return { image: null, image_note: `HTTP ${res.status} при загрузке изображения` }
  const buf = Buffer.from(await res.arrayBuffer())
  const tmp = path.join(ROOT, 'public', 'img', `${safe}.src`)
  await writeFile(tmp, buf)
  await run('magick', [tmp, '-resize', '400x400>', '-strip', '-quality', '72', outWebp])
  await run('rm', ['-f', tmp])
  return { image: `img/${safe}.webp`, image_note: null }
}

async function main() {
  const fetched_at = new Date().toISOString()
  await mkdir(path.join(ROOT, 'public', 'img'), { recursive: true })

  console.log('→ категории')
  const cats = await fetchJson(`${API}/products/categories?per_page=100`)
  await sleep(700)

  console.log('→ товары рубрики ЧАЙ')
  const raw = await fetchJson(`${API}/products?category=${TEA_CATEGORY}&per_page=100&page=1`)
  console.log(`  получено: ${raw.length}`)

  await writeFile(path.join(ROOT, 'tools', 'raw-store-api.json'), JSON.stringify(raw, null, 1))

  const products = []
  const notes = []
  for (const [i, p] of raw.entries()) {
    const pack = parsePack(p)
    const short = shortName(p.name)
    const catNames = p.categories.map((c) => c.name)
    const primary = catNames.find((c) => c !== ROOT_CATEGORY_NAME) || ROOT_CATEGORY_NAME

    process.stdout.write(`  [${i + 1}/${raw.length}] ${p.sku} `)
    const { image, image_note } = await downloadImage(p, p.sku)
    process.stdout.write(image ? 'img✓\n' : `img✗ (${image_note})\n`)
    if (image_note) notes.push({ sku: p.sku, note: image_note })
    if (pack.weight_g === null) notes.push({ sku: p.sku, note: 'вес не опубликован' })

    products.push({
      source_id: p.id,
      sku: p.sku || null,
      name_full: stripTags(p.name),
      name_short: short,
      category: primary,
      categories_all: catNames,
      pack_label: pack.pack_label,
      weight_g: pack.weight_g,
      weight_source: pack.weight_source,
      unit: sellUnit(p.name, pack.pack_label),
      price_minor: Number(p.prices.price),
      currency: p.prices.currency_code,
      currency_symbol: p.prices.currency_symbol,
      currency_minor_unit: p.prices.currency_minor_unit,
      in_stock: Boolean(p.is_in_stock),
      stock_label: p.is_in_stock ? 'В наличии' : 'Нет в наличии',
      purchasable: Boolean(p.is_purchasable),
      url: p.permalink,
      description: stripTags(p.description).slice(0, 600),
      short_description: stripTags(p.short_description),
      image,
      aliases: buildAliases(p, short, catNames),
      fetched_at,
    })
    await sleep(250) // щадящий темп
  }

  // Диагностика реальных расхождений в исходных данных
  const skuIndex = new Map()
  for (const p of products) {
    const key = (p.sku || '').toUpperCase().replace(/О/g, 'O').replace(/А/g, 'A').replace(/Е/g, 'E')
    if (!skuIndex.has(key)) skuIndex.set(key, [])
    skuIndex.get(key).push(p.sku + ' / ' + p.name_short + ' / id ' + p.source_id)
  }
  const collisions = [...skuIndex].filter(([, v]) => v.length > 1)

  const categories = [...new Set(products.map((p) => p.category))].sort((a, b) =>
    a.localeCompare(b, 'ru'),
  )

  const snapshot = {
    meta: {
      source: 'https://baduchai.ru/ (публичный WooCommerce Store API /wp-json/wc/store/v1)',
      source_category: 'ЧАЙ (id 39) со всеми подрубриками',
      fetched_at,
      product_count: products.length,
      method: 'один запрос списка категорий + один запрос списка товаров + по одному запросу превью-изображения',
      robots_txt: 'User-Agent: * / Disallow: (пусто) — ограничений на чтение нет',
      notes,
      sku_collisions: collisions.map(([key, v]) => ({ normalized: key, items: v })),
      known_categories: cats.filter((c) => products.some((p) => p.category === c.name)).map((c) => ({ id: c.id, name: c.name, site_count: c.count })),
    },
    categories,
    products,
  }

  await mkdir(path.join(ROOT, 'src', 'data'), { recursive: true })
  await writeFile(path.join(ROOT, 'src', 'data', 'catalog.json'), JSON.stringify(snapshot, null, 1))
  console.log(`\n✓ ${products.length} товаров, ${categories.length} категорий`)
  console.log(`✓ коллизии артикулов: ${collisions.length}`)
  collisions.forEach(([k, v]) => console.log(`   ${k}: ${v.join(' | ')}`))
  console.log(`✓ товаров без опубликованного веса: ${products.filter((p) => p.weight_g === null).length}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
