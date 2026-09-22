/**
 * Нормализация строк для поиска и разбора списков.
 *
 * В исходном каталоге артикулы записаны непоследовательно: часть с латинской «O»,
 * часть с кириллической «О» (см. meta.sku_collisions). Поэтому артикул
 * приводится к одному алфавиту — но совпадение по нему может дать несколько
 * товаров, и такой случай мы показываем как неоднозначный, а не выбираем молча.
 */

/** Кириллические буквы, визуально неотличимые от латинских. */
const HOMOGLYPHS: Record<string, string> = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O',
  Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X',
}

const CJK = /[㐀-鿿豈-﫿　-〿]/gu

/** Ключ для сравнения артикулов: один алфавит, без разделителей и регистра. */
export function normSku(input: string): string {
  return input
    .toUpperCase()
    .replace(/[А-ЯЁ]/gu, (ch) => HOMOGLYPHS[ch] ?? ch)
    .replace(/[^A-Z0-9А-ЯЁ]/gu, '')
}

/** Похожа ли строка на артикул: латиница/цифры с дефисом, без пробелов внутри слова. */
export function looksLikeSku(input: string): boolean {
  const t = input.trim()
  if (!t || /\s/.test(t)) return false
  return /^[A-Za-zА-Яа-яЁё]{1,6}[-–—_ ]?\d{1,4}$/u.test(t)
}

/** Ключ для сравнения названий: нижний регистр, ё→е, без пунктуации и иероглифов. */
export function normName(input: string): string {
  return input
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(CJK, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/** Иероглифическая часть названия — отдельный ключ, normName её отбрасывает. */
export function normCjk(input: string): string {
  return (input.match(CJK) || []).join('')
}

/** Расстояние Левенштейна с ранним выходом — для подсказок при опечатках. */
export function levenshtein(a: string, b: string, max = 4): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
      if (cur[j] < rowMin) rowMin = cur[j]
    }
    if (rowMin > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

/** Порог опечаток зависит от длины: для коротких названий почти нулевой. */
export function fuzzyThreshold(len: number): number {
  if (len <= 4) return 0
  if (len <= 8) return 1
  if (len <= 14) return 2
  return 3
}
