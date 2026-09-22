import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { Catalog, CartLine, CategoryNode, Product } from './lib/types'
import { buildIndex, searchProducts, type ProductIndex } from './lib/match'
import { buildCategoryTree, filterRows, filterByCategory, pathTo, type CategoryTree } from './lib/categories'
import { parseOrderText } from './lib/parseOrder'
import { parseWorkbook, type ImportOutcome } from './lib/importSheet'
import { buildPriceTemplate } from './lib/xlsx'
import { restoreSet, describeSet } from './lib/storage'
import { formatMoney, formatWeight } from './lib/totals'
import { useCart } from './state/useCart'
import { Modal } from './components/Bits'
import { ProductCard, unitLabel } from './components/ProductCard'
import { PreviewPanel, type ApplyMode } from './components/PreviewPanel'
import { Checkout } from './components/Checkout'
import logoUrl from './assets/brand/logo.png'
import './styles/app.css'

/**
 * Снимок каталога лежит отдельным файлом и подгружается при старте, а не вшит
 * в бандл: так оболочка появляется сразу, а сам файл кешируется браузером.
 */
const CATALOG_URL = `${import.meta.env.BASE_URL}catalog.json`

const SAMPLE_ORDER = `1. БА — 2 шт.
2. СЮАНЬ — 1 шт.
3. ХАО ХЭ — 1 шт.
4. ДИСК БИ — 1 шт.
5. ПУЭРИН — 1 шт.`

/** Сколько карточек отрисовывать за раз. */
const PAGE_SIZE = 48

type Dialog = 'paste' | 'excel' | 'sets' | 'cart' | 'checkout' | null

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch(CATALOG_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data: Catalog) => alive && setCatalog(data))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [])

  if (error) {
    return (
      <div className="boot">
        <img className="boot-logo" src={logoUrl} alt="Бадучай" width={150} height={111} />
        <div className="note note-danger">Не удалось загрузить каталог: {error}</div>
      </div>
    )
  }
  if (!catalog) {
    return (
      <div className="boot">
        <img className="boot-logo" src={logoUrl} alt="Бадучай" width={150} height={111} />
        <p className="hint">Загружаем каталог…</p>
      </div>
    )
  }
  return <Shop catalog={catalog} />
}

function Shop({ catalog }: { catalog: Catalog }) {
  const products = catalog.products
  const index = useMemo<ProductIndex>(() => buildIndex(products), [products])
  const byId = useMemo(() => new Map<number, Product>(products.map((p) => [p.source_id, p])), [products])
  const tree = useMemo(() => buildCategoryTree(catalog.categories), [catalog.categories])

  const snapshotDate = useMemo(
    () =>
      new Date(catalog.meta.fetched_at).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    [catalog.meta.fetched_at],
  )

  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<number | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const cart = useCart(byId)

  // поиск по полутора тысячам позиций — откладываем, чтобы ввод не дёргался
  const deferredQuery = useDeferredValue(query)
  const visible = useMemo(
    () => searchProducts(filterByCategory(products, category), deferredQuery),
    [products, category, deferredQuery],
  )

  // Каталог большой: показываем порцию и добавляем следующие по мере прокрутки.
  const [limit, setLimit] = useState(PAGE_SIZE)
  useEffect(() => setLimit(PAGE_SIZE), [category, deferredQuery])
  const shown = useMemo(() => visible.slice(0, limit), [visible, limit])
  const sentinel = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const node = sentinel.current
    if (!node || limit >= visible.length) return
    const io = new IntersectionObserver(
      (entries) => entries[0]?.isIntersecting && setLimit((n) => n + PAGE_SIZE),
      { rootMargin: '600px' },
    )
    io.observe(node)
    return () => io.disconnect()
  }, [limit, visible.length])

  const setQty = cart.setQty
  const rows = useMemo(() => filterRows(tree, category), [tree, category])
  const crumbs = useMemo(() => pathTo(tree, category), [tree, category])
  const { totals } = cart

  const ctx = { catalog, index, byId, tree, snapshotDate, cart }

  return (
    <>
      <div className="demo-bar">
        <strong>Демонстрационный прототип.</strong>{' '}
        <span className="demo-full">
          Настоящие заказы не принимаются и не оплачиваются. Данные каталога — снимок публичного
          сайта baduchai.ru от {snapshotDate}.
        </span>
        <span className="demo-short">Заказы не принимаются. Каталог от {snapshotDate}.</span>
      </div>

      <header className="header">
        <div className="header-inner">
          <div className="brand">
            <img className="brand-logo" src={logoUrl} alt="Бадучай — выпил и понял!" width={104} height={77} />
            <span className="brand-sub">каталог · прототип</span>
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
          <CategoryFilter
            rows={rows}
            crumbs={crumbs}
            selected={category}
            total={products.length}
            onSelect={setCategory}
          />

          <p className="result-line" data-testid="result-count">
            {visible.length === 0
              ? 'Ничего не найдено'
              : `Найдено ${visible.length} из ${products.length} товаров`}
            {visible.length > shown.length && `, показано ${shown.length}`}
            {query && ` по запросу «${query}»`}
          </p>

          {visible.length === 0 ? (
            <div className="panel">
              <div className="empty">
                <span className="empty-mark">⌕</span>
                Ничего не нашлось. Попробуйте часть названия, артикул (например, SHU-47) или
                выберите «Весь каталог».
              </div>
            </div>
          ) : (
            <>
              <div className="grid" data-testid="grid">
                {shown.map((p) => (
                  <ProductCard
                    key={p.source_id}
                    product={p}
                    qty={cart.qtyOf(p.source_id)}
                    onQty={setQty}
                  />
                ))}
              </div>
              {limit < visible.length && (
                <div className="more" ref={sentinel}>
                  <button className="btn" onClick={() => setLimit((n) => n + PAGE_SIZE)} data-testid="show-more">
                    Показать ещё ({visible.length - shown.length})
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        <aside className="side">
          <CartPanel cart={cart} onCheckout={() => setDialog('checkout')} />
        </aside>
      </main>

      <Footer catalog={catalog} snapshotDate={snapshotDate} />

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

      {dialog === 'paste' && <PasteDialog ctx={ctx} onClose={() => setDialog(null)} />}
      {dialog === 'excel' && <ExcelDialog ctx={ctx} onClose={() => setDialog(null)} />}
      {dialog === 'sets' && <SetsDialog ctx={ctx} onClose={() => setDialog(null)} />}
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
interface Ctx {
  catalog: Catalog
  index: ProductIndex
  byId: Map<number, Product>
  tree: CategoryTree
  snapshotDate: string
  cart: CartApi
}

/**
 * Фильтр повторяет устройство меню исходного сайта: рубрики верхнего уровня,
 * под ними — подрубрики выбранной, и так далее вглубь.
 */
function CategoryFilter({
  rows,
  crumbs,
  selected,
  total,
  onSelect,
}: {
  rows: CategoryNode[][]
  crumbs: CategoryNode[]
  selected: number | null
  total: number
  onSelect: (id: number | null) => void
}) {
  return (
    <div className="filter" data-testid="category-filter">
      {rows.map((row, level) => (
        <div className={`chips${level > 0 ? ' chips-sub' : ''}`} key={level}>
          {level === 0 && (
            <button className="chip" aria-pressed={selected === null} onClick={() => onSelect(null)}>
              Весь каталог <span className="chip-count">{total}</span>
            </button>
          )}
          {level > 0 && <span className="chips-label">в рубрике «{crumbs[level - 1]?.name}»:</span>}
          {row.map((c) => (
            <button
              key={c.id}
              className="chip"
              aria-pressed={crumbs.some((x) => x.id === c.id)}
              data-testid={`chip-${c.slug}`}
              onClick={() => onSelect(crumbs.some((x) => x.id === c.id) ? (c.parent ?? null) : c.id)}
            >
              {c.name} <span className="chip-count">{c.count}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

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
  const [comment, setComment] = useState('')
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
                    {item.product.sku ? `${item.product.sku} · ` : ''}
                    {unitLabel(item.product)}
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
                <div className="cart-line-sum">
                  {formatMoney(item.lineTotalMinor, totals.currencySymbol)}
                  {item.qty > 1 && (
                    <span className="cart-line-each">
                      {formatMoney(item.product.price_minor, totals.currencySymbol)} × {item.qty}
                    </span>
                  )}
                </div>
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
            <div className="note note-warn" style={{ marginTop: 10 }} data-testid="weight-note">
              Магазин не публикует вес для{' '}
              {totals.unknownWeightItems
                .map((p) => `«${p.name_short}»${p.sku ? ` (${p.sku})` : ''}`)
                .join(', ')}
              . Поэтому общий вес показан как нижняя граница — остальные позиции в нём учтены
              полностью.
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
                placeholder="Комментарий к набору (необязательно)"
                value={comment}
                aria-label="Комментарий к сохраняемому набору"
                onChange={(e) => { setComment(e.target.value); setSaved(null) }}
              />
              <button
                className="btn"
                data-testid="save-set"
                onClick={() => {
                  cart.saveCurrentSet(comment)
                  setComment('')
                  setSaved('Набор сохранён на этом устройстве — его можно повторить через «Наборы».')
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

function PasteDialog({ ctx, onClose }: { ctx: Ctx; onClose: () => void }) {
  const [text, setText] = useState('')
  const [applied, setApplied] = useState<string | null>(null)
  const report = useMemo(() => parseOrderText(ctx.index, text), [ctx.index, text])

  const apply = useCallback(
    (lines: CartLine[], mode: ApplyMode) => {
      ctx.cart.applyLines(lines, mode)
      const packages = lines.reduce((s, l) => s + l.qty, 0)
      setApplied(
        `${mode === 'replace' ? 'Корзина заменена' : 'Добавлено к корзине'}: ${lines.length} поз., ${packages} упак. Повторное применение этого списка не нужно.`,
      )
    },
    [ctx.cart],
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

function ExcelDialog({ ctx, onClose }: { ctx: Ctx; onClose: () => void }) {
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [applied, setApplied] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const download = () => {
    const bytes = buildPriceTemplate(ctx.catalog.products)
    const blob = new Blob([bytes as unknown as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `baduchai-prays-${ctx.catalog.meta.fetched_at.slice(0, 10)}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  const onFile = async (file: File) => {
    setError(null)
    setApplied(null)
    setFileName(file.name)
    try {
      const buf = new Uint8Array(await file.arrayBuffer())
      setOutcome(parseWorkbook(ctx.index, buf))
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
            ctx.cart.applyLines(lines, mode)
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

function SetsDialog({ ctx, onClose }: { ctx: Ctx; onClose: () => void }) {
  const [note, setNote] = useState<string | null>(null)
  const { cart, byId } = ctx

  const load = (id: string, mode: ApplyMode) => {
    const set = cart.sets.find((s) => s.id === id)
    if (!set) return
    const report = restoreSet(set.lines, byId)
    cart.applyLines(report.lines, mode)

    const parts = [
      `${mode === 'replace' ? 'Корзина заменена' : 'Добавлено'}: ${report.restored.length} поз.`,
    ]
    if (report.missing.length) {
      parts.push(`Нет в текущем снимке каталога (${report.missing.length}): id ${report.missing.join(', ')} — эти товары пропущены.`)
    }
    if (report.unavailable.length) {
      parts.push(`Стали недоступны: ${report.unavailable.map((p) => `${p.name_short}${p.sku ? ` (${p.sku})` : ''}`).join(', ')} — не добавлены.`)
    }
    parts.push(`Цены и вес пересчитаны по снимку каталога от ${ctx.snapshotDate}.`)
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
            const report = restoreSet(s.lines, byId)
            const amount = report.restored.reduce((sum, r) => sum + r.product.price_minor * r.qty, 0)
            const packages = report.restored.reduce((sum, r) => sum + r.qty, 0)
            return (
              <li className="set-item" key={s.id}>
                <div className="set-name">{describeSet(s, byId)}</div>
                {s.comment && <div className="set-comment">{s.comment}</div>}
                <div className="set-meta">
                  {new Date(s.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} ·{' '}
                  {s.lines.length} поз., {packages} упак. · по текущему снимку {formatMoney(amount)}
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

function Footer({ catalog, snapshotDate }: { catalog: Catalog; snapshotDate: string }) {
  const teaNoWeight = catalog.meta.tea_without_weight ?? []
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
          <a href="https://baduchai.ru/" target="_blank" rel="noreferrer noopener">baduchai.ru</a>.
          Снимок от {snapshotDate}: {catalog.meta.product_count} товаров,{' '}
          {catalog.meta.category_count} рубрик. Цены и наличие — как опубликованы на эту дату.
        </div>
        <div>
          <strong>Ограничения снимка</strong>
          <br />
          {teaNoWeight.length > 0 && (
            <>Вес не опубликован у {teaNoWeight.length} чайных позиций — он не подставляется и не
            включается в точный итог. </>
          )}
          Оптовые цены, скидки, остатки и отзывы не показываются, так как магазин их не публикует.
        </div>
      </div>
    </footer>
  )
}
