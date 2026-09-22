import { useMemo, useState } from 'react'
import type { PreviewRow } from '../lib/parseOrder'
import type { CartLine, Product } from '../lib/types'
import { formatMoney } from '../lib/totals'
import { unitLabel } from './ProductCard'

export type ApplyMode = 'replace' | 'add'

const STATUS_TEXT: Record<PreviewRow['status'], string> = {
  ok: 'Распознано',
  confirm: 'Требует подтверждения',
  ambiguous: 'Неоднозначно',
  not_found: 'Не найдено',
  invalid_qty: 'Некорректное количество',
  unavailable: 'Нет в наличии',
}

/**
 * Предпросмотр перед изменением корзины.
 * Показывает исходную строку, найденный товар, фасовку, количество и ошибки.
 * Неоднозначные строки не применяются, пока покупатель не выберет товар.
 */
export function PreviewPanel({
  rows,
  mergedCount,
  onApply,
  appliedNote,
  emptyText,
}: {
  rows: PreviewRow[]
  mergedCount: number
  onApply: (lines: CartLine[], mode: ApplyMode) => void
  appliedNote: string | null
  emptyText: string
}) {
  // выбор покупателя для строк, где каталог даёт несколько вариантов
  const [resolved, setResolved] = useState<Record<number, Product>>({})

  const effective = useMemo(
    () =>
      rows.map((row, i) => {
        const pick = resolved[i]
        if (!pick) return row
        if (!pick.in_stock) {
          return { ...row, product: pick, status: 'unavailable' as const, message: `«${pick.name_short}» — нет в наличии по снимку каталога` }
        }
        return { ...row, product: pick, status: 'ok' as const, message: `Выбрано вручную: ${pick.name_short}` }
      }),
    [rows, resolved],
  )

  const okRows = effective.filter((r) => r.status === 'ok' && r.product && r.qty && r.qty > 0)
  const problemRows = effective.filter((r) => r.status !== 'ok')

  const lines: CartLine[] = okRows.map((r) => ({ source_id: r.product!.source_id, qty: r.qty! }))
  const packages = okRows.reduce((s, r) => s + (r.qty ?? 0), 0)
  const amount = okRows.reduce((s, r) => s + r.product!.price_minor * (r.qty ?? 0), 0)
  const unknownWeight = okRows.filter((r) => r.product!.weight_g === null).length
  const weight = okRows.reduce((s, r) => s + (r.product!.weight_g ?? 0) * (r.qty ?? 0), 0)

  if (!rows.length) return <p className="hint">{emptyText}</p>

  return (
    <div>
      <div className="preview-summary">
        <span className="pill pill-ok">Распознано: {okRows.length}</span>
        <span className="pill pill-plain">Упаковок: {packages}</span>
        <span className="pill pill-plain">
          {unknownWeight > 0 ? `Вес: от ${weight} г` : `Вес: ${weight} г`}
        </span>
        <span className="pill pill-plain">Сумма: {formatMoney(amount)}</span>
        {mergedCount > 0 && <span className="pill pill-warn">Объединено дубликатов: {mergedCount}</span>}
        {problemRows.length > 0 && <span className="pill pill-err">Требует внимания: {problemRows.length}</span>}
      </div>

      {unknownWeight > 0 && (
        <div className="note note-warn" style={{ marginBottom: 12 }}>
          У {unknownWeight} поз. вес не опубликован в магазине — показанный вес неполный.
        </div>
      )}

      <ul className="preview-list">
        {effective.map((row, i) => (
          <li key={`${row.lines.join('-')}-${i}`} className={`preview-row ${row.status}`}>
            <div className="preview-raw">
              стр. {row.lines.join(', ')}: {row.raw}
            </div>

            {row.product ? (
              <div className="preview-match">
                <span className="preview-name">{row.product.name_short}</span>
                <span className="card-sku">{row.product.sku}</span>
                <span className="tag tag-pack">{unitLabel(row.product)}</span>
                <span className="tag">× {row.qty ?? '—'}</span>
                <span style={{ marginLeft: 'auto', fontWeight: 600 }}>
                  {row.qty ? formatMoney(row.product.price_minor * row.qty) : ''}
                </span>
              </div>
            ) : (
              <div className="preview-match">
                <span className="preview-name">{STATUS_TEXT[row.status]}</span>
                <span className="tag">запрос: «{row.queryText}»</span>
                {row.qty !== null && <span className="tag">× {row.qty}</span>}
              </div>
            )}

            {row.message && (
              <div
                className={`preview-msg ${
                  row.status === 'ok' ? '' : ['confirm', 'ambiguous'].includes(row.status) ? 'warn' : 'err'
                }`}
              >
                {row.message}
              </div>
            )}

            {row.status !== 'ok' && row.candidates.length > 0 && (
              <div className="preview-choices">
                {row.candidates.map((c) => (
                  <button
                    key={c.source_id}
                    className="choice"
                    onClick={() => setResolved((prev) => ({ ...prev, [i]: c }))}
                  >
                    {c.name_short} · {c.sku} · {unitLabel(c)} ·{' '}
                    {formatMoney(c.price_minor, c.currency_symbol, c.currency_minor_unit)}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>

      <div style={{ marginTop: 16 }}>
        {appliedNote ? (
          <div className="note note-info" data-testid="applied-note">
            {appliedNote}
          </div>
        ) : (
          <>
            <div className="note note-info" style={{ marginBottom: 10 }}>
              Выберите, что сделать с корзиной. «Заменить» очистит текущую корзину, «Добавить»
              прибавит количества к уже выбранному.
            </div>
            <div className="row">
              <button
                className="btn btn-primary"
                disabled={!lines.length}
                data-testid="apply-replace"
                onClick={() => onApply(lines, 'replace')}
              >
                Заменить корзину ({okRows.length})
              </button>
              <button
                className="btn"
                disabled={!lines.length}
                data-testid="apply-add"
                onClick={() => onApply(lines, 'add')}
              >
                Добавить к корзине ({okRows.length})
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
