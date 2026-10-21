import { z } from 'zod'
import { saveTemplate } from '../../services'
import type { TemplateDoc } from '../../templates/schema'
import { defineTool } from './define'
import { oneDocument } from './shared'

export const upsertTemplate = defineTool({
  name: 'upsert_template',
  description:
    'Create or replace a template by metadata.name. Give doc ({apiVersion: "octowarden/v1", kind: "Template", metadata: {name, description?}, ' +
    'spec: {sections: {<section>: config}, requires?: {visibility}}}) or the same as yaml. Section configs are validated (see list_sections); ' +
    '${{ values.<key> }} placeholders are filled at plan time. Built-in names are read-only. Changes nothing on GitHub.',
  inputSchema: { doc: z.record(z.string(), z.unknown()).optional(), yaml: z.string().max(5_000_000).optional() },
  destructive: false,
  readOnly: false,
  handler: async (args, ctx) => saveTemplate(oneDocument(args, 'Template') as TemplateDoc, ctx),
})
