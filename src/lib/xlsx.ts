import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import type { Product } from './types'

/**
 * Минимальные чтение и запись .xlsx без внешних офисных библиотек.
 *
 * Безопасность:
 *  — при записи ячейки всегда строковые (`inlineStr`) или числовые; элемент <f>
 *    не создаётся никогда, поэтому выгруженный файл не содержит формул;
 *  — текст, начинающийся с = + - @ и управляющих символов, дополнительно
 *    экранируется апострофом, чтобы не превратиться в формулу при пересохранении
 *    в CSV или при вставке в другой редактор;
 *  — при чтении элемент <f> игнорируется: берётся только сохранённое значение,
 *    никакие выражения не вычисляются.
 */

export const TEMPLATE_HEADERS = [
  'Артикул',
  'Название',
  'Фасовка',
  'Цена',
  'Валюта',
  'Наличие',
  'Количество',
] as const

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
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Прайс" sheetId="1" r:id="rId1"/></sheets></workbook>`

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`

// s=1 — жирный заголовок, s=2 — явный текстовый формат (@) для артикулов
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="@"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

/** Собирает .xlsx из таблицы значений. Первая строка — заголовки. */
export function buildXlsx(rows: CellValue[][], textColumns: number[] = []): Uint8Array {
  const textSet = new Set(textColumns)
  const sheetRows = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const ref = `${colLetter(c)}${r + 1}`
          if (r === 0) return cellXml(ref, value, 1)
          return cellXml(ref, value, textSet.has(c) ? 2 : undefined)
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

/** Прайс-шаблон: снимок каталога плюс пустая колонка «Количество». */
export function buildPriceTemplate(products: Product[]): Uint8Array {
  const rows: CellValue[][] = [[...TEMPLATE_HEADERS]]
  for (const p of products) {
    rows.push([
      p.sku ?? '',
      p.name_full,
      p.weight_g === null ? (p.pack_label ?? 'не указана') : `${p.weight_g} г`,
      p.price_minor / 10 ** p.currency_minor_unit,
      p.currency,
      p.stock_label,
      '',
    ])
  }
  // артикул и валюта — текстовые колонки, чтобы Excel не менял их тип
  return buildXlsx(rows, [0, 4])
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
