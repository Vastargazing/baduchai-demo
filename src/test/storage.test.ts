import { describe, it, expect, beforeEach } from 'vitest'
import { byId, catalog, index, CONTROL_LIST } from './helpers'
import {
  loadCart, saveCart, loadSets, saveSets, restoreSet, sanitizeLines, newSetId,
  CART_KEY, SETS_KEY, type SavedSet,
} from '../lib/storage'
import { buildCart, computeTotals, formatMoney, formatWeight } from '../lib/totals'
import { parseOrderText, applicableRows } from '../lib/parseOrder'

beforeEach(() => localStorage.clear())

describe('сохранение корзины', () => {
  it('корзина переживает перезагрузку', () => {
    const lines = [{ source_id: 65038, qty: 2 }, { source_id: 58812, qty: 1 }]
    saveCart(lines)
    expect(loadCart()).toEqual(lines)
  })

  it('пустое и повреждённое хранилище не ломают запуск', () => {
    expect(loadCart()).toEqual([])
    localStorage.setItem(CART_KEY, '{не json')
    expect(loadCart()).toEqual([])
    localStorage.setItem(CART_KEY, '"строка"')
    expect(loadCart()).toEqual([])
  })

  it('мусор в хранилище отбрасывается, а корректные позиции остаются', () => {
    localStorage.setItem(CART_KEY, JSON.stringify([
      { source_id: 65038, qty: 2 },
      { source_id: 'нет', qty: 1 },
      { source_id: 58812, qty: -3 },
      { source_id: 44352, qty: 1.5 },
      null,
      { source_id: 65038, qty: 9 }, // дубль
      { source_id: 66448, qty: 1 },
    ]))
    expect(loadCart()).toEqual([{ source_id: 65038, qty: 2 }, { source_id: 66448, qty: 1 }])
  })

  it('восстановленная корзина считается по текущему снимку', () => {
    const report = parseOrderText(index, CONTROL_LIST)
    const lines = applicableRows(report.rows).map((r) => ({ source_id: r.product!.source_id, qty: r.qty! }))
    saveCart(lines)

    const totals = computeTotals(buildCart(loadCart(), byId))
    expect(totals.positions).toBe(5)
    expect(totals.packages).toBe(6)
    expect(totals.amountMinor).toBe(20600)
    expect(totals.knownWeightG).toBe(1154)
  })

  it('в корзине не сохраняются персональные данные', () => {
    saveCart([{ source_id: 65038, qty: 1 }])
    const raw = localStorage.getItem(CART_KEY)!
    expect(raw).toBe('[{"source_id":65038,"qty":1}]')
    expect(raw).not.toMatch(/@|mail|адрес|address|имя|phone/i)
  })

  it('sanitizeLines устойчив к неожиданному вводу', () => {
    expect(sanitizeLines(null)).toEqual([])
    expect(sanitizeLines('строка')).toEqual([])
    expect(sanitizeLines([{ source_id: 1, qty: 1 }])).toEqual([{ source_id: 1, qty: 1 }])
  })
})

describe('повтор закупки', () => {
  it('сохранённый набор загружается и пересчитывается', () => {
    const set: SavedSet = {
      id: newSetId(),
      name: 'Ежемесячный шу',
      createdAt: new Date().toISOString(),
      lines: [{ source_id: 65038, qty: 2 }, { source_id: 44352, qty: 1 }],
    }
    saveSets([set])
    const loaded = loadSets()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].name).toBe('Ежемесячный шу')

    const report = restoreSet(loaded[0].lines, byId)
    expect(report.restored).toHaveLength(2)
    expect(report.missing).toEqual([])
    const totals = computeTotals(buildCart(report.lines, byId))
    expect(totals.amountMinor).toBe(30 * 2 * 100 + 64 * 100)
  })

  it('исчезнувший товар сообщается, остальные восстанавливаются', () => {
    const report = restoreSet(
      [{ source_id: 65038, qty: 1 }, { source_id: 999_999, qty: 4 }],
      byId,
    )
    expect(report.restored).toHaveLength(1)
    expect(report.missing).toEqual([999_999])
    expect(report.lines).toHaveLength(1)
  })

  it('товар без наличия не попадает в корзину и попадает в предупреждение', () => {
    const out = catalog.products.find((p) => !p.in_stock)!
    const report = restoreSet(
      [{ source_id: out.source_id, qty: 1 }, { source_id: 65038, qty: 1 }],
      byId,
    )
    expect(report.unavailable.map((p) => p.source_id)).toEqual([out.source_id])
    expect(report.lines).toEqual([{ source_id: 65038, qty: 1 }])
  })

  it('битые наборы отбрасываются при чтении', () => {
    localStorage.setItem(SETS_KEY, JSON.stringify([{ id: '', lines: [] }, 'мусор']))
    expect(loadSets()).toEqual([])
  })
})

describe('итоги корзины', () => {
  it('без скидок и доставки: сумма равна сумме позиций', () => {
    const totals = computeTotals(buildCart([{ source_id: 65038, qty: 3 }], byId))
    expect(totals.amountMinor).toBe(9000)
    expect(totals.packages).toBe(3)
    expect(totals.positions).toBe(1)
  })

  it('неизвестный вес не выдаётся за точный общий', () => {
    const noWeight = catalog.products.find((p) => p.weight_g === null)!
    const totals = computeTotals(
      buildCart([{ source_id: 65038, qty: 1 }, { source_id: noWeight.source_id, qty: 1 }], byId),
    )
    expect(totals.knownWeightG).toBe(120)
    expect(totals.unknownWeightItems).toBe(1)
    expect(totals.weightComplete).toBe(false)
  })

  it('полный по весу заказ помечается как точный', () => {
    const totals = computeTotals(buildCart([{ source_id: 65038, qty: 2 }], byId))
    expect(totals.weightComplete).toBe(true)
    expect(totals.knownWeightG).toBe(240)
  })

  it('удалённые и нулевые позиции не учитываются', () => {
    const totals = computeTotals(
      buildCart([{ source_id: 65038, qty: 0 }, { source_id: 123, qty: 2 }], byId),
    )
    expect(totals.positions).toBe(0)
    expect(totals.amountMinor).toBe(0)
  })

  it('форматирование сумм и весов', () => {
    expect(formatMoney(20600)).toBe('$206')
    expect(formatMoney(2050)).toBe('$20,50')
    expect(formatWeight(1154)).toBe('1,154 кг')
    expect(formatWeight(357)).toBe('357 г')
  })
})
