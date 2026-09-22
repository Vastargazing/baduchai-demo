import { describe, it, expect } from 'vitest'
import { catalog, byId } from './helpers'

/** Пять товаров, заданных как обязательные ориентиры. */
const REQUIRED = [
  { id: 65038, sku: 'SHU-47', short: 'БА', weight: 120, priceMinor: 3000 },
  { id: 58812, sku: 'SHU-38', short: 'СЮАНЬ', weight: 357, priceMinor: 4800 },
  { id: 44352, sku: 'SHU-32', short: 'ХАО ХЭ', weight: 357, priceMinor: 6400 },
  { id: 66448, sku: 'SHU-49', short: 'ДИСК БИ', weight: 100, priceMinor: 2400 },
  { id: 5936, sku: 'SHU-10', short: 'ПУЭРИН', weight: 100, priceMinor: 1000 },
]

describe('снимок каталога', () => {
  it('содержит достаточное число товаров из нескольких категорий', () => {
    expect(catalog.products.length).toBeGreaterThanOrEqual(20)
    expect(catalog.categories.length).toBeGreaterThanOrEqual(3)
  })

  it('у каждого товара есть обязательные поля снимка', () => {
    for (const p of catalog.products) {
      expect(p.source_id, p.name_full).toBeTypeOf('number')
      expect(p.sku, p.name_full).toBeTruthy()
      expect(p.name_full.length, p.name_full).toBeGreaterThan(0)
      expect(p.name_short.length, p.name_full).toBeGreaterThan(0)
      expect(p.category, p.name_full).toBeTruthy()
      expect(p.price_minor, p.name_full).toBeGreaterThan(0)
      expect(p.currency, p.name_full).toBeTruthy()
      expect(p.url, p.name_full).toMatch(/^https:\/\/baduchai\.ru\//)
      expect(p.fetched_at, p.name_full).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(p.aliases.length, p.name_full).toBeGreaterThan(0)
      expect(typeof p.in_stock, p.name_full).toBe('boolean')
    }
  })

  it('вес либо опубликован, либо честно отсутствует — выдуманных значений нет', () => {
    for (const p of catalog.products) {
      if (p.weight_g === null) {
        expect(p.weight_source).toBeNull()
      } else {
        expect(p.weight_g).toBeGreaterThan(0)
        expect(['short_description', 'name', 'description']).toContain(p.weight_source)
      }
    }
  })

  it('пять обязательных товаров совпадают с публичными данными', () => {
    for (const r of REQUIRED) {
      const p = byId.get(r.id)
      expect(p, `нет товара ${r.id}`).toBeDefined()
      expect(p!.sku).toBe(r.sku)
      expect(p!.name_short).toBe(r.short)
      expect(p!.weight_g).toBe(r.weight)
      expect(p!.price_minor).toBe(r.priceMinor)
      expect(p!.currency).toBe('USD')
    }
  })

  it('фиксирует реальные коллизии артикулов исходного магазина', () => {
    // В каталоге магазина часть артикулов записана кириллической «О», часть — латинской «O».
    expect(catalog.meta.sku_collisions.length).toBeGreaterThan(0)
  })
})
