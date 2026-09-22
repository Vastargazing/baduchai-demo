import { useEffect, type ReactNode } from 'react'
import { MAX_QTY } from '../lib/qty'

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { maxWidth: 980 } : undefined}>
        <div className="modal-head">
          <h2 className="modal-title">{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function QtyStepper({
  value,
  onChange,
  disabled,
  label,
}: {
  value: number
  onChange: (next: number) => void
  disabled?: boolean
  label: string
}) {
  return (
    <div className={`stepper${value > 0 ? ' filled' : ''}`}>
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={disabled || value <= 0}
        aria-label={`Убрать одну упаковку: ${label}`}
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={MAX_QTY}
        value={value === 0 ? '' : value}
        placeholder="0"
        disabled={disabled}
        aria-label={`Количество: ${label}`}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={disabled || value >= MAX_QTY}
        aria-label={`Добавить одну упаковку: ${label}`}
      >
        +
      </button>
    </div>
  )
}
