// Built-in starter templates (templates/*.yaml), embedded as text so the bundled CLI carries them.
import base from '../../templates/base.yaml' with { type: 'text' }
import fork from '../../templates/fork.yaml' with { type: 'text' }
import house from '../../templates/house.yaml' with { type: 'text' }
import oss from '../../templates/oss.yaml' with { type: 'text' }
import protectDev from '../../templates/protect-dev.yaml' with { type: 'text' }
import protectMain from '../../templates/protect-main.yaml' with { type: 'text' }
import security from '../../templates/security.yaml' with { type: 'text' }
import { memoryLibrary, type Library } from './library'
import { parseYaml, type Document } from './schema'

/** Source text of every built-in document, in display order. */
export const BUILTIN_YAML: Readonly<Record<string, string>> = {
  base: base as string,
  security: security as string,
  'protect-main': protectMain as string,
  'protect-dev': protectDev as string,
  oss: oss as string,
  fork: fork as string,
  house: house as string,
}

let docs: Document[] | undefined
let library: Library | undefined

/** The built-in Templates and Sets, parsed and validated once. */
export function builtinDocs(): Document[] {
  docs ??= Object.values(BUILTIN_YAML).flatMap((text) => parseYaml(text))
  return docs.map((d) => structuredClone(d))
}

/** Read-only library over the built-in documents. */
export function builtinLibrary(): Library {
  library ??= memoryLibrary(builtinDocs())
  return library
}

/** True when `name` is a built-in Template or Set name. */
export function isBuiltin(name: string, kind?: 'Template' | 'Set'): boolean {
  return builtinDocs().some((d) => d.kind !== 'Manifest' && d.metadata.name === name && (!kind || d.kind === kind))
}

/** Looks a name up in each library in turn; the first hit wins (server: DB → built-in; CLI: files → built-in). */
export function layeredLibrary(...libs: Library[]): Library {
  return {
    async getTemplate(name) {
      for (const lib of libs) {
        const t = await lib.getTemplate(name)
        if (t) return t
      }
      return undefined
    },
    async getSet(name) {
      for (const lib of libs) {
        const s = await lib.getSet(name)
        if (s) return s
      }
      return undefined
    },
  }
}
