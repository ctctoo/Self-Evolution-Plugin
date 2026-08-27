/**
 * DEVELOPMENT-TIME type contract for the enforced JSON Schema subset used by
 * `@deepseek-ai/dsh-tools` (docs/subsystems/tools.zh.md § enforced raw JSON
 * Schema subset).
 */

/** Scalar JSON values supported by `enum` and `const`. */
export type JsonSchemaScalar = string | number | boolean | null

/** Single-type keywords accepted by the enforced subset. */
export type JsonSchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'

/** One raw JSON Schema node in the enforced subset. */
export interface JsonSchemaNode {
  type?: JsonSchemaType
  /** Exactly one branch must validate; at least two branches are required. */
  oneOf?: JsonSchemaNode[]
  /** Nested property schemas (`type: 'object'` only). */
  properties?: Record<string, JsonSchemaNode>
  /** Required property names; each must appear in `properties`. */
  required?: string[]
  /** `false` rejects undeclared keys; absent/`true` follows the open default. */
  additionalProperties?: boolean
  /** Item schema (`type: 'array'` only); absent accepts any JSON item. */
  items?: JsonSchemaNode
  /** Allowed values for a scalar node. */
  enum?: JsonSchemaScalar[]
  /** The single allowed value for a scalar node. */
  const?: JsonSchemaScalar
  /** Annotation, ignored for validation. */
  description?: string
  /** Annotation, ignored for validation. */
  title?: string
  /** Annotation, ignored for validation but required to be lossless JSON. */
  default?: unknown
  /** Annotation, ignored for validation but required to be lossless JSON. */
  examples?: unknown
}

/** A consumer-constrained object-rooted schema. */
export type ObjectJsonSchema = JsonSchemaNode & { type: 'object' }
