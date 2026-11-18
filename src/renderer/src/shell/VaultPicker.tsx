import { useState } from 'react'
import { api, errorMessage } from '../api'

export function VaultPicker({
  missingPath,
  onChosen,
  onEncrypt
}: {
  missingPath: string | null
  onChosen(): void
  onEncrypt(): void
}): JSX.Element {
  const [error, setError] = useState('')
  const choose = async (): Promise<void> => {
    setError('')
    try {
      if (await api.app.chooseVault()) onChosen()
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  return (
    <div className="picker" data-testid="vault-picker">
      <div className="picker-card">
        <h1>Cockpit</h1>
        {missingPath ? (
          <p className="picker-warning">
            Cockpit can't find your notes folder at <code>{missingPath}</code>. Google Drive may not be running, or the
            folder was moved.
          </p>
        ) : (
          <p>Choose the folder where your notes will live. Everything is saved there as plain markdown files.</p>
        )}
        <button className="primary" onClick={choose}>
          Choose folder
        </button>
        <p className="hint">In Google Drive, set this folder to Available offline.</p>
        <button className="link" onClick={onEncrypt} data-testid="picker-encrypted">
          Or create an encrypted notes folder
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  )
}
