import type { CategoryNode, Product } from './types'

export interface CategoryTree {
  /** Корневые рубрики в порядке убывания числа товаров. */
  roots: CategoryNode[]
  byId: Map<number, CategoryNode>
  childrenOf: Map<number, CategoryNode[]>
}

export function buildCategoryTree(categories: CategoryNode[]): CategoryTree {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const childrenOf = new Map<number, CategoryNode[]>()
  const roots: CategoryNode[] = []

  for (const c of categories) {
    // родитель мог не попасть в снимок (например, пустая рубрика) — тогда узел корневой
    if (c.parent && byId.has(c.parent)) {
      const list = childrenOf.get(c.parent)
      if (list) list.push(c)
      else childrenOf.set(c.parent, [c])
    } else {
      roots.push(c)
    }
  }

  const byCount = (a: CategoryNode, b: CategoryNode) =>
    b.count - a.count || a.name.localeCompare(b.name, 'ru')
  roots.sort(byCount)
  for (const list of childrenOf.values()) list.sort(byCount)

  return { roots, byId, childrenOf }
}

/**
 * Цепочка выбранных рубрик — от корня до выбранного узла.
 * Нужна, чтобы показать ряды фильтра по уровням, как в меню исходного сайта.
 */
export function pathTo(tree: CategoryTree, id: number | null): CategoryNode[] {
  if (id === null) return []
  const out: CategoryNode[] = []
  const guard = new Set<number>()
  let cur = tree.byId.get(id)
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id)
    out.unshift(cur)
    cur = cur.parent ? tree.byId.get(cur.parent) : undefined
  }
  return out
}

/**
 * Ряды кнопок фильтра: сначала корневые рубрики, затем дети каждой выбранной.
 * Пустые уровни не показываем.
 */
export function filterRows(tree: CategoryTree, selected: number | null): CategoryNode[][] {
  const rows: CategoryNode[][] = [tree.roots]
  for (const node of pathTo(tree, selected)) {
    const children = tree.childrenOf.get(node.id)
    if (children?.length) rows.push(children)
  }
  return rows
}

/** Товар относится к рубрике, если она есть в его пути — включая вложенные. */
export function inCategory(product: Product, id: number | null): boolean {
  return id === null || product.category_ids.includes(id)
}

export function filterByCategory(products: Product[], id: number | null): Product[] {
  return id === null ? products : products.filter((p) => p.category_ids.includes(id))
}
