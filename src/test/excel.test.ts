import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { catalog, index, byId } from './helpers'
import {
  buildPriceTemplate,
  buildXlsx,
  readXlsx,
  neutralizeFormula,
  unescapeCell,
  TEMPLATE_HEADERS,
  HEADER_ROW,
} from '../lib/xlsx'
import { unzipSync, strFromU8 } from 'fflate'
import { parseSheetRows, parseWorkbook } from '../lib/importSheet'
import { applicableRows } from '../lib/parseOrder'
import { buildCart, computeTotals } from '../lib/totals'

/** Лист книги как текст XML — для проверок закрепления, итогов и оформления. */
function sheetXml(bytes: Uint8Array): string {
  return strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml'])
}
function stylesXml(bytes: Uint8Array): string {
  return strFromU8(unzipSync(bytes)['xl/styles.xml'])
}

describe('прайс-шаблон', () => {
  it('содержит требуемые колонки и все товары', () => {
    const table = readXlsx(buildPriceTemplate(catalog.products))
    // строка 1 — название, строка 2 — итоги, строка 3 — заголовки
    expect(table[HEADER_ROW - 1]).toEqual([...TEMPLATE_HEADERS])
    expect(table.length).toBe(catalog.products.length + HEADER_ROW)
  })

  it('артикулы остаются текстом', () => {
    const table = readXlsx(buildPriceTemplate(catalog.products))
    for (const row of table.slice(HEADER_ROW)) {
      expect(typeof row[0]).toBe('string')
      expect(row[0].length).toBeGreaterThan(0)
    }
    const skus = table.slice(HEADER_ROW).map((r) => r[0])
    expect(skus).toContain('SHU-47')
    expect(skus).toContain('SHU-10')
  })

  it('цена, валюта и наличие берутся из снимка', () => {
    const table = readXlsx(buildPriceTemplate(catalog.products))
    const row = table.find((r) => r[0] === 'SHU-32')!
    expect(row[2]).toBe('357 г')
    expect(Number(row[3])).toBe(64)
    expect(row[4]).toBe('USD')
    expect(row[5]).toBe('В наличии')
    expect(row[6]).toBe('') // количество заполняет покупатель
  })

  it('фасовка без опубликованного веса не выдумывается', () => {
    const table = readXlsx(buildPriceTemplate(catalog.products))
    const noWeight = catalog.products.filter((p) => p.weight_g === null)
    for (const p of noWeight) {
      const row = table.find((r) => r[0] === p.sku)!
      expect(row[2]).not.toMatch(/^\d+ г$/)
    }
  })

  it('в названии листа указан снимок каталога', () => {
    const table = readXlsx(buildPriceTemplate(catalog.products, '22 сентября 2026 г.'))
    expect(table[0][0]).toContain('Бадучай')
    expect(table[0][0]).toContain('22 сентября 2026')
    expect(table[0][0]).toContain('демонстрационный прототип')
  })
})

describe('шапка прайса закреплена', () => {
  const xml = sheetXml(buildPriceTemplate(catalog.products))

  it('верхние строки не прокручиваются', () => {
    expect(xml).toContain(`<pane ySplit="${HEADER_ROW}"`)
    expect(xml).toContain('state="frozen"')
    expect(xml).toContain(`topLeftCell="A${HEADER_ROW + 1}"`)
  })

  it('курсор сразу стоит в колонке количества', () => {
    expect(xml).toContain(`activeCell="G${HEADER_ROW + 1}"`)
  })

  it('по таблице можно фильтровать', () => {
    expect(xml).toContain(`<autoFilter ref="A${HEADER_ROW}:H${HEADER_ROW + catalog.products.length}"`)
  })
})

describe('итоги в прайсе', () => {
  const bytes = buildPriceTemplate(catalog.products)
  const xml = sheetXml(bytes)
  const last = HEADER_ROW + catalog.products.length

  it('число упаковок считается даже если количество введено текстом', () => {
    // при вставке из переписки количество нередко попадает в ячейку строкой
    expect(xml).toContain('IFERROR')
  })

  it('сумма и число упаковок считаются формулами и видны всегда', () => {
    expect(xml).toContain(`<f>SUMPRODUCT(IFERROR(G${HEADER_ROW + 1}:G${last}*1,0))</f>`)
    expect(xml).toContain(`<f>SUM(H${HEADER_ROW + 1}:H${last})</f>`)
    // строка итогов находится внутри закреплённой области
    expect(2).toBeLessThanOrEqual(HEADER_ROW)
  })

  it('у каждой строки есть сумма позиции', () => {
    for (const r of [HEADER_ROW + 1, HEADER_ROW + 2, last]) {
      expect(xml).toContain(`<f>IF(G${r}=&quot;&quot;,&quot;&quot;,D${r}*G${r})</f>`)
    }
  })

  it('незаполненная строка не показывает нулевую сумму', () => {
    const table = readXlsx(bytes)
    const row = table.find((r) => r[0] === 'SHU-32')!
    expect(row[7] ?? '').toBe('')
  })

  it('колонка «Сумма» присутствует в заголовках', () => {
    expect([...TEMPLATE_HEADERS]).toContain('Сумма')
  })
})

describe('оформление прайса', () => {
  const bytes = buildPriceTemplate(catalog.products)

  it('использует шрифт сайта', () => {
    expect(stylesXml(bytes)).toContain('<name val="Neucha"/>')
  })

  it('колонки имеют заданную ширину, а не стандартную', () => {
    const xml = sheetXml(bytes)
    expect(xml).toMatch(/<col min="2" max="2" width="\d+" customWidth="1"\/>/)
  })

  it('отсутствующий товар выделен отдельным стилем', () => {
    const out = catalog.products.find((p) => !p.in_stock)!
    const idx = catalog.products.indexOf(out) + HEADER_ROW + 1
    expect(sheetXml(bytes)).toContain(`<c r="F${idx}" s="11"`)
  })
})

describe('защита от формул', () => {
  it('гасит опасные префиксы', () => {
    for (const v of ['=1+1', '+1', '-1', '@SUM(A1)', '=cmd|calc']) {
      expect(neutralizeFormula(v).startsWith("'")).toBe(true)
    }
  })

  it('не трогает обычные значения', () => {
    for (const v of ['SHU-47', 'ХАО ХЭ', '357 г', 'USD', '64']) {
      expect(neutralizeFormula(v)).toBe(v)
    }
  })

  it('экранирование обратимо', () => {
    expect(unescapeCell(neutralizeFormula('=1+1'))).toBe('=1+1')
    expect(unescapeCell(neutralizeFormula('SHU-47'))).toBe('SHU-47')
  })

  it('выгруженный файл не содержит ни одной формулы', () => {
    const bytes = buildXlsx([
      ['Артикул', 'Название', 'Количество'],
      ['=HYPERLINK("http://x")', '=1+1', 2],
    ])
    const xml = new TextDecoder().decode(bytes)
    expect(xml).not.toContain('<f>')
    const table = readXlsx(bytes)
    // значение сохранено как текст, а не как вычисляемое выражение
    expect(table[1][0]).toBe('=HYPERLINK("http://x")')
  })

  it('в формулы попадает только наша арифметика, без текста каталога', () => {
    const xml = strFromU8(unzipSync(buildPriceTemplate(catalog.products))['xl/worksheets/sheet1.xml'])
    const formulas = [...xml.matchAll(/<f>([\s\S]*?)<\/f>/g)].map((m) => m[1])
    expect(formulas.length).toBeGreaterThan(catalog.products.length)
    for (const f of formulas) {
      // допускаем только SUM/IF по ссылкам на ячейки и умножение
      expect(f, f).toMatch(
        /^(SUM\([A-H]\d+:[A-H]\d+\)|SUMPRODUCT\(IFERROR\([A-H]\d+:[A-H]\d+\*1,0\)\)|IF\([A-H]\d+=&quot;&quot;,&quot;&quot;,[A-H]\d+\*[A-H]\d+\))$/,
      )
    }
  })

  it('текст товара не превращается в формулу даже с опасным префиксом', () => {
    const bytes = buildXlsx([
      ['Артикул', 'Название', 'Количество'],
      ['=SUM(A1)', '@cmd', 2],
    ])
    const xml = new TextDecoder().decode(bytes)
    expect(xml).not.toContain('<f>')
    const table = readXlsx(bytes)
    expect(table[1][0]).toBe('=SUM(A1)')
    expect(table[1][1]).toBe('@cmd')
  })

  it('формула во входящем файле читается как значение и не вычисляется', () => {
    // лист, где ячейка содержит <f> и кэшированное значение
    const sheet =
      '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      '<row r="1"><c r="A1" t="inlineStr"><is><t>Артикул</t></is></c><c r="B1" t="inlineStr"><is><t>Количество</t></is></c></row>' +
      '<row r="2"><c r="A2" t="inlineStr"><is><t>SHU-47</t></is></c><c r="B2"><f>1+1</f><v>2</v></c></row>' +
      '</sheetData></worksheet>'
    const bytes = zipSync({ 'xl/worksheets/sheet1.xml': strToU8(sheet) })
    const table = readXlsx(bytes)
    expect(table[1]).toEqual(['SHU-47', '2'])
  })
})

describe('импорт заполненного шаблона', () => {
  /** Имитирует покупателя: берём шаблон и проставляем количества. */
  function fillTemplate(quantities: Record<string, string>) {
    const table = readXlsx(buildPriceTemplate(catalog.products))
    for (const row of table.slice(HEADER_ROW)) {
      if (quantities[row[0]] !== undefined) row[6] = quantities[row[0]]
    }
    return table
  }

  it('экспорт → заполнение → импорт даёт тот же контрольный итог', () => {
    const table = fillTemplate({
      'SHU-47': '2',
      'SHU-38': '1',
      'SHU-32': '1',
      'SHU-49': '1',
      'SHU-10': '1',
    })
    const report = parseSheetRows(index, table)

    expect(report.filledRows).toBe(5)
    expect(report.rows.every((r) => r.status === 'ok')).toBe(true)

    const lines = applicableRows(report.rows).map((r) => ({
      source_id: r.product!.source_id,
      qty: r.qty!,
    }))
    const totals = computeTotals(buildCart(lines, byId))
    expect(totals.positions).toBe(5)
    expect(totals.packages).toBe(6)
    expect(totals.knownWeightG).toBe(1154)
    expect(totals.amountMinor).toBe(20600)
  })

  it('незаполненные строки шаблона игнорируются', () => {
    const report = parseSheetRows(index, fillTemplate({ 'SHU-47': '2' }))
    expect(report.filledRows).toBe(1)
    expect(report.rows).toHaveLength(1)
  })

  it('проходит полный цикл через байты файла', () => {
    const table = fillTemplate({ 'SHU-32': '3' })
    const bytes = buildXlsx(table as unknown as (string | number)[][], [0, 4])
    const report = parseWorkbook(index, bytes)
    expect(report.rows[0].product?.sku).toBe('SHU-32')
    expect(report.rows[0].qty).toBe(3)
  })

  it('применяет те же проверки количества, что и текстовый заказ', () => {
    const report = parseSheetRows(index, [
      [...TEMPLATE_HEADERS],
      ['SHU-47', 'БА', '120 г', '30', 'USD', 'В наличии', '0'],
      ['SHU-38', 'СЮАНЬ', '357 г', '48', 'USD', 'В наличии', '-2'],
      ['SHU-32', 'ХАО ХЭ', '357 г', '64', 'USD', 'В наличии', '1,5'],
      ['SHU-49', 'ДИСК БИ', '100 г', '24', 'USD', 'В наличии', 'две'],
    ])
    expect(report.rows.map((r) => r.status)).toEqual([
      'invalid_qty', 'invalid_qty', 'invalid_qty', 'invalid_qty',
    ])
    expect(applicableRows(report.rows)).toHaveLength(0)
  })

  it('неизвестный артикул помечается, остальные строки проходят', () => {
    const report = parseSheetRows(index, [
      [...TEMPLATE_HEADERS],
      ['SHU-47', 'БА', '120 г', '30', 'USD', 'В наличии', '1'],
      ['НЕТ-999', 'Выдуманный чай', '100 г', '1', 'USD', 'В наличии', '2'],
    ])
    expect(report.rows[0].status).toBe('ok')
    expect(report.rows[1].status).toBe('not_found')
    expect(applicableRows(report.rows)).toHaveLength(1)
  })

  it('дубликаты артикулов в файле объединяются явно', () => {
    const report = parseSheetRows(index, [
      [...TEMPLATE_HEADERS],
      ['SHU-47', 'БА', '120 г', '30', 'USD', 'В наличии', '2'],
      ['SHU-47', 'БА', '120 г', '30', 'USD', 'В наличии', '3'],
    ])
    expect(report.mergedCount).toBe(1)
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0].qty).toBe(5)
    expect(report.rows[0].merged).toBe(true)
  })

  it('из файла берутся только артикул, название и количество', () => {
    // покупатель мог поправить в Excel цену, название и колонку «Сумма» —
    // на заказ это влиять не должно: цена всегда берётся из снимка каталога
    const report = parseSheetRows(index, [
      [...TEMPLATE_HEADERS],
      ['SHU-47', 'Совсем другое название', '120 г', '1', 'EUR', 'В наличии', '2', '999999'],
    ])
    expect(report.rows[0].status).toBe('ok')
    expect(report.rows[0].product!.sku).toBe('SHU-47')

    const lines = applicableRows(report.rows).map((r) => ({
      source_id: r.product!.source_id,
      qty: r.qty!,
    }))
    const totals = computeTotals(buildCart(lines, byId))
    expect(totals.amountMinor).toBe(6000) // 2 × $30 из каталога, а не из файла
    expect(totals.currency).toBe('USD')
  })

  it('импорт не меняет корзину сам: строки лишь предлагаются к применению', () => {
    const report = parseSheetRows(index, [
      [...TEMPLATE_HEADERS],
      ['SHU-47', 'БА', '120 г', '30', 'USD', 'В наличии', '2', ''],
      ['Инь Чжень', '', '', '', '', '', '1', ''],
      ['НЕТ-999', 'Выдуманный', '', '', '', '', '3', ''],
    ])
    // применить можно только однозначно распознанные строки
    expect(applicableRows(report.rows).map((r) => r.product!.sku)).toEqual(['SHU-47'])
    expect(report.rows.map((r) => r.status)).toEqual(['ok', 'ambiguous', 'not_found'])
  })

  it('понимает переставленные колонки по заголовкам', () => {
    const report = parseSheetRows(index, [
      ['Количество', 'Название', 'Артикул'],
      ['2', 'БА', 'SHU-47'],
    ])
    expect(report.rows[0].status).toBe('ok')
    expect(report.rows[0].product?.sku).toBe('SHU-47')
    expect(report.rows[0].qty).toBe(2)
  })

  it('посторонний файл не принимается за книгу', () => {
    expect(() => readXlsx(new Uint8Array([1, 2, 3, 4]))).toThrow()
  })
})
