import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import type { Product } from './types'
import { STYLES, S } from './xlsxStyles'

/**
 * Минимальные чтение и запись .xlsx без внешних офисных библиотек.
 *
 * Безопасность:
 *  — данные каталога всегда пишутся как строка (`inlineStr`) или число и
 *    формулой стать не могут: текст, начинающийся с = + - @ и управляющих
 *    символов, дополнительно экранируется апострофом;
 *  — формулы в файле есть, но только наши собственные и только арифметические:
 *    сумма строки D*G и итоги SUM по колонкам. Они не зависят от текста и
 *    перечислены в FORMULA_CELLS ниже;
 *  — при чтении элемент <f> игнорируется полностью: берётся лишь сохранённое
 *    значение, никакие выражения не вычисляются.
 */

export const TEMPLATE_HEADERS = [
  'Артикул',
  'Название',
  'Фасовка',
  'Цена',
  'Валюта',
  'Наличие',
  'Количество',
  'Сумма',
] as const

/** Колонка, которую заполняет покупатель. */
export const QTY_COLUMN = 6
/** Строка с заголовками таблицы (1-based). Выше — название и строка итогов. */
export const HEADER_ROW = 3

const DANGEROUS_PREFIX = /^[=+\-@\t\r]/

/** Гасит потенциальную формулу, не меняя безопасные значения. */
export function neutralizeFormula(value: string): string {
  return DANGEROUS_PREFIX.test(value) ? `'${value}` : value
}

/** Обратная операция при чтении: ведущий апостроф — это экранирование, а не данные. */
export function unescapeCell(value: string): string {
  return value.startsWith("'") && DANGEROUS_PREFIX.test(value.slice(1)) ? value.slice(1) : value
}

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}

const CONTROL_CHARS = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]', 'g')

const escapeXml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]).replace(CONTROL_CHARS, '')

function colLetter(index: number): string {
  let n = index
  let out = ''
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

export type CellValue = string | number

function cellXml(ref: string, value: CellValue, styleIdx?: number): string {
  const style = styleIdx !== undefined ? ` s="${styleIdx}"` : ''
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"${style}><v>${value}</v></c>`
  }
  const text = neutralizeFormula(String(value ?? ''))
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Прайс" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`


/** Собирает .xlsx из таблицы значений. Первая строка — заголовки. */
export function buildXlsx(rows: CellValue[][], textColumns: number[] = []): Uint8Array {
  const textSet = new Set(textColumns)
  const sheetRows = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const ref = `${colLetter(c)}${r + 1}`
          if (r === 0) return cellXml(ref, value, S.HEADER)
          return cellXml(ref, value, textSet.has(c) ? S.SKU : undefined)
        })
        .join('')
      return `<row r="${r + 1}">${cells}</row>`
    })
    .join('')

  const widths = ['12', '46', '18', '10', '10', '16', '14']
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('')

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${widths}</cols><sheetData>${sheetRows}</sheetData></worksheet>`

  return zipSync(
    {
      '[Content_Types].xml': strToU8(CONTENT_TYPES),
      '_rels/.rels': strToU8(ROOT_RELS),
      'xl/workbook.xml': strToU8(WORKBOOK),
      'xl/_rels/workbook.xml.rels': strToU8(WORKBOOK_RELS),
      'xl/styles.xml': strToU8(STYLES),
      'xl/worksheets/sheet1.xml': strToU8(sheet),
    },
    { level: 6 },
  )
}

/** Ячейка с нашей собственной формулой. Текст каталога сюда не попадает. */
function formulaCell(ref: string, formula: string, styleIdx: number): string {
  return `<c r="${ref}" s="${styleIdx}"><f>${escapeXml(formula)}</f></c>`
}

/** Ширины колонок прайса, в знакоместах. */
const PRICE_WIDTHS = [13, 54, 14, 11, 9, 16, 13, 14]

/**
 * Прайс-лист для заполнения.
 *
 * Шапка из трёх строк закреплена: при прокрутке видны и названия колонок,
 * и строка итогов. Итоги считаются формулами, поэтому сумма обновляется прямо
 * во время заполнения, а не после загрузки файла обратно.
 */
export function buildPriceTemplate(products: Product[], snapshotDate?: string): Uint8Array {
  const first = HEADER_ROW + 1
  const last = HEADER_ROW + products.length

  const rows: string[] = []

  const title =
    `Бадучай — прайс-лист` +
    (snapshotDate ? ` · снимок каталога от ${snapshotDate}` : '') +
    ` · демонстрационный прототип, настоящий заказ не оформляется`
  rows.push(
    `<row r="1" ht="30" customHeight="1">${cellXml('A1', title, S.TITLE)}</row>`,
  )

  // Строка итогов стоит НАД таблицей и попадает в закреплённую область —
  // так сумма видна всегда, а не только в конце длинного списка.
  rows.push(
    `<row r="2" ht="26" customHeight="1">` +
      cellXml('A2', 'Заполните колонку «Количество» — итог посчитается сам', S.HINT) +
      ['B2', 'C2', 'D2', 'E2'].map((ref) => cellXml(ref, '', S.HINT)).join('') +
      cellXml('F2', 'Итого:', S.TOTAL_LABEL) +
      // SUM игнорирует количества, попавшие в ячейку как текст (частый случай
      // при вставке из переписки), и тогда сумма была бы верной, а число
      // упаковок — нулём. Умножение на 1 приводит текст к числу.
      formulaCell('G2', `SUMPRODUCT(IFERROR(G${first}:G${last}*1,0))`, S.TOTAL_QTY) +
      formulaCell('H2', `SUM(H${first}:H${last})`, S.TOTAL_SUM) +
      `</row>`,
  )

  rows.push(
    `<row r="3" ht="32" customHeight="1">` +
      TEMPLATE_HEADERS.map((h, i) =>
        cellXml(`${colLetter(i)}3`, h, i >= 3 && i !== 4 && i !== 5 ? S.HEADER_NUM : S.HEADER),
      ).join('') +
      `</row>`,
  )

  products.forEach((p, i) => {
    const r = first + i
    const pack = p.weight_g === null ? (p.pack_label ?? 'не указана') : `${p.weight_g} г`
    rows.push(
      `<row r="${r}" ht="19" customHeight="1">` +
        cellXml(`A${r}`, p.sku ?? '', S.SKU) +
        cellXml(`B${r}`, p.name_full, S.TEXT) +
        cellXml(`C${r}`, pack, S.PACK) +
        cellXml(`D${r}`, p.price_minor / 10 ** p.currency_minor_unit, S.MONEY) +
        cellXml(`E${r}`, p.currency, S.CURRENCY) +
        cellXml(`F${r}`, p.stock_label, p.in_stock ? S.STOCK_IN : S.STOCK_OUT) +
        cellXml(`G${r}`, '', S.QTY_INPUT) +
        // пока количество не введено, сумма строки остаётся пустой
        formulaCell(`H${r}`, `IF(G${r}="","",D${r}*G${r})`, S.LINE_SUM) +
        `</row>`,
    )
  })

  const cols = PRICE_WIDTHS.map(
    (w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`,
  ).join('')

  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="A1:H${last}"/>` +
    `<sheetViews><sheetView workbookViewId="0" showGridLines="0" tabSelected="1">` +
    // закрепляем три верхние строки: название, итоги и заголовки колонок
    `<pane ySplit="${HEADER_ROW}" topLeftCell="A${first}" activePane="bottomLeft" state="frozen"/>` +
    `<selection pane="bottomLeft" activeCell="G${first}" sqref="G${first}"/>` +
    `</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="18"/>` +
    `<cols>${cols}</cols>` +
    `<sheetData>${rows.join('')}</sheetData>` +
    `<autoFilter ref="A${HEADER_ROW}:H${last}"/>` +
    `<mergeCells count="1"><mergeCell ref="A1:H1"/></mergeCells>` +
    `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>` +
    `</worksheet>`

  return zipSync(
    {
      '[Content_Types].xml': strToU8(CONTENT_TYPES),
      '_rels/.rels': strToU8(ROOT_RELS),
      'xl/workbook.xml': strToU8(WORKBOOK),
      'xl/_rels/workbook.xml.rels': strToU8(WORKBOOK_RELS),
      'xl/styles.xml': strToU8(STYLES),
      'xl/worksheets/sheet1.xml': strToU8(sheet),
    },
    { level: 6 },
  )
}

function textOf(node: Element | null | undefined): string {
  return node?.textContent ?? ''
}

/** Читает первый лист книги в массив строк. Формулы не вычисляются. */
export function readXlsx(data: Uint8Array): string[][] {
  const files = unzipSync(data)
  const sheetKey =
    Object.keys(files).find((k) => /^xl\/worksheets\/sheet1\.xml$/i.test(k)) ??
    Object.keys(files).find((k) => /^xl\/worksheets\/.*\.xml$/i.test(k))
  if (!sheetKey) throw new Error('В файле нет листа: это не книга .xlsx')

  const parser = new DOMParser()

  const shared: string[] = []
  const sstKey = Object.keys(files).find((k) => /^xl\/sharedStrings\.xml$/i.test(k))
  if (sstKey) {
    const doc = parser.parseFromString(strFromU8(files[sstKey]), 'application/xml')
    for (const si of Array.from(doc.getElementsByTagName('si'))) {
      // конкатенируем все <t>, включая форматированные фрагменты <r><t>
      shared.push(Array.from(si.getElementsByTagName('t')).map(textOf).join(''))
    }
  }

  const doc = parser.parseFromString(strFromU8(files[sheetKey]), 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Повреждённый лист книги')

  const out: string[][] = []
  for (const rowEl of Array.from(doc.getElementsByTagName('row'))) {
    const rowIndex = Number(rowEl.getAttribute('r') ?? out.length + 1) - 1
    const row: string[] = []
    for (const cell of Array.from(rowEl.getElementsByTagName('c'))) {
      const ref = cell.getAttribute('r') ?? ''
      const letters = ref.replace(/[0-9]+/g, '')
      let col = 0
      for (const ch of letters) col = col * 26 + (ch.charCodeAt(0) - 64)
      col = Math.max(0, col - 1)

      const type = cell.getAttribute('t')
      let value = ''
      if (type === 'inlineStr') {
        value = Array.from(cell.getElementsByTagName('t')).map(textOf).join('')
      } else if (type === 's') {
        // <f> намеренно не читаем — берём только сохранённое значение
        value = shared[Number(textOf(cell.getElementsByTagName('v')[0]))] ?? ''
      } else {
        value = textOf(cell.getElementsByTagName('v')[0])
      }
      row[col] = unescapeCell(value.trim())
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = ''
    out[rowIndex] = row
  }
  for (let i = 0; i < out.length; i++) if (out[i] === undefined) out[i] = []
  return out
}
