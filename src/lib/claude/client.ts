// Claude API client wrapper — server-side only. Never import this module (or
// anything in src/lib/claude/*) from a "use client" component; it reads
// ANTHROPIC_API_KEY and must only ever run in a Next.js route handler / server
// context. UI code talks to Claude exclusively through the /api/claude/*
// routes (see src/app/api/claude/*), never by importing this file directly.

import Anthropic from "@anthropic-ai/sdk";
import { z, type ZodType, type ZodTypeAny } from "zod";
import { CLAUDE_MODEL, isClaudeApiConfigured } from "./config";

/**
 * Repair-tolerant array schema for a known tool-use quirk: Claude
 * occasionally returns an array-of-objects field as a plain object (e.g.
 * `{"0": {...}, "1": {...}}` or `{claim_1: {...}, claim_2: {...}}`) instead
 * of a native array. Accepts either shape and normalizes to an array via
 * Object.values when given an object. Use this for any array-of-objects
 * field in a Claude tool schema — plain string/number arrays don't need it.
 */
export function lenientArray<T extends ZodTypeAny>(itemSchema: T) {
  return z.preprocess((value) => {
    if (Array.isArray(value)) return value;
    if (value !== null && typeof value === "object") {
      const values = Object.values(value as Record<string, unknown>);
      // Self-wrapped quirk: the field's own value came back as e.g.
      // {"Claims": [...]} instead of the array directly (observed with
      // claim extraction) — unwrap to the inner array in that case.
      if (values.length === 1 && Array.isArray(values[0])) return values[0];
      return values;
    }
    return value;
  }, z.array(itemSchema));
}

/**
 * Repair-tolerant object schema for the same self-wrapping quirk: a
 * multi-key object field (e.g. `agent_results` with four agent keys)
 * occasionally comes back double-wrapped as `{"agent_results": {...actual
 * four keys...}}` instead of the object directly. If the value has exactly
 * one key whose value is itself an object, unwrap to that inner object
 * before validating — safe to attempt unconditionally, since an incorrect
 * unwrap just fails the subsequent Zod validation the same way the
 * un-unwrapped value would have.
 */
export function lenientObject<T extends ZodTypeAny>(schema: T) {
  return z.preprocess((value) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length === 1) {
        const [, inner] = entries[0];
        if (inner !== null && typeof inner === "object" && !Array.isArray(inner)) return inner;
      }
    }
    return value;
  }, schema);
}

export interface ClaudeJsonToolSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface CallClaudeJsonParams<T> {
  /** Short identifier used only in dev-console log lines, e.g. "claim_extraction". */
  taskName: string;
  system: string;
  /** User message content — keep this small (claim text + compact context, not whole files). */
  prompt: string;
  /** Name of the single tool Claude is forced to call, e.g. "return_extracted_claims". */
  toolName: string;
  toolDescription: string;
  inputSchema: ClaudeJsonToolSchema;
  /** Zod schema the tool_use input is validated against before being trusted. */
  schema: ZodType<T>;
  maxTokens: number;
}

export type CallClaudeJsonResult<T> =
  | { ok: true; data: T; source: "claude" }
  | { ok: false; reason: string; source: "unavailable" | "error" | "invalid_output" };

let cachedClient: Anthropic | null = null;

/** Lazily-constructed, cached Anthropic client. Only call after isClaudeApiConfigured() is true. */
export function getClaudeClient(): Anthropic {
  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return cachedClient;
}

/**
 * Dev-only error logging. Deliberately logs only a short message/kind, never
 * the raw request/response body (which could echo back the Authorization
 * header or other request internals via SDK error objects).
 */
function logClaudeError(taskName: string, kind: string, detail: unknown): void {
  const message = detail instanceof Error ? detail.message : typeof detail === "string" ? detail : safeStringify(detail);
  console.error(`[claude:${taskName}] ${kind}: ${message}`);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)?.slice(0, 500) ?? String(value);
  } catch {
    return "[unserializable]";
  }
}

/**
 * Repair step for a known tool-use quirk: Claude occasionally returns a
 * nested array/object field as a JSON-encoded string instead of a native
 * value (e.g. `"Claims": "[{...}]"` instead of `"Claims": [{...}]`). Walks
 * the parsed tool input recursively and JSON.parses any string that looks
 * like a JSON array/object, before Zod validation runs. Leaves ordinary
 * strings untouched.
 */
function repairStringifiedJsonFields(value: unknown, depth = 0): unknown {
  if (depth > 6) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
      try {
        return repairStringifiedJsonFields(JSON.parse(trimmed), depth + 1);
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => repairStringifiedJsonFields(item, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, repairStringifiedJsonFields(v, depth + 1)]));
  }
  return value;
}

/**
 * Calls Claude with a single forced tool call to get schema-shaped JSON back
 * (Anthropic's supported structured-output pattern: force tool_choice to one
 * tool and read its input). Validates the tool's input against the given Zod
 * schema before trusting it.
 *
 * Never throws. Every failure mode (no API key, network error, malformed
 * output, schema mismatch) resolves to `{ ok: false, ... }` so callers can
 * fall back to deterministic/mock behavior without a try/catch of their own.
 */
export async function callClaudeJson<T>(params: CallClaudeJsonParams<T>): Promise<CallClaudeJsonResult<T>> {
  if (!isClaudeApiConfigured()) {
    return { ok: false, reason: "ANTHROPIC_API_KEY is not set.", source: "unavailable" };
  }

  let client: Anthropic;
  try {
    client = getClaudeClient();
  } catch (err) {
    logClaudeError(params.taskName, "client_init_failed", err);
    return { ok: false, reason: "Failed to initialize the Claude client.", source: "error" };
  }

  let response: Anthropic.Messages.Message;
  try {
    response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: params.maxTokens,
      system: params.system,
      messages: [{ role: "user", content: params.prompt }],
      tools: [
        {
          name: params.toolName,
          description: params.toolDescription,
          input_schema: params.inputSchema,
        },
      ],
      tool_choice: { type: "tool", name: params.toolName },
    });
  } catch (err) {
    logClaudeError(params.taskName, "request_failed", err);
    return { ok: false, reason: "The Claude API request failed.", source: "error" };
  }

  const toolUse = response.content.find((block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use");
  if (!toolUse) {
    logClaudeError(params.taskName, "no_tool_use_block", { stop_reason: response.stop_reason });
    return { ok: false, reason: "Claude did not return structured output.", source: "invalid_output" };
  }

  const repairedInput = repairStringifiedJsonFields(toolUse.input);
  const parsed = params.schema.safeParse(repairedInput);
  if (!parsed.success) {
    logClaudeError(params.taskName, "schema_validation_failed", parsed.error.issues.slice(0, 5));
    return { ok: false, reason: "Claude's output did not match the expected schema.", source: "invalid_output" };
  }

  return { ok: true, data: parsed.data, source: "claude" };
}
