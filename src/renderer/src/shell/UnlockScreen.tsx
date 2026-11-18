import { useState } from 'react'
import { api, errorMessage } from '../api'

/** Shown at every launch of an encrypted notes folder. The passcode is the key; nothing is stored. */
export function UnlockScreen({ path, onUnlocked }: { path: string | null; onUnlocked(): void }): JSX.Element {
  const [secret, setSecret] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (busy || !secret) return
    setBusy(true)
    setError('')
    try {
      await api.app.unlock(secret)
      onUnlocked()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <div className="picker" data-testid="unlock-screen">
      <form className="picker-card lock-card" onSubmit={submit}>
        <div className="lock-lamp" />
        <h1>Cockpit</h1>
        <p>Your notes are encrypted. Enter your passcode to open them.</p>
        <input
          type="password"
          autoFocus
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="Passcode"
          data-testid="unlock-input"
          autoComplete="off"
        />
        <button className="primary" type="submit" disabled={busy || !secret}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
        {error && (
          <p className="error" data-testid="unlock-error">
            {error}
          </p>
        )}
        <p className="hint">Forgot it? Your recovery key works here too.</p>
        <p className="hint lock-path" title={path ?? ''}>
          {path}
        </p>
        <button type="button" className="link" onClick={() => void api.app.chooseVault().then(onUnlocked)}>
          Open a different folder
        </button>
      </form>
    </div>
  )
}
