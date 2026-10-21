import type { z } from 'zod'
import type { Ctx } from '../../services'

/** Raw zod shape: the MCP SDK turns it into the tool's JSON Schema. */
export type ToolShape = Record<string, z.ZodType>

export type ToolDefinition<Shape extends ToolShape = ToolShape> = {
  name: string
  /** Carries the semantics for the model: what it does, what it returns, whether it needs confirm. */
  description: string
  inputSchema: Shape
  /** Changes or deletes state on GitHub or here; surfaced as `destructiveHint`. */
  destructive: boolean
  /** Reads only; surfaced as `readOnlyHint`. */
  readOnly: boolean
  handler: (args: z.infer<z.ZodObject<Shape>>, ctx: Ctx) => Promise<unknown>
}

/** Keeps the handler's argument type inferred from the schema. */
export const defineTool = <Shape extends ToolShape>(tool: ToolDefinition<Shape>): ToolDefinition<Shape> => tool
