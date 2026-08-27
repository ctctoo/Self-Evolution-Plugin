/**
 * DEVELOPMENT-TIME type contract for `@deepseek-ai/dsh-session` and the
 * `ctx.sessions` / `ctx.agents` services.
 *
 * Transcribed from `docs/subsystems/session.zh.md`, `docs/subsystems/core.zh.md`
 * and `docs/subsystems/persistence.zh.md`.
 */

/** Branded string helper (docs/subsystems/core.zh.md § branded IDs). */
export type Branded<B extends string> = string & { readonly [BRAND]: B }
declare const BRAND: unique symbol

export type SessionId = Branded<'SessionId'>
export type MessageId = Branded<'MessageId'>
export type CallId = Branded<'CallId'>

/** Map → derived-union pattern for session events. */
export interface SessionEventMap {
  'turn/start': { type: 'turn/start'; seq: number; time: number; data: { turn: number; trigger: unknown } }
  'turn/end': { type: 'turn/end'; seq: number; time: number; data: { turn: number; reason: unknown } }
  'step/start': { type: 'step/start'; seq: number; time: number; data: { turn: number; step: number } }
  'step/end': { type: 'step/end'; seq: number; time: number; data: { turn: number; step: number; durationMs?: number } }
  'user/message': { type: 'user/message'; seq: number; time: number; data: { turn: number; step: number; message: unknown } }
  'assistant/message': { type: 'assistant/message'; seq: number; time: number; data: { turn: number; step: number; message: unknown } }
  'assistant/chunk': { type: 'assistant/chunk'; seq: number; time: number; data: { turn: number; step: number; chunk: unknown } }
  'tool/call': { type: 'tool/call'; seq: number; time: number; data: { turn: number; step: number; callId: CallId; name: string; arguments: unknown } }
  'tool/result': { type: 'tool/result'; seq: number; time: number; data: { turn: number; step: number; callId: CallId; result: unknown } }
  'todo/write': { type: 'todo/write'; seq: number; time: number; data: unknown }
  'request/header': { type: 'request/header'; seq: number; time: number; data: unknown }
}

export type SessionEvent = SessionEventMap[keyof SessionEventMap]

/** A user-role input message (used by `agent.inject` / `followup`). */
export interface UserMessage {
  readonly content: readonly ContentBlockLike[]
  readonly source: { readonly kind: string; readonly plugin?: string }
}

/** Minimal content-block shape. */
export interface ContentBlockLike {
  type: string
  text?: string
  [key: string]: unknown
}

/** The in-memory session event log (`ctx.sessions`). */
export interface Session {
  readonly id: SessionId
  readonly seq: number
  readonly events: readonly SessionEvent[]
  append(event: SessionEvent): void
}

/** Session store service. */
export interface SessionStore {
  create(id: SessionId, options?: { seed?: readonly SessionEvent[]; meta?: Record<string, unknown> }): Session
  get(id: SessionId): Session | undefined
}

/** Live agent handle. */
export interface Agent {
  readonly id: SessionId
  readonly session: Session
  readonly status: 'idle' | 'running'
  readonly ctx: any
  send(message: UserMessage, target: 'next-turn' | 'next-step', wakeup: boolean): void
  followup(message: UserMessage): void
  steer(message: UserMessage): void
  inject(message: UserMessage): void
  cancel(cause: unknown, options?: { keepInbox?: boolean }): void
  whenIdle(): Promise<void>
  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>
}

/** Agent registry service (`ctx.agents`). */
export interface AgentRegistry {
  currentInitiator(): Agent | undefined
  requireInitiator(): Agent
  withInitiator<T>(agent: Agent, operation: () => T): T
  create(options: unknown): Promise<unknown>
  resume(options: unknown): Promise<unknown>
  register(agent: Agent): () => void
  get(id: SessionId): Agent | undefined
  list(): Agent[]
  roots(): Agent[]
}

/** Settings scope (`ctx.settings` namespace handle). */
export interface SettingsScope<T> {
  get(): T
  watch(callback: (next: T, prev: T) => void | Promise<void>): () => void
  update(patch: object): Promise<void>
  replace(section: object): Promise<void>
}

/** Settings provider service. */
export interface SettingsProvider {
  register<T>(ns: string, schema: unknown, options?: { base?: Partial<T>; applies?: 'live' | 'restart'; validate?: (value: T) => void }): SettingsScope<T>
  get(ns: string): unknown
  update(ns: string, patch: object): Promise<void>
  replace(ns: string, section: object): Promise<void>
}
