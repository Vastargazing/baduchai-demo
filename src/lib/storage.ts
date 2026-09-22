import type { CartLine, Product } from './types'

/**
 * Локальное хранение корзины и сохранённых наборов.
 *
 * Здесь лежат только идентификаторы товаров и количества. Персональные данные
 * оформления (почта, получатель, адрес) сюда не попадают и нигде не сохраняются.
 */

export const CART_KEY = 'baduchai.demo.cart.v1'
export const SETS_KEY = 'baduchai.demo.sets.v1'

export interface SavedSet {
  id: string
  name: string
  createdAt: string
  lines: CartLine[]
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** Отбрасывает всё, что не похоже на корректную позицию: хранилище мог испортить кто угодно. */
export function sanitizeLines(input: unknown): CartLine[] {
  if (!Array.isArray(input)) return []
  const out: CartLine[] = []
  const seen = new Set<number>()
  for (const item of input) {
    if (!item || typeof item !== 'object') continue
    const { source_id, qty } = item as Record<string, unknown>
    if (typeof source_id !== 'number' || !Number.isInteger(source_id)) continue
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty <= 0) continue
    if (seen.has(source_id)) continue
    seen.add(source_id)
    out.push({ source_id, qty })
  }
  return out
}

export function loadCart(storage: Storage = localStorage): CartLine[] {
  try {
    return sanitizeLines(safeParse<unknown>(storage.getItem(CART_KEY), []))
  } catch {
    return []
  }
}

export function saveCart(lines: CartLine[], storage: Storage = localStorage): void {
  try {
    storage.setItem(CART_KEY, JSON.stringify(sanitizeLines(lines)))
  } catch {
    // приватный режим или переполненное хранилище — прототип продолжает работать в памяти
  }
}

export function loadSets(storage: Storage = localStorage): SavedSet[] {
  const raw = safeParse<unknown>(storage.getItem(SETS_KEY), [])
  if (!Array.isArray(raw)) return []
  return raw
    .filter((s): s is SavedSet => !!s && typeof s === 'object')
    .map((s) => ({
      id: String(s.id ?? ''),
      name: String(s.name ?? 'Без названия'),
      createdAt: String(s.createdAt ?? ''),
      lines: sanitizeLines(s.lines),
    }))
    .filter((s) => s.id && s.lines.length > 0)
}

export function saveSets(sets: SavedSet[], storage: Storage = localStorage): void {
  try {
    storage.setItem(SETS_KEY, JSON.stringify(sets))
  } catch {
    // см. saveCart
  }
}

export interface RestoreReport {
  lines: CartLine[]
  /** Товары, которых больше нет в снимке каталога. */
  missing: number[]
  /** Товары, которые есть, но помечены как отсутствующие. */
  unavailable: Product[]
  /** Позиции, попавшие в корзину. */
  restored: { product: Product; qty: number }[]
}

/**
 * Восстанавливает набор по снимку каталога: цены и веса берутся текущие,
 * исчезнувшие и недоступные товары перечисляются отдельно.
 */
export function restoreSet(lines: CartLine[], byId: Map<number, Product>): RestoreReport {
  const restored: { product: Product; qty: number }[] = []
  const missing: number[] = []
  const unavailable: Product[] = []
  const out: CartLine[] = []

  for (const line of sanitizeLines(lines)) {
    const product = byId.get(line.source_id)
    if (!product) {
      missing.push(line.source_id)
      continue
    }
    if (!product.in_stock) {
      unavailable.push(product)
      continue
    }
    restored.push({ product, qty: line.qty })
    out.push(line)
  }
  return { lines: out, missing, unavailable, restored }
}

export function newSetId(): string {
  return `set-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}
