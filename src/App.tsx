import { useCallback, useMemo, useRef, useState } from 'react'
import catalogJson from './data/catalog.json'
import type { Catalog, CartLine, Product } from './lib/types'
import { buildIndex, searchProducts } from './lib/match'
import { parseOrderText } from './lib/parseOrder'
import { parseWorkbook, type ImportOutcome } from './lib/importSheet'
import { buildPriceTemplate } from './lib/xlsx'
import { restoreSet } from './lib/storage'
import { formatMoney, formatWeight } from './lib/totals'
import { useCart } from './state/useCart'
import { Modal } from './components/Bits'
import { ProductCard, unitLabel } from './components/ProductCard'
import { PreviewPanel, type ApplyMode } from './components/PreviewPanel'
import { Checkout } from './components/Checkout'
import './styles/app.css'

const catalog = catalogJson as unknown as Catalog
const ALL_PRODUCTS = catalog.products
const INDEX = buildIndex(ALL_PRODUCTS)
const BY_ID = new Map<number, Product>(ALL_PRODUCTS.map((p) => [p.source_id, p]))

const SNAPSHOT_DATE = new Date(catalog.meta.fetched_at).toLocaleDateString('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

const SAMPLE_ORDER = `1. БА — 2 шт.
2. СЮАНЬ — 1 шт.
3. ХАО ХЭ — 1 шт.
4. ДИСК БИ — 1 шт.
5. ПУЭРИН — 1 шт.`

type Dialog = 'paste' | 'excel' | 'sets' | 'cart' | 'checkout' | null

export default function App() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const cart = useCart(BY_ID)

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of ALL_PRODUCTS) counts.set(p.category, (counts.get(p.category) ?? 0) + 1)
    return counts
  }, [])

  const visible = useMemo(() => {
    const base = category ? ALL_PRODUCTS.filter((p) => p.category === category) : ALL_PRODUCTS
    return searchProducts(base, query)
  }, [query, category])

  const { totals } = cart

  return (
    <>
      <div className="demo-bar">
        <strong>Демонстрационный прототип.</strong>{' '}
        <span className="demo-full">
          Настоящие заказы не принимаются и не оплачиваются. Данные каталога — снимок публичного
          сайта baduchai.ru от {SNAPSHOT_DATE}.
        </span>
        <span className="demo-short">Заказы не принимаются. Каталог от {SNAPSHOT_DATE}.</span>
      </div>

      <header className="header">
        <div className="header-inner">
          <div className="brand">
            <span className="brand-mark">Бадучай</span>
            <span className="brand-sub">чайный каталог · прототип</span>
          </div>

          <div className="search-wrap">
            <span className="search-icon" aria-hidden>⌕</span>
            <input
              className="search"
              type="search"
              value={query}
              placeholder="Поиск: название, артикул, 大红袍…"
              aria-label="Поиск по каталогу"
              data-testid="search"
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button className="search-clear" onClick={() => setQuery('')} aria-label="Очистить поиск">✕</button>
            )}
          </div>

          <div className="header-actions">
            <button className="btn btn-sm" onClick={() => setDialog('paste')} data-testid="open-paste">
              Вставить список
            </button>
            <button className="btn btn-sm" onClick={() => setDialog('excel')} data-testid="open-excel">
              Excel
            </button>
            <button className="btn btn-sm" onClick={() => setDialog('sets')} data-testid="open-sets">
              Наборы
            </button>
            <button
              className="btn btn-sm btn-primary cart-btn"
              onClick={() => setDialog('cart')}
              data-testid="open-cart"
            >
              Корзина <span className="cart-count">{totals.packages}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="layout has-mobile-bar">
        <section>
          <div className="toolbar">
            <div className="chips">
              <button
                className="chip"
                aria-pressed={category === null}
                onClick={() => setCategory(null)}
              >
                Все категории <span className="chip-count">{ALL_PRODUCTS.length}</span>
              </button>
              {catalog.categories.map((c) => (
                <button
                  key={c}
                  className="chip"
                  aria-pressed={category === c}
                  data-testid={`chip-${c}`}
                  onClick={() => setCategory((prev) => (prev === c ? null : c))}
                >
                  {c} <span className="chip-count">{categoryCounts.get(c) ?? 0}</span>
                </button>
              ))}
            </div>
          </div>

          <p className="result-line" data-testid="result-count">
            {visible.length === 0
              ? 'Ничего не найдено'
              : `Показано ${visible.length} из ${ALL_PRODUCTS.length} товаров`}
            {query && ` по запросу «${query}»`}
            {category && `, категория «${category}»`}
          </p>

          {visible.length === 0 ? (
            <div className="panel">
              <div className="empty">
                <span className="empty-mark">⌕</span>
                Ничего не нашлось. Попробуйте часть названия, артикул (например, SHU-47) или
                сбросьте фильтр категории.
              </div>
            </div>
          ) : (
            <div className="grid" data-testid="grid">
              {visible.map((p) => (
                <ProductCard
                  key={p.source_id}
                  product={p}
                  qty={cart.qtyOf(p.source_id)}
                  onQty={(next) => cart.setQty(p.source_id, next)}
                />
              ))}
            </div>
          )}
        </section>

        <aside className="side">
          <CartPanel cart={cart} onCheckout={() => setDialog('checkout')} />
        </aside>
      </main>

      <Footer />

      <div className="mobile-bar">
        <div className="mobile-bar-info">
          <div className="mobile-bar-sum">{formatMoney(totals.amountMinor, totals.currencySymbol)}</div>
          <div className="mobile-bar-meta">
            {totals.positions} поз. · {totals.packages} упак. ·{' '}
            {totals.weightComplete ? formatWeight(totals.knownWeightG) : `от ${formatWeight(totals.knownWeightG)}`}
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setDialog('cart')} data-testid="mobile-cart">
          Корзина
        </button>
      </div>

      {dialog === 'paste' && (
        <PasteDialog cart={cart} onClose={() => setDialog(null)} />
      )}
      {dialog === 'excel' && <ExcelDialog cart={cart} onClose={() => setDialog(null)} />}
      {dialog === 'sets' && <SetsDialog cart={cart} onClose={() => setDialog(null)} />}
      {dialog === 'cart' && (
        <Modal
          title="Корзина"
          onClose={() => setDialog(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDialog(null)}>Продолжить выбор</button>
              <button
                className="btn btn-primary"
                disabled={totals.positions === 0}
                onClick={() => setDialog('checkout')}
              >
                Перейти к оформлению
              </button>
            </>
          }
        >
          <CartPanel cart={cart} onCheckout={() => setDialog('checkout')} inModal />
        </Modal>
      )}
      {dialog === 'checkout' && (
        <Checkout
          totals={totals}
          onClose={() => setDialog(null)}
          onFinish={() => {
            cart.clear()
            setDialog(null)
          }}
        />
      )}
    </>
  )
}

type CartApi = ReturnType<typeof useCart>

function CartPanel({
  cart,
  onCheckout,
  inModal,
}: {
  cart: CartApi
  onCheckout: () => void
  inModal?: boolean
}) {
  const { totals } = cart
  const [setName, setSetName] = useState('')
  const [saved, setSaved] = useState<string | null>(null)

  const body = (
    <>
      {totals.positions === 0 ? (
        <div className="empty">
          <span className="empty-mark">☕</span>
          Корзина пуста. Задайте количество прямо в каталоге или вставьте готовый список.
        </div>
      ) : (
        <>
          <ul className="cart-lines" data-testid="cart-lines">
            {totals.items.map((item) => (
              <li className="cart-line" key={item.product.source_id} data-sku={item.product.sku ?? ''}>
                {item.product.image ? (
                  <img className="cart-thumb" src={item.product.image} alt="" loading="lazy" width={46} height={46} />
                ) : (
                  <div className="cart-thumb" />
                )}
                <div>
                  <div className="cart-line-name">{item.product.name_short}</div>
                  <div className="cart-line-meta">
                    {item.product.sku} · {unitLabel(item.product)} ·{' '}
                    {formatMoney(item.product.price_minor, totals.currencySymbol)} за упаковку
                  </div>
                  <div className="cart-line-controls">
                    <div className="stepper filled" style={{ transform: 'scale(0.9)', transformOrigin: 'left' }}>
                      <button onClick={() => cart.addQty(item.product.source_id, -1)} aria-label={`Убрать: ${item.product.name_short}`}>−</button>
                      <input
                        type="number"
                        min={0}
                        value={item.qty}
                        aria-label={`Количество в корзине: ${item.product.name_short}`}
                        onChange={(e) => cart.setQty(item.product.source_id, Number(e.target.value))}
                      />
                      <button onClick={() => cart.addQty(item.product.source_id, 1)} aria-label={`Добавить: ${item.product.name_short}`}>+</button>
                    </div>
                    <button
                      className="icon-btn"
                      onClick={() => cart.remove(item.product.source_id)}
                      aria-label={`Удалить: ${item.product.name_short}`}
                      data-testid="remove-line"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div className="cart-line-sum">{formatMoney(item.lineTotalMinor, totals.currencySymbol)}</div>
              </li>
            ))}
          </ul>

          <div className="totals" style={{ marginTop: 14 }}>
            <div className="total-row"><span>Позиций</span><span data-testid="t-positions">{totals.positions}</span></div>
            <div className="total-row"><span>Упаковок</span><span data-testid="t-packages">{totals.packages}</span></div>
            <div className="total-row">
              <span>Общий вес</span>
              <span data-testid="t-weight">
                {totals.weightComplete
                  ? formatWeight(totals.knownWeightG)
                  : `от ${formatWeight(totals.knownWeightG)}`}
              </span>
            </div>
            <div className="total-row grand">
              <span>К оплате</span>
              <span data-testid="t-amount">{formatMoney(totals.amountMinor, totals.currencySymbol)}</span>
            </div>
          </div>

          {!totals.weightComplete && (
            <div className="note note-warn" style={{ marginTop: 10 }}>
              У {totals.unknownWeightItems} поз. вес не опубликован в магазине, поэтому общий вес
              показан как нижняя граница, а не как точный.
            </div>
          )}
          <div className="note note-info" style={{ marginTop: 8 }}>
            Доставка и скидки не включены — их условия магазин согласует лично.
          </div>

          <div className="stack" style={{ marginTop: 14 }}>
            <button className="btn btn-primary btn-block" onClick={onCheckout} data-testid="to-checkout">
              Перейти к оформлению
            </button>
            <div className="row">
              <input
                className="field"
                style={{ flex: 1, minWidth: 140 }}
                placeholder="Название набора"
                value={setName}
                aria-label="Название набора для повторной закупки"
                onChange={(e) => { setSetName(e.target.value); setSaved(null) }}
              />
              <button
                className="btn"
                data-testid="save-set"
                onClick={() => {
                  const s = cart.saveCurrentSet(setName)
                  setSetName('')
                  setSaved(`Набор «${s.name}» сохранён на этом устройстве`)
                }}
              >
                Сохранить набор
              </button>
            </div>
            {saved && <div className="note note-info">{saved}</div>}
            <button className="btn btn-danger btn-sm" onClick={cart.clear}>Очистить корзину</button>
          </div>
        </>
      )}
    </>
  )

  if (inModal) return body
  return (
    <div className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Корзина</h2>
        <span className="hint">{totals.packages} упак.</span>
      </div>
      <div className="panel-body">{body}</div>
    </div>
  )
}

function PasteDialog({ cart, onClose }: { cart: CartApi; onClose: () => void }) {
  const [text, setText] = useState('')
  const [applied, setApplied] = useState<string | null>(null)
  const report = useMemo(() => parseOrderText(INDEX, text), [text])

  const apply = useCallback(
    (lines: CartLine[], mode: ApplyMode) => {
      cart.applyLines(lines, mode)
      const packages = lines.reduce((s, l) => s + l.qty, 0)
      setApplied(
        mode === 'replace'
          ? `Корзина заменена: ${lines.length} поз., ${packages} упак. Повторное применение этого списка не нужно.`
          : `Добавлено к корзине: ${lines.length} поз., ${packages} упак. Повторное применение этого списка не нужно.`,
      )
    },
    [cart],
  )

  return (
    <Modal
      title="Вставить список заказом"
      onClose={onClose}
      wide
      footer={<button className="btn" onClick={onClose}>Закрыть</button>}
    >
      <p className="hint" style={{ marginBottom: 8 }}>
        Вставьте список из переписки или заметок. Понимаются нумерация, тире, двоеточие, «шт.»,
        артикулы и разный регистр. Разбор детерминированный — без внешних сервисов.
      </p>
      <textarea
        className="field"
        data-testid="paste-input"
        value={text}
        placeholder={SAMPLE_ORDER}
        aria-label="Список заказа"
        onChange={(e) => { setText(e.target.value); setApplied(null) }}
      />
      <div className="row" style={{ margin: '10px 0 16px' }}>
        <button className="btn btn-sm" data-testid="paste-sample" onClick={() => { setText(SAMPLE_ORDER); setApplied(null) }}>
          Подставить пример
        </button>
        <button className="btn btn-sm" onClick={() => { setText('SHU-47 — 2\nSHU-38 — 1'); setApplied(null) }}>
          Пример с артикулами
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => { setText(''); setApplied(null) }}>Очистить</button>
      </div>

      <PreviewPanel
        rows={report.rows}
        mergedCount={report.mergedCount}
        onApply={apply}
        appliedNote={applied}
        emptyText="Вставьте список — предпросмотр появится здесь до изменения корзины."
      />
    </Modal>
  )
}

function ExcelDialog({ cart, onClose }: { cart: CartApi; onClose: () => void }) {
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [applied, setApplied] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const download = () => {
    const bytes = buildPriceTemplate(ALL_PRODUCTS)
    const blob = new Blob([bytes as unknown as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `baduchai-prays-${catalog.meta.fetched_at.slice(0, 10)}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  const onFile = async (file: File) => {
    setError(null)
    setApplied(null)
    setFileName(file.name)
    try {
      const buf = new Uint8Array(await file.arrayBuffer())
      setOutcome(parseWorkbook(INDEX, buf))
    } catch (e) {
      setOutcome(null)
      setError(e instanceof Error ? e.message : 'Не удалось прочитать файл')
    }
  }

  return (
    <Modal
      title="Прайс и импорт заказа в Excel"
      onClose={onClose}
      wide
      footer={<button className="btn" onClick={onClose}>Закрыть</button>}
    >
      <div className="stack" style={{ marginBottom: 18 }}>
        <div className="row">
          <button className="btn btn-primary" onClick={download} data-testid="download-template">
            Скачать прайс-шаблон .xlsx
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()} data-testid="pick-file">
            Загрузить заполненный файл
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            data-testid="file-input"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onFile(f)
              e.target.value = ''
            }}
          />
        </div>
        <p className="hint">
          Колонки: артикул, название, фасовка, цена, валюта, наличие, количество. Заполните
          «Количество» у нужных строк и загрузите файл обратно. Артикулы хранятся как текст;
          выгруженный файл не содержит формул, а формулы во входящем файле читаются как обычные
          значения и не выполняются.
        </p>
      </div>

      {fileName && <div className="note note-info" style={{ marginBottom: 12 }}>Файл: {fileName}</div>}
      {error && <div className="note note-danger" style={{ marginBottom: 12 }}>Ошибка чтения: {error}</div>}

      {outcome && (
        <PreviewPanel
          rows={outcome.rows}
          mergedCount={outcome.mergedCount}
          appliedNote={applied}
          onApply={(lines, mode) => {
            cart.applyLines(lines, mode)
            const packages = lines.reduce((s, l) => s + l.qty, 0)
            setApplied(
              `${mode === 'replace' ? 'Корзина заменена' : 'Добавлено к корзине'}: ${lines.length} поз., ${packages} упак. Повторный импорт того же файла не требуется.`,
            )
          }}
          emptyText="В файле нет строк с заполненным количеством."
        />
      )}
      {!outcome && !error && (
        <p className="hint">Предпросмотр появится после загрузки файла — до изменения корзины.</p>
      )}
    </Modal>
  )
}

function SetsDialog({ cart, onClose }: { cart: CartApi; onClose: () => void }) {
  const [note, setNote] = useState<string | null>(null)

  const load = (id: string, mode: ApplyMode) => {
    const set = cart.sets.find((s) => s.id === id)
    if (!set) return
    const report = restoreSet(set.lines, BY_ID)
    cart.applyLines(report.lines, mode)

    const parts = [
      `${mode === 'replace' ? 'Корзина заменена' : 'Добавлено'} из набора «${set.name}»: ${report.restored.length} поз.`,
    ]
    if (report.missing.length) {
      parts.push(`Нет в текущем снимке каталога (${report.missing.length}): id ${report.missing.join(', ')} — эти товары пропущены.`)
    }
    if (report.unavailable.length) {
      parts.push(`Стали недоступны: ${report.unavailable.map((p) => `${p.name_short} (${p.sku})`).join(', ')} — не добавлены.`)
    }
    parts.push('Цены и вес пересчитаны по снимку каталога от ' + SNAPSHOT_DATE + '.')
    setNote(parts.join(' '))
  }

  return (
    <Modal title="Повтор закупки" onClose={onClose} footer={<button className="btn" onClick={onClose}>Закрыть</button>}>
      <p className="hint" style={{ marginBottom: 14 }}>
        Наборы хранятся только на этом устройстве. При загрузке товары ищутся по их
        идентификаторам, а цены и вес берутся из текущего снимка каталога.
      </p>

      {note && <div className="note note-info" style={{ marginBottom: 14 }} data-testid="set-note">{note}</div>}

      {cart.sets.length === 0 ? (
        <div className="empty">
          <span className="empty-mark">⁂</span>
          Сохранённых наборов пока нет. Соберите корзину и нажмите «Сохранить набор».
        </div>
      ) : (
        <ul className="set-list" data-testid="set-list">
          {cart.sets.map((s) => {
            const report = restoreSet(s.lines, BY_ID)
            const amount = report.restored.reduce((sum, r) => sum + r.product.price_minor * r.qty, 0)
            return (
              <li className="set-item" key={s.id}>
                <div className="set-name">{s.name}</div>
                <div className="set-meta">
                  {new Date(s.createdAt).toLocaleString('ru-RU')} · {s.lines.length} поз. · по текущему
                  снимку {formatMoney(amount)}
                  {report.missing.length > 0 && ` · ${report.missing.length} исчезло из каталога`}
                  {report.unavailable.length > 0 && ` · ${report.unavailable.length} нет в наличии`}
                </div>
                <div className="set-actions">
                  <button className="btn btn-sm btn-primary" onClick={() => load(s.id, 'replace')} data-testid="set-replace">
                    Заменить корзину
                  </button>
                  <button className="btn btn-sm" onClick={() => load(s.id, 'add')}>Добавить к корзине</button>
                  <button className="btn btn-sm btn-danger" onClick={() => cart.deleteSet(s.id)}>Удалить</button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-grid">
        <div>
          <strong>Демонстрационный прототип</strong>
          <br />
          Самостоятельный сайт, не связанный с магазином. Заказы не принимаются, оплата не
          запрашивается, персональные данные не сохраняются.
        </div>
        <div>
          <strong>Источник каталога</strong>
          <br />
          Публичные данные{' '}
          <a href="https://baduchai.ru/" target="_blank" rel="noreferrer noopener">baduchai.ru</a>,
          рубрика «ЧАЙ». Снимок от {SNAPSHOT_DATE}: {catalog.meta.product_count} товаров,{' '}
          {catalog.categories.length} категорий. Цены и наличие — как опубликованы на эту дату.
        </div>
        <div>
          <strong>Ограничения снимка</strong>
          <br />
          Вес не опубликован у {ALL_PRODUCTS.filter((p) => p.weight_g === null).length} товаров — он
          не подставляется и не включается в точный итог. Оптовые цены, скидки, остатки и отзывы не
          показываются, так как магазин их не публикует.
        </div>
      </div>
    </footer>
  )
}
