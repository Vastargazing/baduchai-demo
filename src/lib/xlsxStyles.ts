/**
 * Оформление прайс-листа: палитра и типографика сайта baduchai.ru.
 *
 * Шрифт Neucha указан явно, как на сайте. Если он не установлен в системе,
 * Excel и LibreOffice молча подставят свой — вёрстка от этого не ломается,
 * потому что читаемость держится на ширинах колонок, выравнивании и цветах,
 * а не на самом начертании.
 */

export const FONT = 'Neucha'
export const FONT_FALLBACK = 'Arial'

/** Индексы стилей, на которые ссылаются ячейки через атрибут s. */
export const S = {
  DEFAULT: 0,
  TITLE: 1,
  SUBTITLE: 2,
  HEADER: 3,
  HEADER_NUM: 4,
  SKU: 5,
  TEXT: 6,
  PACK: 7,
  MONEY: 8,
  CURRENCY: 9,
  STOCK_IN: 10,
  STOCK_OUT: 11,
  QTY_INPUT: 12,
  LINE_SUM: 13,
  TOTAL_LABEL: 14,
  TOTAL_QTY: 15,
  TOTAL_SUM: 16,
  HINT: 17,
} as const

const INK = 'FF1A1A1A'
const MUTED = 'FF8C8C8C'
const WHITE = 'FFFFFFFF'
const DANGER = 'FFD0281C'
const LINE = 'FFE0E0E0'
const BAND = 'FFF4F4F4'
const INPUT_BORDER = 'FFB3B3B3'

const font = (opts: {
  size?: number
  bold?: boolean
  color?: string
  name?: string
}) =>
  `<font>${opts.bold ? '<b/>' : ''}<sz val="${opts.size ?? 11}"/><color rgb="${opts.color ?? INK}"/><name val="${opts.name ?? FONT}"/><family val="2"/><charset val="204"/></font>`

/** 0 обычный · 1 жирный · 2 крупный заголовок · 3 приглушённый · 4 белый жирный · 5 красный · 6 итоговый */
const FONTS = [
  font({}),
  font({ bold: true }),
  font({ size: 15, bold: true }),
  font({ color: MUTED }),
  font({ bold: true, color: WHITE }),
  font({ color: DANGER }),
  font({ size: 13, bold: true }),
].join('')

/** 0 нет · 1 gray125 (обязателен по схеме) · 2 чёрная шапка · 3 серая полоса итогов · 4 белый ввод */
const FILLS = [
  '<fill><patternFill patternType="none"/></fill>',
  '<fill><patternFill patternType="gray125"/></fill>',
  `<fill><patternFill patternType="solid"><fgColor rgb="${INK}"/><bgColor indexed="64"/></patternFill></fill>`,
  `<fill><patternFill patternType="solid"><fgColor rgb="${BAND}"/><bgColor indexed="64"/></patternFill></fill>`,
  `<fill><patternFill patternType="solid"><fgColor rgb="${WHITE}"/><bgColor indexed="64"/></patternFill></fill>`,
].join('')

/** 0 нет · 1 нижняя линия · 2 рамка ввода · 3 рамка итогов */
const BORDERS = [
  '<border><left/><right/><top/><bottom/><diagonal/></border>',
  `<border><left/><right/><top/><bottom style="thin"><color rgb="${LINE}"/></bottom><diagonal/></border>`,
  `<border><left style="thin"><color rgb="${INPUT_BORDER}"/></left><right style="thin"><color rgb="${INPUT_BORDER}"/></right><top style="thin"><color rgb="${INPUT_BORDER}"/></top><bottom style="thin"><color rgb="${INPUT_BORDER}"/></bottom><diagonal/></border>`,
  `<border><left/><right/><top style="thin"><color rgb="${INK}"/></top><bottom style="thin"><color rgb="${INK}"/></bottom><diagonal/></border>`,
].join('')

// 164 — текст (чтобы артикул не превратился в число), 165 — деньги, 166 — целые
const NUM_FMTS =
  '<numFmts count="3">' +
  '<numFmt numFmtId="164" formatCode="@"/>' +
  '<numFmt numFmtId="165" formatCode="#,##0.00"/>' +
  '<numFmt numFmtId="166" formatCode="#,##0"/>' +
  '</numFmts>'

const xf = (o: {
  fmt?: number
  font?: number
  fill?: number
  border?: number
  align?: string
  vertical?: string
  wrap?: boolean
  indent?: number
}) => {
  const alignment =
    o.align || o.vertical || o.wrap
      ? `<alignment${o.align ? ` horizontal="${o.align}"` : ''}${o.vertical ? ` vertical="${o.vertical}"` : ''}${o.wrap ? ' wrapText="1"' : ''}${o.indent ? ` indent="${o.indent}"` : ''}/>`
      : ''
  return (
    `<xf numFmtId="${o.fmt ?? 0}" fontId="${o.font ?? 0}" fillId="${o.fill ?? 0}" borderId="${o.border ?? 0}" xfId="0"` +
    `${o.fmt ? ' applyNumberFormat="1"' : ''}${o.font ? ' applyFont="1"' : ''}${o.fill ? ' applyFill="1"' : ''}` +
    `${o.border ? ' applyBorder="1"' : ''}${alignment ? ' applyAlignment="1"' : ''}>${alignment}</xf>`
  )
}

/** Порядок должен совпадать с константой S. */
const CELL_XFS = [
  xf({}), // DEFAULT
  xf({ font: 2, vertical: 'center' }), // TITLE
  xf({ font: 3, vertical: 'center' }), // SUBTITLE
  xf({ font: 4, fill: 2, align: 'left', vertical: 'center', wrap: true }), // HEADER
  xf({ font: 4, fill: 2, align: 'right', vertical: 'center', wrap: true }), // HEADER_NUM
  xf({ fmt: 164, border: 1, vertical: 'center' }), // SKU
  xf({ border: 1, vertical: 'center', wrap: true }), // TEXT
  xf({ border: 1, align: 'center', vertical: 'center' }), // PACK
  xf({ fmt: 165, border: 1, align: 'right', vertical: 'center' }), // MONEY
  xf({ fmt: 164, border: 1, align: 'center', vertical: 'center' }), // CURRENCY
  xf({ border: 1, align: 'center', vertical: 'center' }), // STOCK_IN
  xf({ font: 5, border: 1, align: 'center', vertical: 'center' }), // STOCK_OUT
  xf({ fmt: 166, fill: 4, border: 2, align: 'center', vertical: 'center' }), // QTY_INPUT
  xf({ fmt: 165, border: 1, align: 'right', vertical: 'center' }), // LINE_SUM
  xf({ font: 6, fill: 3, border: 3, align: 'right', vertical: 'center' }), // TOTAL_LABEL
  xf({ fmt: 166, font: 6, fill: 3, border: 3, align: 'center', vertical: 'center' }), // TOTAL_QTY
  xf({ fmt: 165, font: 6, fill: 3, border: 3, align: 'right', vertical: 'center' }), // TOTAL_SUM
  xf({ font: 3, fill: 3, border: 3, align: 'left', vertical: 'center' }), // HINT
].join('')

export const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${NUM_FMTS}<fonts count="7">${FONTS}</fonts><fills count="5">${FILLS}</fills><borders count="4">${BORDERS}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="18">${CELL_XFS}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/></styleSheet>`
