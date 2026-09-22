export interface Product {
  source_id: number
  sku: string | null
  name_full: string
  name_short: string
  /** Самая глубокая категория товара. */
  category: string
  category_id: number | null
  /** Путь от корневой рубрики до самой глубокой: ['ЧАЙ', 'Улун', 'Цин Хо']. */
  category_path: string[]
  /** Все категории пути — по ним работает фильтр любого уровня. */
  category_ids: number[]
  top_category: string
  is_tea: boolean
  pack_label: string | null
  weight_g: number | null
  weight_source: 'short_description' | 'name' | 'description' | null
  /** Вес ожидается только у чая: для чайника или браслета он не единица продажи. */
  weight_expected: boolean
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

export interface CategoryNode {
  id: number
  name: string
  slug: string
  parent: number | null
  count: number
}

export interface CatalogMeta {
  source: string
  source_scope: string
  fetched_at: string
  product_count: number
  category_count: number
  method: string
  robots_txt: string
  notes: { sku: string; note: string }[]
  sku_collisions: { normalized: string; items: string[] }[]
  products_without_sku: number
  tea_without_weight: string[]
}

export interface Catalog {
  meta: CatalogMeta
  categories: CategoryNode[]
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
