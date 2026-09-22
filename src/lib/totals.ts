import type { CartLine, Product } from './types'

export interface CartItem {
  product: Product
  qty: number
  lineTotalMinor: number
  lineWeightG: number | null
}

export interface CartTotals {
  items: CartItem[]
  /** Число разных товаров. */
  positions: number
  /** Число упаковок — сумма количеств. */
  packages: number
  amountMinor: number
  /** Вес только тех позиций, у которых он опубликован. */
  knownWeightG: number
  /** Позиции, у которых вес ожидается, но не опубликован магазином. */
  unknownWeightItems: Product[]
  weightComplete: boolean
  currency: string
  currencySymbol: string
}

export function buildCart(lines: CartLine[], byId: Map<number, Product>): CartItem[] {
  const items: CartItem[] = []
  for (const line of lines) {
    const product = byId.get(line.source_id)
    if (!product || line.qty <= 0) continue
    items.push({
      product,
      qty: line.qty,
      lineTotalMinor: product.price_minor * line.qty,
      lineWeightG: product.weight_g === null ? null : product.weight_g * line.qty,
    })
  }
  return items
}

/**
 * Итоги корзины.
 * Скидки и доставка сюда не входят: их условия нам неизвестны.
 * Вес считается только по позициям с опубликованной фасовкой.
 */
export function computeTotals(items: CartItem[]): CartTotals {
  let amountMinor = 0
  let knownWeightG = 0
  let packages = 0
  const unknownWeightItems: Product[] = []

  for (const item of items) {
    amountMinor += item.lineTotalMinor
    packages += item.qty
    if (item.lineWeightG !== null) {
      knownWeightG += item.lineWeightG
      continue
    }
    // Вес считаем неполным только там, где магазин вообще его публикует.
    // У чайника или браслета вес не является единицей продажи.
    if (item.product.weight_expected) unknownWeightItems.push(item.product)
  }

  const first = items[0]?.product
  return {
    items,
    positions: items.length,
    packages,
    amountMinor,
    knownWeightG,
    unknownWeightItems,
    weightComplete: unknownWeightItems.length === 0,
    currency: first?.currency ?? 'USD',
    currencySymbol: first?.currency_symbol ?? '$',
  }
}

export function formatMoney(minor: number, symbol = '$', minorUnit = 2): string {
  const value = minor / 10 ** minorUnit
  return `${symbol}${value.toLocaleString('ru-RU', {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}

export function formatWeight(grams: number): string {
  if (grams >= 1000) {
    const kg = grams / 1000
    return `${kg.toLocaleString('ru-RU', { maximumFractionDigits: 3 })} кг`
  }
  return `${grams.toLocaleString('ru-RU')} г`
}
