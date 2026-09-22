import type { Product } from './types'
import { matchProduct, type ProductIndex } from './match'
import { parseQuantity, isUnitWord } from './qty'

export type RowStatus = 'ok' | 'confirm' | 'ambiguous' | 'not_found' | 'invalid_qty' | 'unavailable'

export interface PreviewRow {
  /** Номера исходных строк (после объединения дубликатов их может быть несколько). */
  lines: number[]
  /** Исходный текст — показываем как есть. */
  raw: string
  /** Что распознали как название/артикул. */
  queryText: string
  qty: number | null
  product: Product | null
  candidates: Product[]
  status: RowStatus
  message?: string
  /** Дубликат, объединённый с другой строкой. */
  merged?: boolean
}

export interface ParseReport {
  rows: PreviewRow[]
  totalLines: number
  mergedCount: number
}

/** Нумерация списка: «1.», «2)», «-», «•», «*» в начале строки. */
const ENUMERATOR = /^\s*(?:[-–—•*]|\d{1,3}[.)])\s+/u
// дефис последний — внутри класса символов он должен быть литералом
const SEPARATORS = '—–−:|=×-'

/** Варианты разбиения строки на «название» и «количество», в порядке доверия. */
function splitCandidates(line: string): { name: string; qty: string }[] {
  const out: { name: string; qty: string }[] = []
  const add = (name: string, qty: string) => {
    const n = name.trim().replace(/[\s.,;—–−:|=×-]+$/u, '').trim()
    if (n) out.push({ name: n, qty: qty.trim() })
  }

  // «Название — 2 шт.» / «Название: 2» / «Название x2» / «Название | 2»
  const sep = new RegExp(
    `^(.*?)\\s*(?:[${SEPARATORS}]|\\t|\\s[xXхХ*]\\s?)\\s*([+-]?\\d+(?:[.,]\\d+)?)\\s*([\\p{L}.]*)\\s*$`,
    'u',
  )
  const m1 = line.match(sep)
  if (m1 && (!m1[3] || isUnitWord(m1[3]))) add(m1[1], `${m1[2]} ${m1[3] ?? ''}`)

  // «Название 2 шт.» — единица указана словом, значит это точно количество
  const m2 = line.match(/^(.*?)\s+([+-]?\d+(?:[.,]\d+)?)\s*([\p{L}]+\.?)\s*$/u)
  if (m2 && isUnitWord(m2[3])) add(m2[1], `${m2[2]} ${m2[3]}`)

  // «2 x Название» / «2 шт Название»
  const m3 = line.match(/^\s*(\d+(?:[.,]\d+)?)\s*(?:шт\.?|уп\.?)?\s*[xXхХ*]\s*(.+)$/u)
  if (m3) add(m3[2], m3[1])

  // «Название 2» — голое число в конце
  const m4 = line.match(/^(.*?)\s+([+-]?\d+(?:[.,]\d+)?)\s*$/u)
  if (m4) add(m4[1], m4[2])

  // «Название — две»: хвост после последнего разделителя не число.
  // Такую строку надо отклонить по количеству, а не объявить товар ненайденным.
  const tail = line.match(new RegExp(`^(.*)[${SEPARATORS}]\\s*(\\S.*)$`, 'u'))
  if (tail) add(tail[1], tail[2])

  // Вся строка — название, количество по умолчанию 1
  add(line, '1')
  return out
}

/** Разбор строки без обращения к каталогу отделён, чтобы его можно было тестировать. */
export function splitLine(line: string): { name: string; qty: string }[] {
  return splitCandidates(line.replace(ENUMERATOR, '').trim())
}

export function parseOrderText(index: ProductIndex, text: string): ParseReport {
  const lines = String(text ?? '').split(/\r?\n/)
  const rows: PreviewRow[] = []
  let totalLines = 0

  lines.forEach((original, i) => {
    const lineNo = i + 1
    const stripped = original.replace(ENUMERATOR, '').trim()
    if (!stripped) return
    totalLines++

    const raw = original.trim()
    const candidates = splitCandidates(stripped)

    // Берём первое разбиение, которое вообще нашло товар.
    let chosen: { name: string; qty: string } | null = null
    let result = matchProduct(index, stripped)
    for (const c of candidates) {
      const r = matchProduct(index, c.name)
      if (r.kind === 'exact') {
        chosen = c
        result = r
        break
      }
      if (!chosen && (r.kind === 'ambiguous' || r.kind === 'fuzzy')) {
        chosen = c
        result = r
      }
    }
    if (!chosen) {
      // Ничего не совпало: берём самое правдоподобное разбиение (с явным количеством),
      // чтобы в ошибке было видно название, а не всю строку вместе с «— 1».
      chosen = candidates[0]
      result = matchProduct(index, chosen.name)
    }

    const qtyParsed = parseQuantity(chosen.qty)
    const base: PreviewRow = {
      lines: [lineNo],
      raw,
      queryText: chosen.name,
      qty: qtyParsed.ok ? qtyParsed.value : null,
      product: null,
      candidates: result.candidates,
      status: 'not_found',
    }

    if (!qtyParsed.ok) {
      rows.push({ ...base, status: 'invalid_qty', message: qtyParsed.error, product: result.kind === 'exact' ? result.candidates[0] : null })
      return
    }

    if (result.kind === 'exact') {
      const p = result.candidates[0]
      if (!p.in_stock) {
        rows.push({ ...base, product: p, status: 'unavailable', message: `«${p.name_short}» — ${p.stock_label.toLowerCase()} по снимку каталога` })
        return
      }
      rows.push({ ...base, product: p, status: 'ok' })
      return
    }

    if (result.kind === 'ambiguous') {
      rows.push({
        ...base,
        status: 'ambiguous',
        message: `Несколько подходящих товаров (${result.candidates.length}) — выберите нужный`,
      })
      return
    }

    if (result.kind === 'fuzzy') {
      rows.push({
        ...base,
        status: 'confirm',
        message: `Точного совпадения нет. Возможно, «${result.candidates[0].name_short}» — подтвердите`,
      })
      return
    }

    rows.push({ ...base, status: 'not_found', message: `Товар не найден: «${chosen.name}»` })
  })

  return mergeDuplicates(rows, totalLines)
}

/** Дубликаты объединяем явно: количества складываются, строки перечисляются. */
export function mergeDuplicates(rows: PreviewRow[], totalLines: number): ParseReport {
  const out: PreviewRow[] = []
  const seen = new Map<number, PreviewRow>()
  let mergedCount = 0

  for (const row of rows) {
    const id = row.product && row.status === 'ok' ? row.product.source_id : null
    if (id === null) {
      out.push(row)
      continue
    }
    const prev = seen.get(id)
    if (!prev) {
      seen.set(id, row)
      out.push(row)
      continue
    }
    prev.qty = (prev.qty ?? 0) + (row.qty ?? 0)
    prev.lines.push(...row.lines)
    prev.merged = true
    prev.message = `Дубликат: строки ${prev.lines.join(', ')} объединены, всего ${prev.qty}`
    mergedCount++
  }
  return { rows: out, totalLines, mergedCount }
}

/** Строки, которые реально попадут в корзину. */
export function applicableRows(rows: PreviewRow[]): PreviewRow[] {
  return rows.filter((r) => r.status === 'ok' && r.product && r.qty && r.qty > 0)
}
