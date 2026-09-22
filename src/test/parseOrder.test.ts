import { describe, it, expect } from 'vitest'
import { index, byId, CONTROL_LIST } from './helpers'
import { parseOrderText, applicableRows, splitLine } from '../lib/parseOrder'
import { parseQuantity, clampQty } from '../lib/qty'
import { buildCart, computeTotals } from '../lib/totals'

describe('разбор количества', () => {
  it('принимает обычные записи', () => {
    for (const [raw, expected] of [['2', 2], ['2 шт.', 2], ['3шт', 3], [' 10 упаковок ', 10], ['1 pcs', 1]] as const) {
      const r = parseQuantity(raw)
      expect(r.ok, raw).toBe(true)
      if (r.ok) expect(r.value, raw).toBe(expected)
    }
  })

  it('отклоняет ноль, отрицательные и дробные', () => {
    for (const raw of ['0', '0 шт', '-1', '-3 шт.', '1.5', '2,5', '0.5 шт']) {
      const r = parseQuantity(raw)
      expect(r.ok, raw).toBe(false)
    }
  })

  it('отклоняет нечисловые и чрезмерные значения', () => {
    expect(parseQuantity('много').ok).toBe(false)
    expect(parseQuantity('').ok).toBe(false)
    expect(parseQuantity('100000').ok).toBe(false)
  })

  it('clampQty приводит ввод к целому в допустимом диапазоне', () => {
    expect(clampQty(-5)).toBe(0)
    expect(clampQty(2.7)).toBe(2)
    expect(clampQty(NaN)).toBe(0)
    expect(clampQty(10_000)).toBe(999)
  })
})

describe('разбиение строки', () => {
  it('срезает нумерацию и маркеры списка', () => {
    for (const line of ['1. БА — 2 шт.', '2) БА — 2 шт.', '- БА — 2 шт.', '• БА — 2 шт.']) {
      expect(splitLine(line)[0], line).toMatchObject({ name: 'БА' })
    }
  })

  it('понимает разные разделители', () => {
    for (const line of ['БА — 2', 'БА – 2', 'БА - 2', 'БА: 2', 'БА | 2', 'БА x 2', 'БА × 2', 'БА\t2']) {
      const first = splitLine(line)[0]
      expect(first.name, line).toBe('БА')
      expect(parseQuantity(first.qty).ok, line).toBe(true)
    }
  })

  it('не путает дефис артикула с разделителем', () => {
    const r = parseOrderText(index, 'SHU-47 — 2')
    expect(r.rows[0].status).toBe('ok')
    expect(r.rows[0].product?.source_id).toBe(65038)
    expect(r.rows[0].qty).toBe(2)
  })
})

describe('вставка списка заказом', () => {
  it('контрольный список из задания разбирается полностью', () => {
    const report = parseOrderText(index, CONTROL_LIST)
    expect(report.totalLines).toBe(5)
    expect(report.rows).toHaveLength(5)
    expect(report.rows.every((r) => r.status === 'ok')).toBe(true)
    expect(report.rows.map((r) => r.product!.sku)).toEqual([
      'SHU-47', 'SHU-38', 'SHU-32', 'SHU-49', 'SHU-10',
    ])
    expect(report.rows.map((r) => r.qty)).toEqual([2, 1, 1, 1, 1])
  })

  it('контрольный список даёт 5 позиций, 6 упаковок, 1154 г и $206', () => {
    const report = parseOrderText(index, CONTROL_LIST)
    const lines = applicableRows(report.rows).map((r) => ({ source_id: r.product!.source_id, qty: r.qty! }))
    const totals = computeTotals(buildCart(lines, byId))

    expect(totals.positions).toBe(5)
    expect(totals.packages).toBe(6)
    expect(totals.knownWeightG).toBe(1154)
    expect(totals.weightComplete).toBe(true)
    expect(totals.amountMinor).toBe(20600) // $206.00
    expect(totals.currency).toBe('USD')
  })

  it('список по артикулам разбирается так же', () => {
    const report = parseOrderText(index, 'SHU-47 — 2\nSHU-38 — 1')
    expect(report.rows.map((r) => r.status)).toEqual(['ok', 'ok'])
    expect(report.rows.map((r) => r.qty)).toEqual([2, 1])
  })

  it('пустые строки и произвольные пробелы не мешают', () => {
    const report = parseOrderText(index, '\n\n  БА   —   2 шт.  \n\n\tСЮАНЬ\t—\t1\n\n')
    expect(report.totalLines).toBe(2)
    expect(report.rows.every((r) => r.status === 'ok')).toBe(true)
  })

  it('строка без количества считается одной упаковкой', () => {
    const report = parseOrderText(index, 'ХАО ХЭ')
    expect(report.rows[0].status).toBe('ok')
    expect(report.rows[0].qty).toBe(1)
  })

  it('дубликаты объединяются явно, а не удваиваются молча', () => {
    const report = parseOrderText(index, 'БА — 2\nСЮАНЬ — 1\nБА — 3')
    expect(report.mergedCount).toBe(1)
    expect(report.rows).toHaveLength(2)
    const ba = report.rows.find((r) => r.product?.sku === 'SHU-47')!
    expect(ba.qty).toBe(5)
    expect(ba.merged).toBe(true)
    expect(ba.lines).toEqual([1, 3])
    expect(ba.message).toContain('Дубликат')
  })

  it('неизвестное название помечается, а не подменяется', () => {
    const report = parseOrderText(index, 'БА — 1\nЧай которого нет в каталоге — 2')
    expect(report.rows[0].status).toBe('ok')
    expect(report.rows[1].status).toBe('not_found')
    expect(report.rows[1].product).toBeNull()
    expect(applicableRows(report.rows)).toHaveLength(1)
  })

  it('неоднозначное название требует выбора', () => {
    const report = parseOrderText(index, 'Инь Чжень — 1')
    expect(report.rows[0].status).toBe('ambiguous')
    expect(report.rows[0].product).toBeNull()
    expect(report.rows[0].candidates.length).toBeGreaterThan(1)
    expect(applicableRows(report.rows)).toHaveLength(0)
  })

  it('коллизия артикулов магазина тоже требует выбора', () => {
    const report = parseOrderText(index, 'O-16 — 1')
    expect(report.rows[0].status).toBe('ambiguous')
    expect(applicableRows(report.rows)).toHaveLength(0)
  })

  it('некорректное количество отклоняется с причиной', () => {
    const report = parseOrderText(index, 'БА — 0\nСЮАНЬ — -2\nХАО ХЭ — 1,5')
    expect(report.rows.map((r) => r.status)).toEqual(['invalid_qty', 'invalid_qty', 'invalid_qty'])
    expect(report.rows[0].message).toContain('0')
    expect(report.rows[1].message).toContain('трицательн')
    expect(report.rows[2].message).toContain('робн')
    expect(applicableRows(report.rows)).toHaveLength(0)
  })

  it('товар не в наличии не попадает в корзину молча', () => {
    // артикул однозначен, в отличие от названия: в большом каталоге имена повторяются
    const out = [...byId.values()].find((p) => !p.in_stock && p.sku)
    expect(out, 'в снимке нет товара без наличия').toBeDefined()
    const report = parseOrderText(index, `${out!.sku} — 1`)
    expect(report.rows[0].status).toBe('unavailable')
    expect(applicableRows(report.rows)).toHaveLength(0)
  })

  it('разбор детерминирован: повтор даёт тот же результат', () => {
    const a = parseOrderText(index, CONTROL_LIST)
    const b = parseOrderText(index, CONTROL_LIST)
    expect(JSON.stringify(a.rows.map((r) => [r.product?.sku, r.qty, r.status])))
      .toBe(JSON.stringify(b.rows.map((r) => [r.product?.sku, r.qty, r.status])))
  })
})

describe('сообщения об ошибках', () => {
  it('в «не найдено» показывается название, а не строка целиком', () => {
    const report = parseOrderText(index, 'Лапсанг Сушонг 2077 — 1')
    expect(report.rows[0].status).toBe('not_found')
    expect(report.rows[0].queryText).toBe('Лапсанг Сушонг 2077')
    expect(report.rows[0].raw).toBe('Лапсанг Сушонг 2077 — 1')
  })

  it('нечисловое количество отклоняется по количеству, а не по товару', () => {
    const report = parseOrderText(index, 'ДИСК БИ — две')
    expect(report.rows[0].status).toBe('invalid_qty')
    expect(report.rows[0].message).toContain('две')
  })

  it('исходная строка сохраняется для предпросмотра', () => {
    const report = parseOrderText(index, '  1. БА — 2 шт.  ')
    expect(report.rows[0].raw).toBe('1. БА — 2 шт.')
    expect(report.rows[0].lines).toEqual([1])
  })
})
