import { mkdirSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Vault } from '../../src/main/vault'
import { VaultIndex } from '../../src/main/vault-index'

export async function tempVault(files: Record<string, string> = {}): Promise<{ v: Vault; ix: VaultIndex; trashed: string[] }> {
  const trashed: string[] = []
  const root = join(mkdtempSync(join(tmpdir(), 'cockpit-')), 'vault')
  mkdirSync(root) // the app never creates the notes folder itself; the owner picks an existing one
  const v = new Vault(root, async (p) => void trashed.push(p))
  await v.ensureSkeleton()
  for (const [rel, text] of Object.entries(files)) await v.write(rel, text)
  return { v, ix: await VaultIndex.build(v), trashed }
}
