import { useState } from 'react'
import { api, errorMessage } from '../api'

const MIN = 12

/** Sets up an encrypted notes folder, then shows the recovery key exactly once. */
export function EncryptDialog(props: { copyCurrent: boolean; currentPath: string | null; onClose: () => void; onDone: () => void }): JSX.Element {
  const [passcode, setPasscode] = useState('')
  const [confirm, setConfirm] = useState('')
  const [understood, setUnderstood] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const problem =
    [...passcode].length < MIN ? `Use at least ${MIN} characters. A sentence you'll remember works well.` : passcode !== confirm ? 'The two passcodes do not match.' : ''

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (busy || problem || !understood) return
    setBusy(true)
    setError('')
    try {
      const key = await api.app.createEncrypted(passcode, props.copyCurrent)
      if (key) {
        setRecoveryKey(key)
        props.onDone()
      }
    } catch (err) {
      setError(errorMessage(err))
    }
    setBusy(false)
  }

  if (recoveryKey) {
    return (
      <div className="overlay">
        <div className="dialog encrypt-dialog" data-testid="recovery-dialog">
          <h3>Your recovery key</h3>
          <p>
            This is shown once and stored nowhere. If you forget your passcode, this key is the only other way to open your notes. Write it
            down or put it in a password manager, somewhere other than this notes folder.
          </p>
          <div className="recovery-key" data-testid="recovery-key">
            {recoveryKey}
          </div>
          <div className="dialog-actions" style={{ justifyContent: 'flex-start' }}>
            <button type="button" onClick={() => void navigator.clipboard.writeText(recoveryKey)}>
              Copy
            </button>
          </div>
          {props.copyCurrent && (
            <p className="hint-block">
              Your notes were copied into the new encrypted folder and checked. The original folder
              {props.currentPath ? ` (${props.currentPath})` : ''} is untouched and still readable. Once you're happy with the encrypted copy,
              delete the original yourself and empty Google Drive's trash, or the readable version stays in the cloud.
            </p>
          )}
          <label className="check">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} data-testid="recovery-saved" />
            I have saved my recovery key
          </label>
          <div className="dialog-actions">
            <button className="primary" disabled={!saved} onClick={props.onClose} data-testid="recovery-done">
              Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="overlay" onMouseDown={busy ? undefined : props.onClose}>
      <form className="dialog encrypt-dialog" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit} data-testid="encrypt-dialog">
        <h3>{props.copyCurrent ? 'Encrypt my notes' : 'Create an encrypted notes folder'}</h3>
        <p>
          Everything is encrypted before it reaches the folder: the text, attachments, and file and folder names. Google Drive and other
          apps will only see scrambled files. Cockpit asks for your passcode every time it opens.
        </p>
        <input type="password" autoFocus value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder="Passcode" data-testid="encrypt-passcode" autoComplete="off" />
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Passcode again" data-testid="encrypt-confirm" autoComplete="off" />
        {passcode && problem && <p className="error">{problem}</p>}
        <label className="check">
          <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} data-testid="encrypt-understood" />
          I understand that if I lose both my passcode and my recovery key, my notes cannot be recovered by anyone.
        </label>
        <p className="hint-block">
          Next you'll choose an <b>empty folder</b> for the encrypted notes.
          {props.copyCurrent ? ' Your current notes are copied into it; the originals are not changed or deleted.' : ''}
        </p>
        {error && <p className="error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={props.onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || !!problem || !understood} data-testid="encrypt-submit">
            {busy ? 'Encrypting…' : 'Choose folder and encrypt'}
          </button>
        </div>
      </form>
    </div>
  )
}

export function ChangePasscodeDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const problem = [...next].length < MIN ? `Use at least ${MIN} characters.` : next !== confirm ? 'The two new passcodes do not match.' : ''

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (busy || problem || !current) return
    setBusy(true)
    setError('')
    try {
      await api.app.changePasscode(current, next)
      onClose()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onMouseDown={busy ? undefined : onClose}>
      <form className="dialog encrypt-dialog" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit} data-testid="change-passcode-dialog">
        <h3>Change passcode</h3>
        <p>
          Your notes are not re-encrypted; only the lock on the key changes, and your recovery key stays the same. This protects you if you
          simply want a new passcode. It does not shut out someone who already knew the old one and has an older copy of your folder.
        </p>
        <input type="password" autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current passcode, or recovery key" autoComplete="off" />
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New passcode" autoComplete="off" />
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="New passcode again" autoComplete="off" />
        {next && problem && <p className="error">{problem}</p>}
        {error && <p className="error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || !!problem || !current}>
            {busy ? 'Changing…' : 'Change passcode'}
          </button>
        </div>
      </form>
    </div>
  )
}
