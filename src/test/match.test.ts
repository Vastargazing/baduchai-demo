import { describe, it, expect } from 'vitest'
import { index, bySku } from './helpers'
import { matchProduct, searchProducts } from '../lib/match'
import { catalog } from './helpers'
import { normSku, normName, looksLikeSku } from '../lib/text'

describe('нормализация', () => {
  it('приводит артикул к одному алфавиту и форме', () => {
    expect(normSku('shu-47')).toBe('SHU47')
    expect(normSku('SHU 47')).toBe('SHU47')
    expect(normSku('О-16')).toBe(normSku('O-16')) // кириллическая и латинская «O»
  })

  it('игнорирует регистр, ё и иероглифы в названии', () => {
    expect(normName('ХАО ХЭ')).toBe('хао хэ')
    expect(normName('Копчёный')).toBe(normName('Копченый'))
    expect(normName('Да Хун Пао 大红袍')).toBe('да хун пао')
  })

  it('отличает артикул от названия', () => {
    expect(looksLikeSku('SHU-47')).toBe(true)
    expect(looksLikeSku('ХАО ХЭ')).toBe(false)
  })
})

describe('сопоставление товара', () => {
  it('находит по короткому названию', () => {
    const r = matchProduct(index, 'ХАО ХЭ')
    expect(r.kind).toBe('exact')
    expect(r.candidates[0].sku).toBe('SHU-32')
  })

  it('не зависит от регистра и лишних пробелов', () => {
    for (const q of ['хао хэ', '  ХаО   Хэ ', 'ХАОХЭ']) {
      const r = matchProduct(index, q)
      expect(r.kind, q).toBe('exact')
      expect(r.candidates[0].sku, q).toBe('SHU-32')
    }
  })

  it('находит по артикулу в любом написании', () => {
    for (const q of ['SHU-47', 'shu-47', 'SHU47', 'shu 47']) {
      const r = matchProduct(index, q)
      expect(r.kind, q).toBe('exact')
      expect(r.candidates[0].source_id, q).toBe(65038)
    }
  })

  it('находит по китайскому названию как псевдониму', () => {
    const r = matchProduct(index, '好喝熟普洱饼')
    expect(r.kind).toBe('exact')
    expect(r.candidates[0].sku).toBe('SHU-32')
  })

  it('неизвестное название не подставляет товар молча', () => {
    const r = matchProduct(index, 'Лапсанг Сушонг Премиум 2077')
    expect(r.kind).toBe('not_found')
    expect(r.candidates).toHaveLength(0)
  })

  it('коллизия артикулов магазина даёт неоднозначность, а не случайный выбор', () => {
    const r = matchProduct(index, 'O-16')
    expect(r.kind).toBe('ambiguous')
    expect(r.candidates.length).toBeGreaterThan(1)
  })

  it('частичное название с несколькими совпадениями — неоднозначность', () => {
    const r = matchProduct(index, 'Инь Чжень')
    expect(r.kind).toBe('ambiguous')
    expect(r.candidates.length).toBeGreaterThan(1)
  })

  it('точное имя выигрывает у подстроки', () => {
    // «Шуй Сянь» есть и отдельным товаром, и частью «Лао Цун Шуй Сянь»
    const r = matchProduct(index, 'Шуй Сянь')
    expect(r.kind).toBe('exact')
    expect(r.candidates[0].sku).toBe('O-4')
  })

  it('опечатку предлагает подтвердить, а не применяет сама', () => {
    const r = matchProduct(index, 'ПУЭРИНН')
    expect(['fuzzy', 'ambiguous']).toContain(r.kind)
    expect(r.kind).not.toBe('exact')
  })
})

describe('поиск по каталогу', () => {
  it('находит по части названия', () => {
    const res = searchProducts(catalog.products, 'пуэр')
    expect(res.length).toBeGreaterThan(5)
  })

  it('находит по артикулу', () => {
    const res = searchProducts(catalog.products, 'SHU-49')
    expect(res[0].source_id).toBe(66448)
  })

  it('ставит точное совпадение имени первым', () => {
    const res = searchProducts(catalog.products, 'БА')
    expect(res[0].sku).toBe('SHU-47')
  })

  it('пустой запрос возвращает весь каталог', () => {
    expect(searchProducts(catalog.products, '  ')).toHaveLength(catalog.products.length)
  })

  it('бессмысленный запрос не возвращает ничего', () => {
    expect(searchProducts(catalog.products, 'zzzzqqqq')).toHaveLength(0)
  })

  it('товар находится по своему артикулу', () => {
    // каталог большой: берём представительную выборку, а не все позиции
    const sample = [...bySku.entries()].filter((_, i) => i % 17 === 0)
    expect(sample.length).toBeGreaterThan(20)
    for (const [sku, p] of sample) {
      const res = searchProducts(catalog.products, sku)
      expect(res.map((x) => x.source_id), sku).toContain(p.source_id)
    }
  })
})
