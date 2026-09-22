import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CartLine, Product } from '../lib/types'
import { loadCart, saveCart, loadSets, saveSets, newSetId, type SavedSet } from '../lib/storage'
import { buildCart, computeTotals } from '../lib/totals'
import { clampQty } from '../lib/qty'

/**
 * Меняет количество, СОХРАНЯЯ позицию строки в корзине.
 *
 * Раньше строка удалялась и дописывалась в конец: из-за этого при нажатии «+»
 * товар уезжал вниз, а на его месте оказывался соседний — со стороны выглядело
 * так, будто чай подменился на другой.
 */
export function withQty(prev: CartLine[], source_id: number, next: number): CartLine[] {
  if (next <= 0) return prev.filter((l) => l.source_id !== source_id)
  if (prev.some((l) => l.source_id === source_id)) {
    return prev.map((l) => (l.source_id === source_id ? { source_id, qty: next } : l))
  }
  return [...prev, { source_id, qty: next }]
}

export function useCart(byId: Map<number, Product>) {
  const [lines, setLines] = useState<CartLine[]>(() => loadCart())
  const [sets, setSets] = useState<SavedSet[]>(() => loadSets())

  // корзина переживает перезагрузку; персональные данные сюда не попадают
  useEffect(() => saveCart(lines), [lines])
  useEffect(() => saveSets(sets), [sets])

  const setQty = useCallback((source_id: number, qty: number) => {
    setLines((prev) => withQty(prev, source_id, clampQty(qty)))
  }, [])

  const addQty = useCallback((source_id: number, delta: number) => {
    setLines((prev) => {
      const cur = prev.find((l) => l.source_id === source_id)?.qty ?? 0
      return withQty(prev, source_id, clampQty(cur + delta))
    })
  }, [])

  const remove = useCallback((source_id: number) => {
    setLines((prev) => prev.filter((l) => l.source_id !== source_id))
  }, [])

  const clear = useCallback(() => setLines([]), [])

  /** Замена или добавление — решение принимает покупатель, молча ничего не удваивается. */
  const applyLines = useCallback((incoming: CartLine[], mode: 'replace' | 'add') => {
    setLines((prev) => {
      if (mode === 'replace') return incoming.map((l) => ({ ...l, qty: clampQty(l.qty) }))
      const map = new Map(prev.map((l) => [l.source_id, l.qty]))
      for (const l of incoming) {
        map.set(l.source_id, clampQty((map.get(l.source_id) ?? 0) + l.qty))
      }
      return [...map].filter(([, q]) => q > 0).map(([source_id, qty]) => ({ source_id, qty }))
    })
  }, [])

  const saveCurrentSet = useCallback(
    (comment: string) => {
      const set: SavedSet = {
        id: newSetId(),
        createdAt: new Date().toISOString(),
        comment: comment.trim(),
        lines,
      }
      setSets((prev) => [set, ...prev])
      return set
    },
    [lines],
  )

  const deleteSet = useCallback((id: string) => {
    setSets((prev) => prev.filter((s) => s.id !== id))
  }, [])

  const items = useMemo(() => buildCart(lines, byId), [lines, byId])
  const totals = useMemo(() => computeTotals(items), [items])
  const qtyOf = useCallback(
    (source_id: number) => lines.find((l) => l.source_id === source_id)?.qty ?? 0,
    [lines],
  )

  return {
    lines, totals, qtyOf,
    setQty, addQty, remove, clear, applyLines,
    sets, saveCurrentSet, deleteSet,
  }
}
