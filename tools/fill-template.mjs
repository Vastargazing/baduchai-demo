/**
 * Имитирует покупателя, заполняющего колонку «Количество» в скачанном прайсе.
 * Используется только в браузерной проверке: файл, который мы отдали, читается
 * и возвращается обратно в приложение уже с количествами.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate'

const SHEET = 'xl/worksheets/sheet1.xml'

/** Текст ячейки-строки (шаблон пишет только inlineStr). */
function inlineText(cellXml) {
  const m = cellXml.match(/<t[^>]*>([\s\S]*?)<\/t>/)
  return m ? m[1] : ''
}

export async function fillTemplate(srcPath, outPath, quantitiesBySku) {
  const files = unzipSync(new Uint8Array(await readFile(srcPath)))
  if (!files[SHEET]) throw new Error(`в книге нет ${SHEET}`)
  let xml = strFromU8(files[SHEET])

  let filled = 0
  xml = xml.replace(/<row [\s\S]*?<\/row>/g, (row) => {
    const cells = row.match(/<c [\s\S]*?(?:\/>|<\/c>)/g) ?? []
    const skuCell = cells.find((c) => /r="A\d+"/.test(c))
    if (!skuCell) return row
    const sku = inlineText(skuCell)
    const qty = quantitiesBySku[sku]
    if (qty === undefined) return row

    const rowNum = row.match(/<row r="(\d+)"/)?.[1]
    const value = String(qty)
    filled++
    // переписываем только ячейку G этой строки
    return row.replace(
      new RegExp(`<c r="G${rowNum}"[\\s\\S]*?(?:/>|</c>)`),
      `<c r="G${rowNum}" t="inlineStr"><is><t xml:space="preserve">${value}</t></is></c>`,
    )
  })

  const expected = Object.keys(quantitiesBySku).length
  if (filled !== expected) {
    throw new Error(`заполнено ${filled} строк из ${expected} — артикулы не найдены в шаблоне`)
  }

  files[SHEET] = strToU8(xml)
  await writeFile(outPath, zipSync(files, { level: 6 }))
  return { filled }
}
