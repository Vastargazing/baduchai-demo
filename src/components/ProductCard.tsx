import { useState } from 'react'
import type { Product } from '../lib/types'
import { formatMoney } from '../lib/totals'
import { QtyStepper } from './Bits'

/** Подпись единицы продажи. Количество всегда означает именно её. */
export function unitLabel(p: Product): string {
  if (p.weight_g === null) return `1 ${p.unit} · вес не указан`
  const w = p.weight_g >= 1000 ? `${p.weight_g / 1000} кг` : `${p.weight_g} г`
  return `1 ${p.unit} · ${w}`
}

export function ProductCard({
  product,
  qty,
  onQty,
}: {
  product: Product
  qty: number
  onQty: (next: number) => void
}) {
  const [open, setOpen] = useState(false)
  const desc = product.description || product.short_description
  const long = desc.length > 150
  const shown = open || !long ? desc : `${desc.slice(0, 150).trimEnd()}…`

  return (
    <article
      className={`card${qty > 0 ? ' in-cart' : ''}${product.in_stock ? '' : ' out-of-stock'}`}
      data-sku={product.sku ?? ''}
      data-testid="product-card"
    >
      <div className="card-media">
        {product.image ? (
          <img
            src={product.image}
            alt={product.name_short}
            loading="lazy"
            decoding="async"
            width={400}
            height={400}
          />
        ) : null}
        <span className={`card-badge${product.in_stock ? '' : ' out'}`}>{product.stock_label}</span>
      </div>

      <div className="card-body">
        <h3 className="card-name">{product.name_short}</h3>
        <div className="card-full">{product.name_full}</div>

        <div className="card-meta">
          <span className="tag">{product.category}</span>
          <span className={`tag ${product.weight_g === null ? 'tag-unknown' : 'tag-pack'}`}>
            {product.weight_g === null
              ? (product.pack_label ?? 'фасовка не указана')
              : `${product.unit} ${product.weight_g} г`}
          </span>
          <span className="card-sku">{product.sku}</span>
        </div>

        {desc && (
          <p className="card-desc">
            {shown}{' '}
            {long && (
              <button className="desc-toggle" onClick={() => setOpen((v) => !v)}>
                {open ? 'свернуть' : 'ещё'}
              </button>
            )}
          </p>
        )}

        <div className="card-foot">
          <div>
            <span className="price">
              {formatMoney(product.price_minor, product.currency_symbol, product.currency_minor_unit)}
            </span>
            <span className="price-unit">за {unitLabel(product)}</span>
          </div>
          <QtyStepper
            value={qty}
            onChange={onQty}
            disabled={!product.in_stock}
            label={product.name_short}
          />
        </div>
      </div>
    </article>
  )
}
