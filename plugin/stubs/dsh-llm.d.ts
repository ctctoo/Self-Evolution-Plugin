/**
 * DEVELOPMENT-TIME type contract for `@deepseek-ai/dsh-llm` and the
 * `ctx.llm` service.
 *
 * Transcribed from `docs/subsystems/llm-streaming.zh.md`.
 */

/** Branded call id. */
export type CallId = string & { readonly [brand]: unique symbol }
declare const brand: unique symbol

/** Message sources (Map → derived union). */
export interface MessageSourceMap {
  'user': { kind: 'user' }
  'assistant': { kind: 'assistant' }
  'plugin': { kind: 'plugin'; plugin: string }
  'tool': { kind: 'tool'; callId: CallId }
}
export type MessageSource = MessageSourceMap[keyof MessageSourceMap]

/** Content blocks (Map → derived union). */
export interface ContentBlockMap {
  'text': { type: 'text'; text: string }
  'reasoning': { type: 'reasoning'; text: string }
  'tool_use': { type: 'tool_use'; id: string; name: string; input: unknown }
  'tool_result': { type: 'tool_result'; toolUseId: string; content: string | ContentBlock[]; isError?: boolean }
  'image': { type: 'image'; source: unknown }
}
export type ContentBlock = ContentBlockMap[keyof ContentBlockMap]

/** A message in the conversation vocabulary. */
export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: ContentBlock[]
  source?: MessageSource
}

/** Helper to construct a user-role message. */
export function createUserMessage(input: { content: ContentBlock[]; source?: MessageSource }): Message

/** Model-facing request configuration. */
export interface LlmCallConfig {
  provider?: string
  model?: string
  maxTokens?: number
}

/** The LLM seam service. */
export interface LlmService {
  /** Stream a model request. Returns an async iterator of stream chunks. */
  stream(request: unknown): AsyncIterable<unknown>
}
