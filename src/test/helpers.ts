import catalogJson from '../../public/catalog.json'
import type { Catalog, Product } from '../lib/types'
import { buildIndex } from '../lib/match'

export const catalog = catalogJson as unknown as Catalog
export const index = buildIndex(catalog.products)
export const byId = new Map<number, Product>(catalog.products.map((p) => [p.source_id, p]))
export const bySku = new Map<string, Product>(
  catalog.products.map((p) => [p.sku ?? String(p.source_id), p]),
)

/** Контрольный список из задания. */
export const CONTROL_LIST = `1. БА — 2 шт.
2. СЮАНЬ — 1 шт.
3. ХАО ХЭ — 1 шт.
4. ДИСК БИ — 1 шт.
5. ПУЭРИН — 1 шт.`
