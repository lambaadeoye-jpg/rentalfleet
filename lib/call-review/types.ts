export type AssistantKey = "front_desk" | "new_lead" | "nudge" | "pickup";

// Vapi assistant ids for the four Zivo assistants. Calls from any other assistant are ignored.
export const ASSISTANT_KEYS: Record<string, AssistantKey> = {
  "0b75801d-6873-4358-ae1b-94fb7cce5650": "front_desk",
  "31cb3413-5f3e-4ac3-a74b-0eed9e9a577b": "new_lead",
  "bc9a045a-d030-4da7-91ad-2ee7a98c3fb7": "nudge",
  "596e2438-bc50-4d4b-be54-05710c8277a6": "pickup",
};

export const OUTCOME_TOOLS: Record<string, AssistantKey> = {
  report_call_outcome: "new_lead",
  report_application_outcome: "nudge",
  report_pickup_outcome: "pickup",
};

export type Turn = { role: "assistant" | "user"; text: string };
export type ToolCall = { name: string; args: Record<string, unknown>; result: string | null; failed: boolean };

export type NormalizedCall = {
  id: string;
  assistantKey: AssistantKey;
  startedAt: string | null;
  endedAt: string | null;
  durationS: number | null;
  endedReason: string | null;
  turns: Turn[];
  toolCalls: ToolCall[];
  phone: string | null;
};

export type Severity = "high" | "medium" | "low";
export type Finding = { rule: string; severity: Severity; quote: string };
