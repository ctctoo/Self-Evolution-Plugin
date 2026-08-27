/**
 * DEVELOPMENT-TIME type contract for `@deepseek-ai/dsh-tools`.
 *
 * Transcribed from `docs/subsystems/tools.zh.md` and
 * `docs/cookbook/adding-a-tool.zh.md`. At runtime the real package from the
 * DSH workspace provides the implementation.
 */

export type { JsonSchemaScalar, JsonSchemaType, JsonSchemaNode, ObjectJsonSchema } from './dsh-schema'

/** Lossless JSON value. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** Author-facing value schema DSL (tools.zh.md § unified JSON value schema DSL). */
export type ValueSchemaSpec =
  | { type: 'string'; description?: string; enum?: string[] }
  | { type: 'number'; description?: string }
  | { type: 'integer'; description?: string }
  | { type: 'boolean'; description?: string }
  | { type: 'null'; description?: string }
  | { type: 'array'; items?: ValueSchemaSpec; description?: string }
  | { type: 'object'; properties?: Record<string, ValueSchemaSpec>; required?: string[]; additionalProperties?: boolean; description?: string }
  | { type: 'json'; description?: string }
  | { oneOf: ValueSchemaSpec[]; description?: string }

/** One implicit parameter-root property, optionally required. */
export type ParameterPropertySpec = ValueSchemaSpec & { required?: true }

/** Tool parameter schema: an implicit open object root. */
export type ParameterSchemaSpec = {
  [key: string]: ParameterPropertySpec
}

/** Inference of the TS value accepted by an author-facing schema (bounded). */
export type InferValue<S> = S extends { type: 'string' } ? string
  : S extends { type: 'number' | 'integer' } ? number
  : S extends { type: 'boolean' } ? boolean
  : S extends { type: 'null' } ? null
  : S extends { type: 'json' } ? JsonValue
  : S extends { type: 'array'; items: infer I } ? InferValue<I>[]
  : S extends { type: 'object'; properties: infer P }
    ? { [K in keyof P as P[K] extends { required: true } ? K : never]: InferValue<P[K]> } & {
        [K in keyof P as P[K] extends { required: true } ? never : K]?: InferValue<P[K]>
      }
  : S extends { oneOf: infer B extends readonly ValueSchemaSpec[] } ? InferValue<B[number]>
  : unknown

/** Inference of the TS argument object for an implicit parameter schema. */
export type InferArgs<S extends ParameterSchemaSpec> = {
  [K in keyof S as S[K] extends { required: true } ? K : never]: InferValue<S[K]>
} & {
  [K in keyof S as S[K] extends { required: true } ? never : K]?: InferValue<S[K]>
}

/** Model-facing content block (simplified union used by tools). */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: JsonValue }
  | { type: 'tool_result'; toolUseId: string; content: string | ContentBlock[]; isError?: boolean }

/** Canonical failure detail. */
export interface ToolFailure {
  message: string
  info?: unknown
}

/** Successful canonical tool execution. */
export interface ToolExecutionSuccess {
  readonly isError: false
  readonly value: JsonValue
  readonly content: ContentBlock[]
  readonly error?: never
  readonly meta?: JsonValue
  readonly additionalContexts?: readonly UserMessageLike[]
  readonly concludesTurn?: true
}

/** Failed canonical tool execution. */
export interface ToolExecutionFailure {
  readonly isError: true
  readonly error: ToolFailure
  readonly value?: never
  readonly content: ContentBlock[]
  readonly meta?: JsonValue
  readonly additionalContexts?: readonly UserMessageLike[]
  readonly concludesTurn?: never
}

export type ToolExecutionResult = ToolExecutionSuccess | ToolExecutionFailure

/** Minimal UserMessage-like shape accepted by `deferContext`. */
export interface UserMessageLike {
  content: ContentBlock[]
  source?: { kind: string; plugin?: string }
}

/** Opaque call identity. */
export type ToolExecutionToken = symbol & { readonly [toolExecutionTokenBrand]: true }
declare const toolExecutionTokenBrand: unique symbol

/** Caller-supplied description of one tool call. */
export interface ToolExecutionInput {
  readonly callId: string
  readonly rootCallId?: string
  readonly name: string
  readonly arguments: unknown
  readonly agent?: unknown
  readonly parent?: ToolExecutionToken
  readonly signal: AbortSignal
}

/** Identity-protected execution inside the pipeline. */
export interface ToolExecution extends ToolExecutionInput {
  readonly rootCallId: string
  readonly token: ToolExecutionToken
}

/** Runtime context handed to a tool body. */
export interface ToolRunContext extends ToolExecution {
  deferContext(context: UserMessageLike): void
  concludeTurn(): void
}

/** Canonical output declaration owned by a tool. */
export interface ToolOutputDefinition {
  readonly schema: ValueSchemaSpec
  render(args: unknown, value: JsonValue): ContentBlock[]
  presentationMeta?(args: unknown, value: JsonValue): JsonValue
}

/** A registered tool definition. */
export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters?: ParameterSchemaSpec
  readonly output: ToolOutputDefinition
  execute(args: any, exec: ToolRunContext): Promise<unknown>
  finalizeContent?(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): ContentBlock[] | undefined
  timeoutMs?: number
  isConcurrencySafe?(args: unknown): boolean
}

/** Typed tool-builder helper. */
export function defineTool<T extends ParameterSchemaSpec>(def: {
  name: string
  description: string
  parameters: T
  output: { schema: ValueSchemaSpec; render: (args: InferArgs<T>, value: any) => ContentBlock[] }
  execute: (args: InferArgs<T>, exec: ToolRunContext) => Promise<unknown>
  timeoutMs?: number
  isConcurrencySafe?(args: InferArgs<T>): boolean
}): ToolDefinition
export function defineTool(def: ToolDefinition): ToolDefinition

/** Tool registry and execution pipeline (`ctx.tools`). */
export interface ToolRuntime {
  register(definition: ToolDefinition): () => void
  guard(guard: (execution: Readonly<ToolExecution>) => string | undefined): () => void
  restrict(filter: { allow?: readonly string[]; deny?: readonly string[] }): () => void
  get(name: string, scope?: string): ToolDefinition | undefined
  schemas(scope?: string): ToolDefinition[]
  execute(exec: ToolExecutionInput): Promise<ToolExecutionResult>
}
