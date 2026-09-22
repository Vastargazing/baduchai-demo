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
} from '../lib/xlsx'
import { parseSheetRows, parseWorkbook } from '../lib/importSheet'
import { applicableRows } from '../lib/parseOrder'
import { buildCart, computeTotals } from '../lib/totals'

describe('прайс-шаблон', () => {
  it('содержит требуемые колонки и все товары', () => {
    const table = readXlsx(buildPriceTemplate(catalog.products))
    expect(table[0]).toEqual([...TEMPLATE_HEADERS])
    expect(table.length).toBe(catalog.products.length + 1)
  })

  it('артикулы остаются текстом', () => {
    const table = readXlsx(buildPriceTemplate(catalog.products))
    for (const row of table.slice(1)) {
      expect(typeof row[0]).toBe('string')
      expect(row[0].length).toBeGreaterThan(0)
    }
    const skus = table.slice(1).map((r) => r[0])
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
    for (const row of table.slice(1)) {
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
