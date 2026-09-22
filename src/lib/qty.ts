/**
 * Разбор и проверка количества.
 *
 * Все товары каталога продаются штучными упаковками (блин, кирпич, мешочек,
 * пакет), поэтому дробное количество отклоняется, а не округляется.
 */
export const MAX_QTY = 999

export type QtyResult = { ok: true; value: number } | { ok: false; error: string }

// \w не покрывает кириллицу, поэтому окончания задаём явным классом
const UNIT_PATTERN = 'шт|штук[а-яё]*|уп|упак[а-яё]*|пачк[а-яё]*|блин[а-яё]*|кирпич[а-яё]*|мешоч[а-яё]*|pcs?|pc|ea'
const UNIT_WORDS = new RegExp(`^(?:${UNIT_PATTERN})\\.?$`, 'iu')

/** Отбрасывает хвостовое слово единицы: «2 шт.», «3 упаковки». */
export function stripUnitWord(text: string): string {
  return text
    .trim()
    .replace(new RegExp(`\\s*(?:${UNIT_PATTERN})\\.?\\s*$`, 'iu'), '')
    .trim()
}

export function parseQuantity(raw: string): QtyResult {
  const text = stripUnitWord(String(raw ?? '').trim())
  if (!text) return { ok: false, error: 'количество не указано' }

  const normalized = text.replace(',', '.').replace(/\s/g, '')
  if (!/^[+-]?\d+(\.\d+)?$/.test(normalized)) {
    return { ok: false, error: `не число: «${raw}»` }
  }

  const value = Number(normalized)
  if (!Number.isFinite(value)) return { ok: false, error: `не число: «${raw}»` }
  if (!Number.isInteger(value)) {
    return { ok: false, error: `дробное количество (${normalized}) — товар продаётся упаковками` }
  }
  if (value === 0) return { ok: false, error: 'количество 0' }
  if (value < 0) return { ok: false, error: `отрицательное количество (${value})` }
  if (value > MAX_QTY) return { ok: false, error: `слишком большое количество (${value}), максимум ${MAX_QTY}` }
  return { ok: true, value }
}

export function isUnitWord(token: string): boolean {
  return UNIT_WORDS.test(token.trim())
}

/** Ограничение для полей ввода в каталоге и корзине. */
export function clampQty(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(MAX_QTY, Math.trunc(value)))
}
