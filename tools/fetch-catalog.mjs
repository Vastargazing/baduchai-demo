/**
 * Строит снимок каталога из ПУБЛИЧНОГО WooCommerce Store API магазина baduchai.ru.
 *
 * Только чтение. Корзина и заказы исходного магазина не затрагиваются,
 * cookies и админские данные не используются. robots.txt на 22.09.2026: "Disallow:" (пусто).
 *
 * Запуск: npm run catalog:fetch
 * Результат: public/catalog.json + public/img/<sku|id>.webp
 *
 * Снимок кладётся в public/, а не в src/: файл большой, и подгружать его
 * отдельно быстрее, чем вшивать в основной бандл.
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'

const run = promisify(execFile)
const ROOT = path.resolve(import.meta.dirname, '..')
const API = 'https://baduchai.ru/wp-json/wc/store/v1'
const UA = 'baduchai-demo-prototype/1.0 (catalog snapshot for a demo site; single pass, throttled)'
const TEA_ROOT_SLUG = 'chaj'
const PAGE_DELAY = 800
const IMAGE_DELAY = 120

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const stripTags = (s) =>
  (s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8212;/g, '—')
    .replace(/&#8211;/g, '–')
    .replace(/&#171;/g, '«')
    .replace(/&#187;/g, '»')
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#8230;/g, '…')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/g, "'")
    .replace(/&#036;/g, '$')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const CJK = /[㐀-鿿豈-﫿　-〿]/gu
const stripCjk = (s) => s.replace(CJK, ' ').replace(/\s+/g, ' ').trim()

/** \b и \w не работают с кириллицей — границы задаём явными классами. */
const WEIGHT_RE =
  /(\d+(?:[.,]\d+)?)\s*(килограмм[а-яё]*|кг|граммов|грамма|грамм|гр|г)(?![а-яёa-z])/iu

const DESCRIPTORS =
  /\s+(?:рассыпн[а-яё]*|блинчик[а-яё]*|блин[а-яё]*|кирпич[а-яё]*|плитк[а-яё]*|в таблетках|мешоч[а-яё]*|шу\s*пу\s*-?\s*эр[а-яё]*|шен\s*пу\s*-?\s*эр[а-яё]*|шэн\s*пу\s*-?\s*эр[а-яё]*|пу\s*-?\s*эр[а-яё]*)(?![а-яё])/giu

/**
 * Фасовка из опубликованного текста. Ничего не выдумываем.
 * Вес ищем только у чая: для чайника или браслета «фасовка» — это штука,
 * и вес там не является единицей продажи.
 */
function parsePack(product, isTea) {
  const short = stripTags(product.short_description)
  if (!isTea) {
    return { weight_g: null, pack_label: short || '1 шт.', weight_source: null }
  }

  for (const [text, from] of [
    [short, 'short_description'],
    [product.name, 'name'],
  ]) {
    const m = text.match(WEIGHT_RE)
    if (!m) continue
    const value = parseFloat(m[1].replace(',', '.'))
    const grams = /^(кг|килограмм)/i.test(m[2]) ? Math.round(value * 1000) : Math.round(value)
    return { weight_g: grams, pack_label: short || `${grams} г`, weight_source: from }
  }

  // Последний источник — текст описания, но только если он называет ровно один
  // вес. При нескольких числах («блин 8 г, тун 56 г») угадывать нельзя.
  const desc = stripTags(product.description)
  const distinct = new Set(
    [...desc.matchAll(new RegExp(WEIGHT_RE.source, 'giu'))].map((m) => {
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

/** Единица продажи — то, что покупатель кладёт в корзину. */
function sellUnit(name, packLabel, isTea) {
  const hay = `${name} ${packLabel || ''}`.toLowerCase()
  if (/(?<![а-яё])тун(?![а-яё])/.test(hay)) return 'тун'
  if (/блинчик/.test(hay)) return 'блинчик'
  if (/блин/.test(hay)) return 'блин'
  if (/кирпич/.test(hay)) return 'кирпич'
  if (/плитка|плитк/.test(hay)) return 'плитка'
  if (/мешочек/.test(hay)) return 'мешочек'
  return isTea ? 'упаковка' : 'шт.'
}

/** Короткое имя: ведущий блок ПРОПИСНЫХ слов, иначе — имя без служебных слов. */
function shortName(name) {
  const clean = stripCjk(stripTags(name))
  const words = clean.split(/\s+/).filter(Boolean)
  if (!words.length) return clean

  const isUpper = (w) => /^[А-ЯЁA-Z][А-ЯЁA-Z\-]*$/u.test(w)
  let n = 0
  while (n < words.length && isUpper(words[n])) n++
  if (n > 0 && words[n] === '№' && words[n + 1]) n += 2

  // Ведущий блок прописных берём только если дальше идёт служебное слово,
  // число или конец строки. Иначе «У И Ба Сянь» обрезалось бы до «У И».
  const next = words[n]
  const blockEnds = next === undefined || /^[0-9«(]/u.test(next) || /^[а-яёa-z]/u.test(next)
  if (n > 0 && blockEnds && words.slice(0, n).join(' ').length >= 2) {
    return words.slice(0, n).join(' ').trim()
  }

  let s = clean.replace(DESCRIPTORS, ' ').replace(WEIGHT_RE, ' ').replace(/\s+/g, ' ').trim()
  s = s.replace(/\s+\d{4}\s*г?\.?$/u, '').trim()
  return s || clean
}

/** Псевдонимы для поиска и разбора вставленного списка. */
function buildAliases(p, short) {
  const out = new Set()
  const add = (v) => {
    const s = stripTags(String(v || '')).trim()
    if (s.length >= 2) out.add(s)
  }
  add(short)
  add(p.sku)
  add(stripCjk(p.name))
  const cjk = (p.name.match(CJK) || []).join('').trim()
  if (cjk.length >= 2) out.add(cjk)
  add(stripCjk(p.name).replace(DESCRIPTORS, ' ').replace(WEIGHT_RE, ' ').replace(/\s+/g, ' ').trim())
  if (/\s/.test(short)) add(short.replace(/\s+/g, ''))
  add(short.replace(/Ё/g, 'Е').replace(/ё/g, 'е'))
  out.delete('')
  return [...out]
}

async function fetchJson(url, attempt = 1) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return await res.json()
  } catch (e) {
    if (attempt >= 3) throw new Error(`${e.message} for ${url}`)
    await sleep(2000 * attempt)
    return fetchJson(url, attempt + 1)
  }
}

async function downloadImage(product, key) {
  const img = product.images?.[0]
  if (!img) return { image: null, note: 'изображение не опубликовано' }
  const safe = key.replace(/[^\w\-]/g, '_')
  const outWebp = path.join(ROOT, 'public', 'img', `${safe}.webp`)
  if (existsSync(outWebp)) return { image: `img/${safe}.webp`, note: null, cached: true }

  try {
    const res = await fetch(img.thumbnail || img.src, { headers: { 'User-Agent': UA } })
    if (!res.ok) return { image: null, note: `HTTP ${res.status} при загрузке изображения` }
    const tmp = path.join(ROOT, 'public', 'img', `${safe}.src`)
    await writeFile(tmp, Buffer.from(await res.arrayBuffer()))
    await run('magick', [tmp, '-resize', '400x400>', '-strip', '-quality', '70', outWebp])
    await run('rm', ['-f', tmp])
    return { image: `img/${safe}.webp`, note: null }
  } catch (e) {
    return { image: null, note: `сбой загрузки изображения: ${e.message}` }
  }
}

async function main() {
  const fetched_at = new Date().toISOString()
  await mkdir(path.join(ROOT, 'public', 'img'), { recursive: true })

  console.log('→ категории')
  const rawCats = await fetchJson(`${API}/products/categories?per_page=100`)
  const catById = new Map(rawCats.map((c) => [c.id, c]))

  const pathOf = (id) => {
    const out = []
    let cur = catById.get(id)
    const guard = new Set()
    while (cur && !guard.has(cur.id)) {
      guard.add(cur.id)
      out.unshift(cur)
      cur = cur.parent ? catById.get(cur.parent) : null
    }
    return out
  }
  const teaRoot = rawCats.find((c) => c.slug === TEA_ROOT_SLUG)
  const isTeaCategory = (id) => pathOf(id).some((c) => c.id === teaRoot?.id)

  await sleep(PAGE_DELAY)

  console.log('→ товары (постранично)')
  const raw = []
  for (let page = 1; page <= 40; page++) {
    const batch = await fetchJson(`${API}/products?per_page=100&page=${page}&orderby=title&order=asc`)
    if (!batch.length) break
    raw.push(...batch)
    console.log(`  страница ${page}: +${batch.length} (всего ${raw.length})`)
    if (batch.length < 100) break
    await sleep(PAGE_DELAY)
  }

  console.log(`→ изображения (${raw.length})`)
  const products = []
  const notes = []
  for (const [i, p] of raw.entries()) {
    const catIds = p.categories.map((c) => c.id)
    const isTea = catIds.some(isTeaCategory)

    // Самая глубокая категория товара — по ней он показывается и фильтруется.
    let deepest = null
    for (const id of catIds) {
      const chain = pathOf(id)
      if (!deepest || chain.length > deepest.length) deepest = chain
    }
    const chain = deepest ?? []
    if (!chain.length) {
      notes.push({ sku: p.sku || String(p.id), note: 'товар без категории' })
    }

    const pack = parsePack(p, isTea)
    const key = p.sku || `id-${p.id}`

    // В каталоге магазина встречается товар с пустым названием — не придумываем
    // его, а показываем артикул и фиксируем расхождение в отчёте.
    const nameFull = stripTags(p.name) || key
    if (!stripTags(p.name)) {
      notes.push({ sku: key, note: 'в магазине у товара пустое название — показан артикул' })
    }
    const short = shortName(p.name) || key

    const { image, note, cached } = await downloadImage(p, key)
    if (note) notes.push({ sku: key, note })
    if (isTea && pack.weight_g === null) notes.push({ sku: key, note: 'вес чая не опубликован' })

    if ((i + 1) % 50 === 0 || i === raw.length - 1) {
      console.log(`  ${i + 1}/${raw.length}`)
    }

    products.push({
      source_id: p.id,
      sku: p.sku || null,
      name_full: nameFull,
      name_short: short,
      category: chain.at(-1)?.name ?? 'Без категории',
      category_id: chain.at(-1)?.id ?? null,
      category_path: chain.map((c) => c.name),
      category_ids: [...new Set(chain.map((c) => c.id))],
      top_category: chain[0]?.name ?? 'Без категории',
      is_tea: isTea,
      pack_label: pack.pack_label,
      weight_g: pack.weight_g,
      weight_source: pack.weight_source,
      /** Вес ожидается только у чая: для предметов он не является единицей продажи. */
      weight_expected: isTea,
      unit: sellUnit(p.name, pack.pack_label, isTea),
      price_minor: Number(p.prices.price),
      currency: p.prices.currency_code,
      currency_symbol: p.prices.currency_symbol,
      currency_minor_unit: p.prices.currency_minor_unit,
      in_stock: Boolean(p.is_in_stock),
      stock_label: p.is_in_stock ? 'В наличии' : 'Нет в наличии',
      purchasable: Boolean(p.is_purchasable),
      url: p.permalink,
      description: stripTags(p.description).slice(0, 500),
      short_description: stripTags(p.short_description),
      image,
      aliases: buildAliases(p, short),
      fetched_at,
    })

    if (!cached) await sleep(IMAGE_DELAY)
  }

  // Дерево категорий, в котором реально есть товары
  const used = new Set(products.flatMap((p) => p.category_ids))
  const tree = rawCats
    .filter((c) => used.has(c.id) && c.slug !== 'uncategorized')
    .map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      parent: c.parent || null,
      count: products.filter((p) => p.category_ids.includes(c.id)).length,
    }))
    .sort((a, b) => b.count - a.count)

  // Реальные расхождения исходных данных
  const skuIndex = new Map()
  for (const p of products) {
    if (!p.sku) continue
    const key = p.sku.toUpperCase().replace(/[А-ЯЁ]/gu, (ch) =>
      ({ А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X' })[ch] ?? ch,
    ).replace(/[^A-Z0-9]/g, '')
    if (!skuIndex.has(key)) skuIndex.set(key, [])
    skuIndex.get(key).push(`${p.sku} / ${p.name_short} / id ${p.source_id}`)
  }
  const collisions = [...skuIndex].filter(([, v]) => v.length > 1)
  const noSku = products.filter((p) => !p.sku)
  const teaNoWeight = products.filter((p) => p.weight_expected && p.weight_g === null)

  const snapshot = {
    meta: {
      source: 'https://baduchai.ru/ (публичный WooCommerce Store API /wp-json/wc/store/v1)',
      source_scope: 'весь публичный каталог магазина, все категории',
      fetched_at,
      product_count: products.length,
      category_count: tree.length,
      method: `постраничный список товаров (по 100, пауза ${PAGE_DELAY} мс) + по одному запросу превью-изображения (пауза ${IMAGE_DELAY} мс), без параллельного обхода`,
      robots_txt: 'User-Agent: * / Disallow: (пусто) — ограничений на чтение нет',
      notes,
      sku_collisions: collisions.map(([key, v]) => ({ normalized: key, items: v })),
      products_without_sku: noSku.length,
      tea_without_weight: teaNoWeight.map((p) => `${p.sku ?? p.source_id} (${p.name_short})`),
    },
    categories: tree,
    products,
  }

  await writeFile(path.join(ROOT, 'public', 'catalog.json'), JSON.stringify(snapshot))
  await writeFile(path.join(ROOT, 'tools', 'raw-store-api.json'), JSON.stringify(raw))

  console.log(`\n✓ ${products.length} товаров, ${tree.length} категорий`)
  console.log(`✓ без артикула: ${noSku.length}`)
  console.log(`✓ чай без опубликованного веса: ${teaNoWeight.length}`)
  console.log(`✓ коллизии артикулов: ${collisions.length}`)
  console.log(`✓ без изображения: ${products.filter((p) => !p.image).length}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
