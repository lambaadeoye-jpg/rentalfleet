import { ASSISTANT_KEYS, type NormalizedCall, type Turn, type ToolCall } from "./types";

type Json = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function parseArgs(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object") return v as Record<string, unknown>;
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return p && typeof p === "object" ? (p as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

const FAIL_RE = /\b(error|unavailable|unauthorized|forbidden|timed? ?out)\b|"status"\s*:\s*(4|5)\d\d/i;

/** Turns one Vapi call record into the small shape the review uses. Tolerates the formats Vapi returns. */
export function normalizeCall(raw: Json): NormalizedCall | null {
  const id = str(raw.id);
  const assistantKey = ASSISTANT_KEYS[str(raw.assistantId)];
  if (!id || !assistantKey) return null;

  const artifact = (raw.artifact ?? {}) as Json;
  const messages = (Array.isArray(artifact.messages) ? artifact.messages : Array.isArray(raw.messages) ? raw.messages : []) as Json[];

  const turns: Turn[] = [];
  const calls: (ToolCall & { id: string })[] = [];

  for (const m of messages) {
    const role = str(m.role);
    if (role === "assistant" || role === "bot") {
      const text = str(m.message) || str(m.content);
      if (text.trim()) turns.push({ role: "assistant", text: text.trim() });
      const tcs = Array.isArray(m.toolCalls) ? (m.toolCalls as Json[]) : [];
      for (const tc of tcs) {
        const fn = (tc.function ?? {}) as Json;
        const name = str(fn.name);
        if (name) calls.push({ id: str(tc.id), name, args: parseArgs(fn.arguments), result: null, failed: false });
      }
    } else if (role === "user") {
      const text = str(m.message) || str(m.content);
      if (text.trim()) turns.push({ role: "user", text: text.trim() });
    } else if (role === "tool_calls") {
      const tcs = Array.isArray(m.toolCalls) ? (m.toolCalls as Json[]) : [];
      for (const tc of tcs) {
        const fn = (tc.function ?? {}) as Json;
        const name = str(fn.name);
        if (name) calls.push({ id: str(tc.id), name, args: parseArgs(fn.arguments), result: null, failed: false });
      }
    } else if (role === "tool_call_result" || role === "tool") {
      const tid = str(m.toolCallId) || str(m.tool_call_id);
      const result = typeof m.result === "string" ? m.result : m.result != null ? JSON.stringify(m.result) : str(m.content) || str(m.message);
      const target = calls.find((c) => c.id && c.id === tid && c.result === null) ?? calls.find((c) => c.name === str(m.name) && c.result === null);
      if (target) {
        target.result = result;
        target.failed = FAIL_RE.test(result);
      }
    }
  }

  // Fallback: a plain "AI: ... / User: ..." transcript string.
  if (turns.length === 0 && typeof raw.transcript === "string") {
    for (const line of raw.transcript.split(/\r?\n/)) {
      const m = /^\s*(AI|Assistant|Bot|User|Customer)\s*:\s*(.+)$/i.exec(line);
      if (m) turns.push({ role: /^(user|customer)$/i.test(m[1]) ? "user" : "assistant", text: m[2].trim() });
    }
  }

  const startedAt = str(raw.startedAt) || str(raw.createdAt) || null;
  const endedAt = str(raw.endedAt) || null;
  const durationS =
    startedAt && endedAt && !Number.isNaN(Date.parse(startedAt)) && !Number.isNaN(Date.parse(endedAt))
      ? Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000))
      : null;
  const customer = (raw.customer ?? {}) as Json;

  return {
    id,
    assistantKey,
    startedAt,
    endedAt,
    durationS,
    endedReason: str(raw.endedReason) || null,
    turns,
    toolCalls: calls.map(({ id: _id, ...rest }) => rest),
    phone: str(customer.number) || null,
  };
}
