/**
 * Wraps the named methods ("notes.rename") so that open notes are saved before they run. Moving,
 * renaming, or rewriting a file while the editor still holds unsaved text for it would otherwise
 * leave two writers on one file.
 */
export function withFlush<T extends Record<string, any>>(api: T, flush: () => Promise<void>, methods: string[]): T {
  const out: Record<string, any> = { ...api }
  for (const name of methods) {
    const [ns, method] = name.split('.')
    const original = api[ns][method]
    out[ns] = { ...out[ns] }
    out[ns][method] = async (...args: unknown[]) => {
      await flush()
      return original(...args)
    }
  }
  return out as T
}
