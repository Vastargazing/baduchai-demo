import { describe, it, expect } from 'vitest'
import { catalog } from './helpers'
import { buildCategoryTree, filterRows, pathTo, filterByCategory } from '../lib/categories'

const tree = buildCategoryTree(catalog.categories)
const byName = (name: string) => catalog.categories.find((c) => c.name === name)

describe('дерево рубрик', () => {
  it('повторяет устройство меню магазина: чай — рубрика с подрубриками', () => {
    const tea = byName('ЧАЙ')!
    expect(tea, 'нет рубрики ЧАЙ').toBeDefined()
    expect(tree.roots.map((c) => c.name)).toContain('ЧАЙ')

    const children = tree.childrenOf.get(tea.id) ?? []
    const names = children.map((c) => c.name)
    for (const expected of ['Шу Пуэр', 'Улун', 'Красный', 'Зеленый', 'Белый', 'Шен Пуэр']) {
      expect(names, `нет подрубрики ${expected}`).toContain(expected)
    }
  })

  it('у «Улун» есть третий уровень, как в меню сайта', () => {
    const oolong = byName('Улун')!
    const names = (tree.childrenOf.get(oolong.id) ?? []).map((c) => c.name)
    expect(names).toContain('Коллекционные Утёсные улуны')
    expect(names).toContain('Четыре Знаменитых Чайных Куста')
    expect(names).toContain('Цин Хо (лёгкая прожарка)')
    expect(names).toContain('Чжун Цзу Хо (глубокая прожарка)')
  })

  it('корневые рубрики магазина присутствуют', () => {
    const roots = tree.roots.map((c) => c.name)
    for (const expected of ['ЧАЙ', 'ЧАЙНИКИ', 'НЕФРИТ ЮЙ', 'ЧАШКИ', 'НАХОДКИ', 'САНДАЛ']) {
      expect(roots, `нет рубрики ${expected}`).toContain(expected)
    }
  })

  it('ни одна рубрика не является своим предком', () => {
    for (const c of catalog.categories) {
      const chain = pathTo(tree, c.id)
      expect(new Set(chain.map((x) => x.id)).size, c.name).toBe(chain.length)
      expect(chain.at(-1)?.id).toBe(c.id)
    }
  })
})

describe('фильтр по рубрике', () => {
  it('родительская рубрика включает товары вложенных', () => {
    const tea = byName('ЧАЙ')!
    const shu = byName('Шу Пуэр')!
    const inTea = filterByCategory(catalog.products, tea.id)
    const inShu = filterByCategory(catalog.products, shu.id)

    expect(inShu.length).toBeGreaterThan(0)
    expect(inTea.length).toBeGreaterThanOrEqual(inShu.length)
    for (const p of inShu) {
      expect(inTea.map((x) => x.source_id), p.name_short).toContain(p.source_id)
    }
  })

  it('третий уровень вложен во второй и в первый', () => {
    const tea = byName('ЧАЙ')!
    const oolong = byName('Улун')!
    const deep = byName('Чжун Цзу Хо (глубокая прожарка)')!
    for (const p of filterByCategory(catalog.products, deep.id)) {
      expect(p.category_ids, p.name_short).toContain(oolong.id)
      expect(p.category_ids, p.name_short).toContain(tea.id)
    }
  })

  it('без выбранной рубрики показывается весь каталог', () => {
    expect(filterByCategory(catalog.products, null)).toHaveLength(catalog.products.length)
  })

  it('чайные товары помечены как чай, а предметы — нет', () => {
    const tea = byName('ЧАЙ')!
    for (const p of filterByCategory(catalog.products, tea.id)) {
      expect(p.is_tea, p.name_short).toBe(true)
      expect(p.weight_expected, p.name_short).toBe(true)
    }
    const teapots = byName('ЧАЙНИКИ')
    if (teapots) {
      for (const p of filterByCategory(catalog.products, teapots.id)) {
        expect(p.weight_expected, p.name_short).toBe(false)
      }
    }
  })
})

describe('ряды фильтра', () => {
  it('без выбора показан только верхний уровень', () => {
    const rows = filterRows(tree, null)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(tree.roots)
  })

  it('выбор рубрики с детьми открывает следующий уровень', () => {
    const tea = byName('ЧАЙ')!
    const rows = filterRows(tree, tea.id)
    expect(rows).toHaveLength(2)
    expect(rows[1].map((c) => c.name)).toContain('Улун')
  })

  it('выбор «Улун» открывает третий ряд', () => {
    const oolong = byName('Улун')!
    const rows = filterRows(tree, oolong.id)
    expect(rows).toHaveLength(3)
    expect(rows[2].map((c) => c.name)).toContain('Цин Хо (лёгкая прожарка)')
  })

  it('рубрика без детей лишний ряд не добавляет', () => {
    const shu = byName('Шу Пуэр')!
    expect(filterRows(tree, shu.id)).toHaveLength(2)
  })
})
