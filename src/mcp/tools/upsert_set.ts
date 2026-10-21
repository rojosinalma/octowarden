import { z } from 'zod'
import { saveSet } from '../../services'
import type { SetDoc } from '../../templates/schema'
import { defineTool } from './define'
import { oneDocument } from './shared'

export const upsertSet = defineTool({
  name: 'upsert_set',
  description:
    'Create or replace a set by metadata.name. Give doc ({apiVersion: "octowarden/v1", kind: "Set", metadata: {name}, spec: {templates: [names in apply order], ' +
    'values?: {key: value}}}) or the same as yaml. Every template must exist. Changes nothing on GitHub.',
  inputSchema: { doc: z.record(z.string(), z.unknown()).optional(), yaml: z.string().max(5_000_000).optional() },
  destructive: false,
  readOnly: false,
  handler: async (args, ctx) => saveSet(oneDocument(args, 'Set') as SetDoc, ctx),
})
