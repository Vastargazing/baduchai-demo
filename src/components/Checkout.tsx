import { useState } from 'react'
import type { CartTotals } from '../lib/totals'
import { formatMoney, formatWeight } from '../lib/totals'
import { Modal } from './Bits'

interface Form {
  email: string
  recipient: string
  address: string
  comment: string
}

const EMPTY: Form = { email: '', recipient: '', address: '', comment: '' }

/** Данные только для показа сценария — никуда не отправляются и не сохраняются. */
const SAMPLE: Form = {
  email: 'demo@example.com',
  recipient: 'Иванов Иван Иванович',
  address: '190000, Санкт-Петербург, ул. Чайная, д. 7, кв. 12',
  comment: 'Демонстрационный заказ, отправлять не нужно',
}

function validate(form: Form): Partial<Record<keyof Form, string>> {
  const errors: Partial<Record<keyof Form, string>> = {}
  if (!form.email.trim()) errors.email = 'Укажите почту'
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) errors.email = 'Похоже, в адресе опечатка'
  if (!form.recipient.trim()) errors.recipient = 'Укажите получателя'
  else if (form.recipient.trim().length < 3) errors.recipient = 'Слишком коротко'
  if (!form.address.trim()) errors.address = 'Укажите адрес доставки'
  else if (form.address.trim().length < 10) errors.address = 'Адрес выглядит неполным'
  return errors
}

export function Checkout({
  totals,
  onClose,
  onFinish,
}: {
  totals: CartTotals
  onClose: () => void
  onFinish: () => void
}) {
  const [form, setForm] = useState<Form>(EMPTY)
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({})
  const [done, setDone] = useState(false)

  const set = (key: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((prev) => ({ ...prev, [key]: e.target.value }))
    setErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  const submit = () => {
    const found = validate(form)
    setErrors(found)
    if (Object.keys(found).length) return
    // Ничего не отправляем и не сохраняем: демонстрация завершается на этом экране.
    setDone(true)
  }

  if (done) {
    return (
      <Modal
        title="Демонстрация завершена"
        onClose={onClose}
        footer={
          <>
            <button className="btn" onClick={onClose}>Вернуться к каталогу</button>
            <button
              className="btn btn-primary"
              onClick={() => {
                setForm(EMPTY)
                setDone(false)
                onFinish()
              }}
            >
              Очистить корзину и начать заново
            </button>
          </>
        }
      >
        <div className="success" data-testid="checkout-success">
          <div className="success-mark">✓</div>
          <h3 style={{ fontSize: 22, marginBottom: 8 }}>Сценарий пройден полностью</h3>
          <p style={{ color: 'var(--ink-soft)', maxWidth: 460, margin: '0 auto 16px' }}>
            Так выглядит завершение заказа в новом интерфейсе: {totals.positions} поз.,{' '}
            {totals.packages} упак., {formatMoney(totals.amountMinor, totals.currencySymbol)}.
          </p>
          <div className="note note-warn" style={{ textAlign: 'left', maxWidth: 520, margin: '0 auto' }}>
            <strong>Настоящий заказ не создан.</strong> Это демонстрационный прототип без связи с
            магазином baduchai.ru: заказ не попал в WooCommerce, оплата не запрашивалась, введённые
            данные никуда не отправлены и нигде не сохранены — они исчезли вместе с этой формой.
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      title="Оформление (демонстрация)"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Отмена</button>
          <button className="btn btn-primary" onClick={submit} data-testid="checkout-submit">
            Завершить демонстрацию
          </button>
        </>
      }
    >
      <div className="note note-warn" style={{ marginBottom: 16 }}>
        <strong>Это демонстрация.</strong> Настоящий заказ не отправляется. Введённые данные
        остаются только в этой вкладке: они не уходят на сервер, не попадают в аналитику, логи или
        localStorage. Можно заполнить форму тестовыми данными.
      </div>

      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn btn-sm" onClick={() => setForm(SAMPLE)} data-testid="fill-sample">
          Подставить тестовые данные
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => setForm(EMPTY)}>Очистить форму</button>
      </div>

      <div className="form-grid two" style={{ marginBottom: 14 }}>
        <div>
          <label className="label" htmlFor="co-email">Почта <span style={{ color: 'var(--danger)' }}>*</span></label>
          <input
            id="co-email"
            className={`field${errors.email ? ' invalid' : ''}`}
            type="email"
            autoComplete="off"
            value={form.email}
            onChange={set('email')}
            placeholder="demo@example.com"
          />
          {errors.email && <div className="error-text">{errors.email}</div>}
        </div>
        <div>
          <label className="label" htmlFor="co-recipient">Получатель <span style={{ color: 'var(--danger)' }}>*</span></label>
          <input
            id="co-recipient"
            className={`field${errors.recipient ? ' invalid' : ''}`}
            autoComplete="off"
            value={form.recipient}
            onChange={set('recipient')}
            placeholder="Фамилия Имя Отчество"
          />
          {errors.recipient && <div className="error-text">{errors.recipient}</div>}
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label className="label" htmlFor="co-address">Адрес доставки <span style={{ color: 'var(--danger)' }}>*</span></label>
        <input
          id="co-address"
          className={`field${errors.address ? ' invalid' : ''}`}
          autoComplete="off"
          value={form.address}
          onChange={set('address')}
          placeholder="Индекс, город, улица, дом, квартира"
        />
        {errors.address && <div className="error-text">{errors.address}</div>}
      </div>

      <div style={{ marginBottom: 20 }}>
        <label className="label" htmlFor="co-comment">Комментарий</label>
        <input id="co-comment" className="field" autoComplete="off" value={form.comment} onChange={set('comment')} />
        <div className="hint">Необязательно.</div>
      </div>

      <h3 style={{ fontSize: 17, marginBottom: 8 }}>Сводка заказа</h3>
      <table className="summary-table">
        <thead>
          <tr>
            <th>Товар</th>
            <th className="num">Кол-во</th>
            <th className="num">Сумма</th>
          </tr>
        </thead>
        <tbody>
          {totals.items.map((item) => (
            <tr key={item.product.source_id}>
              <td>
                {item.product.name_short}
                <div style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>
                  {item.product.sku} ·{' '}
                  {item.product.weight_g === null ? 'вес не указан' : `${item.product.unit} ${item.product.weight_g} г`}
                </div>
              </td>
              <td className="num">{item.qty}</td>
              <td className="num">{formatMoney(item.lineTotalMinor, totals.currencySymbol)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th>
              Итого: {totals.positions} поз., {totals.packages} упак.
              <div style={{ fontSize: 11.5, fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--ink-faint)' }}>
                {totals.weightComplete
                  ? `вес ${formatWeight(totals.knownWeightG)}`
                  : `вес от ${formatWeight(totals.knownWeightG)} — у ${totals.unknownWeightItems} поз. фасовка не опубликована`}
              </div>
            </th>
            <th className="num" />
            <th className="num" style={{ fontSize: 16 }}>
              {formatMoney(totals.amountMinor, totals.currencySymbol)}
            </th>
          </tr>
        </tfoot>
      </table>
      <div className="hint" style={{ marginTop: 8 }}>
        Доставка и возможные скидки не включены: их условия магазин согласует отдельно.
      </div>
    </Modal>
  )
}
