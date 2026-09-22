import { describe, it, expect } from 'vitest'
import { withQty } from '../state/useCart'
import type { CartLine } from '../lib/types'

/** SHU-29 «АР БАЙ У» и SHU-47 «БА» — та же пара, на которой баг был виден. */
const BASE: CartLine[] = [
  { source_id: 12374, qty: 9 },
  { source_id: 65038, qty: 9 },
  { source_id: 44352, qty: 2 },
]
const ids = (lines: CartLine[]) => lines.map((l) => l.source_id)

describe('порядок позиций в корзине', () => {
  it('изменение количества не переставляет строку', () => {
    const next = withQty(BASE, 12374, 10)
    expect(ids(next)).toEqual(ids(BASE))
    expect(next[0]).toEqual({ source_id: 12374, qty: 10 })
  })

  it('порядок держится при изменении любой строки, включая последнюю', () => {
    for (const line of BASE) {
      const next = withQty(BASE, line.source_id, line.qty + 1)
      expect(ids(next), `строка ${line.source_id}`).toEqual(ids(BASE))
    }
  })

  it('многократное увеличение не двигает строку', () => {
    let lines = BASE
    for (let i = 0; i < 12; i++) lines = withQty(lines, 12374, 9 + i + 1)
    expect(ids(lines)).toEqual(ids(BASE))
    expect(lines[0].qty).toBe(21)
  })

  it('уменьшение количества тоже сохраняет место', () => {
    const next = withQty(BASE, 65038, 3)
    expect(ids(next)).toEqual(ids(BASE))
    expect(next[1].qty).toBe(3)
  })

  it('новый товар дописывается в конец', () => {
    const next = withQty(BASE, 58812, 1)
    expect(ids(next)).toEqual([...ids(BASE), 58812])
  })

  it('количество 0 убирает строку, не трогая остальные', () => {
    const next = withQty(BASE, 65038, 0)
    expect(ids(next)).toEqual([12374, 44352])
  })

  it('отрицательное количество тоже убирает строку', () => {
    expect(ids(withQty(BASE, 12374, -5))).toEqual([65038, 44352])
  })

  it('удаление несуществующего товара ничего не меняет', () => {
    expect(withQty(BASE, 999999, 0)).toEqual(BASE)
  })

  it('исходный массив не мутируется', () => {
    const snapshot = JSON.stringify(BASE)
    withQty(BASE, 12374, 42)
    expect(JSON.stringify(BASE)).toBe(snapshot)
  })

  it('дубликаты не появляются', () => {
    const next = withQty(withQty(BASE, 12374, 5), 12374, 7)
    expect(next.filter((l) => l.source_id === 12374)).toHaveLength(1)
    expect(ids(next)).toEqual(ids(BASE))
  })
})
