export interface Product {
  source_id: number
  sku: string | null
  name_full: string
  name_short: string
  category: string
  categories_all: string[]
  pack_label: string | null
  weight_g: number | null
  weight_source: 'short_description' | 'name' | 'description' | null
  unit: string
  price_minor: number
  currency: string
  currency_symbol: string
  currency_minor_unit: number
  in_stock: boolean
  stock_label: string
  purchasable: boolean
  url: string
  description: string
  short_description: string
  image: string | null
  aliases: string[]
  fetched_at: string
}

export interface CatalogMeta {
  source: string
  source_category: string
  fetched_at: string
  product_count: number
  method: string
  robots_txt: string
  notes: { sku: string; note: string }[]
  sku_collisions: { normalized: string; items: string[] }[]
  known_categories: { id: number; name: string; site_count: number }[]
}

export interface Catalog {
  meta: CatalogMeta
  categories: string[]
  products: Product[]
}

/** Позиция корзины. Хранится по source_id — снимок каталога может обновиться. */
export interface CartLine {
  source_id: number
  qty: number
}

export type MatchKind = 'exact' | 'ambiguous' | 'fuzzy' | 'not_found'

export interface MatchResult {
  kind: MatchKind
  /** Для 'exact' — ровно один элемент. Для 'ambiguous'/'fuzzy' — варианты на выбор. */
  candidates: Product[]
  /** Чем сопоставили: артикул, точное имя, псевдоним, нечёткое совпадение. */
  via?: 'sku' | 'name' | 'alias' | 'fuzzy'
}
