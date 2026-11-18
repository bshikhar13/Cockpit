import { useEffect, useRef, useState } from 'react'
import { errorMessage } from '../api'

export function NameDialog(props: {
  title: string
  initial?: string
  submitLabel?: string
  onSubmit: (name: string) => Promise<void>
  onClose: () => void
}): JSX.Element {
  const [name, setName] = useState(props.initial ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.select(), [])

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await props.onSubmit(name)
      props.onClose()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onMouseDown={props.onClose}>
      <form className="dialog" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit} data-testid="name-dialog">
        <h3>{props.title}</h3>
        <input
          ref={input}
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && props.onClose()}
          placeholder="Name"
        />
        {error && <p className="error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {props.submitLabel ?? 'Create'}
          </button>
        </div>
      </form>
    </div>
  )
}
