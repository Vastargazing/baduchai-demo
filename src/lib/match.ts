import type { Product, MatchResult } from './types'
import { normSku, normName, normCjk, looksLikeSku, levenshtein, fuzzyThreshold } from './text'

export interface ProductIndex {
  products: Product[]
  bySku: Map<string, Product[]>
  byName: Map<string, Product[]>
  byAlias: Map<string, Product[]>
  byCjk: Map<string, Product[]>
}

function push<K>(map: Map<K, Product[]>, key: K, p: Product) {
  const cur = map.get(key)
  if (cur) cur.push(p)
  else map.set(key, [p])
}

export function buildIndex(products: Product[]): ProductIndex {
  const bySku = new Map<string, Product[]>()
  const byName = new Map<string, Product[]>()
  const byAlias = new Map<string, Product[]>()
  const byCjk = new Map<string, Product[]>()
  for (const p of products) {
    const cjk = normCjk(p.name_full)
    if (cjk.length >= 2) push(byCjk, cjk, p)
    if (p.sku) push(bySku, normSku(p.sku), p)
    push(byName, normName(p.name_short), p)
    const full = normName(p.name_full)
    if (full !== normName(p.name_short)) push(byName, full, p)
    for (const a of p.aliases) {
      const key = normName(a)
      if (key) push(byAlias, key, p)
    }
  }
  return { products, bySku, byName, byAlias, byCjk }
}

interface Searchable {
  name: string
  full: string
  aliases: string
  sku: string
}

/**
 * Нормализованные поля считаются один раз на товар: без кеша каждый запрос
 * прогонял регулярные выражения по всему каталогу заново.
 */
const searchableCache = new Map<number, Searchable>()

function searchable(p: Product): Searchable {
  const hit = searchableCache.get(p.source_id)
  if (hit) return hit
  const value: Searchable = {
    name: normName(p.name_short),
    full: normName(p.name_full),
    aliases: p.aliases.map(normName).join(' '),
    sku: p.sku ? normSku(p.sku) : '',
  }
  searchableCache.set(p.source_id, value)
  return value
}

const uniq = (list: Product[]) => [...new Map(list.map((p) => [p.source_id, p])).values()]

/**
 * Сопоставляет произвольную строку с товаром каталога.
 *
 * Порядок: артикул → точное название → псевдоним → подстрока → опечатка.
 * Несколько кандидатов на одном уровне — это 'ambiguous', выбор остаётся за человеком.
 * Нечёткое совпадение возвращается как 'fuzzy' и тоже требует подтверждения.
 */
export function matchProduct(index: ProductIndex, rawQuery: string): MatchResult {
  const query = rawQuery.trim()
  if (!query) return { kind: 'not_found', candidates: [] }

  // 1. Артикул
  if (looksLikeSku(query)) {
    const hits = index.bySku.get(normSku(query))
    if (hits?.length === 1) return { kind: 'exact', candidates: [hits[0]], via: 'sku' }
    if (hits && hits.length > 1) return { kind: 'ambiguous', candidates: uniq(hits), via: 'sku' }
  }

  // 2. Иероглифическое название
  const cjk = normCjk(query)
  if (cjk.length >= 2) {
    const hits = index.byCjk.get(cjk)
    if (hits?.length === 1) return { kind: 'exact', candidates: [hits[0]], via: 'alias' }
    if (hits && hits.length > 1) return { kind: 'ambiguous', candidates: uniq(hits), via: 'alias' }
  }

  const key = normName(query)
  if (!key) return { kind: 'not_found', candidates: [] }

  // 3. Точное название
  const byName = index.byName.get(key)
  if (byName?.length === 1) return { kind: 'exact', candidates: [byName[0]], via: 'name' }
  if (byName && byName.length > 1) return { kind: 'ambiguous', candidates: uniq(byName), via: 'name' }

  // 4. Псевдоним
  const byAlias = index.byAlias.get(key)
  if (byAlias?.length === 1) return { kind: 'exact', candidates: [byAlias[0]], via: 'alias' }
  if (byAlias && byAlias.length > 1)
    return { kind: 'ambiguous', candidates: uniq(byAlias), via: 'alias' }

  // 5. Артикул без «похоже на артикул» (например, «shu47» внутри длинной строки)
  const skuHits = index.bySku.get(normSku(query))
  if (skuHits?.length === 1) return { kind: 'exact', candidates: [skuHits[0]], via: 'sku' }
  if (skuHits && skuHits.length > 1)
    return { kind: 'ambiguous', candidates: uniq(skuHits), via: 'sku' }

  // 6. Подстрока — уже не точное совпадение, подтверждаем у человека
  const glued = key.split(' ').join('')
  const sub = index.products.filter((p) => {
    const { name, full } = searchable(p)
    return `${name} ${full}`.includes(key) || name.split(' ').join('') === glued
  })
  if (sub.length === 1) return { kind: 'fuzzy', candidates: sub, via: 'fuzzy' }
  if (sub.length > 1) return { kind: 'ambiguous', candidates: uniq(sub).slice(0, 8), via: 'fuzzy' }

  // 7. Опечатка
  const limit = fuzzyThreshold(key.length)
  if (limit > 0) {
    const scored: { p: Product; d: number }[] = []
    for (const p of index.products) {
      const { name, full } = searchable(p)
      const d = Math.min(levenshtein(key, name, limit), levenshtein(key, full, limit))
      if (d <= limit) scored.push({ p, d })
    }
    scored.sort((a, b) => a.d - b.d)
    const best = scored.filter((s) => s.d === scored[0]?.d)
    if (best.length === 1) return { kind: 'fuzzy', candidates: [best[0].p], via: 'fuzzy' }
    if (best.length > 1)
      return { kind: 'ambiguous', candidates: uniq(best.map((s) => s.p)).slice(0, 8), via: 'fuzzy' }
  }

  return { kind: 'not_found', candidates: [] }
}


/** Живой поиск по каталогу: название, артикул, псевдонимы. */
export function searchProducts(products: Product[], rawQuery: string): Product[] {
  const query = rawQuery.trim()
  if (!query) return products
  const key = normName(query)
  const skuKey = normSku(query)
  const terms = key.split(' ').filter(Boolean)

  const scored: { p: Product; score: number }[] = []
  for (const p of products) {
    const { name, full, aliases, sku } = searchable(p)
    const hay = `${name} ${full} ${aliases}`

    let score = 0
    if (sku && sku === skuKey) score = 100
    else if (name === key) score = 90
    else if (sku && skuKey.length >= 2 && sku.includes(skuKey)) score = 80
    else if (name.startsWith(key)) score = 70
    else if (hay.includes(key)) score = 60
    else if (terms.length > 1 && terms.every((t) => hay.includes(t))) score = 50
    else if (terms.length === 1 && key.length >= 4) {
      const d = levenshtein(key, name, fuzzyThreshold(key.length))
      if (d <= fuzzyThreshold(key.length)) score = 30 - d
    }
    if (score > 0) scored.push({ p, score })
  }
  scored.sort((a, b) => b.score - a.score || a.p.name_short.localeCompare(b.p.name_short, 'ru'))
  return scored.map((s) => s.p)
}
