import type { ProductIndex } from './match'
import { matchProduct } from './match'
import { parseQuantity } from './qty'
import type { PreviewRow, ParseReport } from './parseOrder'
import { mergeDuplicates } from './parseOrder'
import { readXlsx, TEMPLATE_HEADERS } from './xlsx'
import { normName } from './text'

/** Заголовки ищем по смыслу, а не по позиции: файл мог быть пересохранён или переставлен. */
const COLUMN_SYNONYMS: Record<string, string[]> = {
  sku: ['артикул', 'sku', 'код', 'код товара'],
  name: ['название', 'наименование', 'товар', 'name'],
  qty: ['количество', 'кол-во', 'колво', 'qty', 'quantity', 'штук'],
}

function findColumns(header: string[]): { sku: number; name: number; qty: number } {
  const keys = header.map((h) => normName(h))
  const find = (field: keyof typeof COLUMN_SYNONYMS) =>
    keys.findIndex((k) => COLUMN_SYNONYMS[field].some((s) => k === normName(s)))

  let sku = find('sku')
  let name = find('name')
  let qty = find('qty')

  // запасной вариант — расположение колонок шаблона
  if (sku < 0 && name < 0) {
    sku = 0
    name = 1
  }
  if (qty < 0) qty = TEMPLATE_HEADERS.length - 1
  return { sku, name, qty }
}

export interface ImportOutcome extends ParseReport {
  /** Строк с заполненным количеством. Пустые строки шаблона не считаются ошибкой. */
  filledRows: number
  headerDetected: boolean
  /** Номер строки с заголовками (0-based), если она найдена. */
  headerIndex: number
}

/** Похожа ли строка на шапку таблицы. */
function looksLikeHeader(cells: string[]): boolean {
  const keys = cells.map((c) => normName(c))
  const hasSku = keys.some((k) => COLUMN_SYNONYMS.sku.some((sy) => k === normName(sy)))
  const hasName = keys.some((k) => COLUMN_SYNONYMS.name.some((sy) => k === normName(sy)))
  return hasSku || hasName
}

/** Разбирает уже прочитанную таблицу. Отделено от чтения файла ради тестов. */
export function parseSheetRows(index: ProductIndex, table: string[][]): ImportOutcome {
  if (!table.length) {
    return { rows: [], totalLines: 0, mergedCount: 0, filledRows: 0, headerDetected: false, headerIndex: -1 }
  }

  // Шапка не обязана быть первой строкой: в нашем прайсе над ней ещё
  // название листа и строка итогов, а покупатель мог добавить свои строки.
  const headerIndex = table.slice(0, 12).findIndex(looksLikeHeader)
  const headerDetected = headerIndex >= 0
  const header = headerDetected ? table[headerIndex] : (table[0] ?? [])
  const cols = findColumns(header)
  const body = headerDetected ? table.slice(headerIndex + 1) : table

  const rows: PreviewRow[] = []
  let filledRows = 0

  body.forEach((cells, i) => {
    const lineNo = i + (headerDetected ? headerIndex + 2 : 1)
    const sku = (cells[cols.sku] ?? '').trim()
    const name = (cells[cols.name] ?? '').trim()
    const qtyCell = (cells[cols.qty] ?? '').trim()

    // строка шаблона без количества — покупатель её просто не заказывал
    if (!qtyCell) return
    if (!sku && !name) return
    filledRows++

    const raw = [sku, name, qtyCell].filter(Boolean).join(' — ')
    // артикул надёжнее названия: название могли отредактировать в Excel
    const result = sku ? matchProduct(index, sku) : matchProduct(index, name)
    const fallback = result.kind === 'not_found' && name ? matchProduct(index, name) : result

    const queryText = sku || name
    const qtyParsed = parseQuantity(qtyCell)

    const base: PreviewRow = {
      lines: [lineNo],
      raw,
      queryText,
      qty: qtyParsed.ok ? qtyParsed.value : null,
      product: null,
      candidates: fallback.candidates,
      status: 'not_found',
    }

    if (!qtyParsed.ok) {
      rows.push({ ...base, status: 'invalid_qty', message: `Строка ${lineNo}: ${qtyParsed.error}` })
      return
    }

    if (fallback.kind === 'exact') {
      const p = fallback.candidates[0]
      if (!p.in_stock) {
        rows.push({
          ...base,
          product: p,
          status: 'unavailable',
          message: `«${p.name_short}» — ${p.stock_label.toLowerCase()} по снимку каталога`,
        })
        return
      }
      rows.push({ ...base, product: p, status: 'ok' })
      return
    }

    if (fallback.kind === 'ambiguous') {
      rows.push({
        ...base,
        status: 'ambiguous',
        message: `Несколько подходящих товаров (${fallback.candidates.length}) — выберите нужный`,
      })
      return
    }

    if (fallback.kind === 'fuzzy') {
      rows.push({
        ...base,
        status: 'confirm',
        message: `Точного совпадения нет. Возможно, «${fallback.candidates[0].name_short}» — подтвердите`,
      })
      return
    }

    rows.push({ ...base, status: 'not_found', message: `Товар не найден: «${queryText}»` })
  })

  const merged = mergeDuplicates(rows, filledRows)
  return { ...merged, filledRows, headerDetected, headerIndex }
}

export function parseWorkbook(index: ProductIndex, data: Uint8Array): ImportOutcome {
  return parseSheetRows(index, readXlsx(data))
}
