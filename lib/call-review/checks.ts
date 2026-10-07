import { STOP_PHRASES } from "../outreach-rules";
import { redact } from "./redact";
import { OUTCOME_TOOLS, type Finding, type NormalizedCall, type Severity } from "./types";

// Rules mirror the "things you never say" lists in the assistant prompts. Pure text checks: no AI, no cost.

type TextRule = { rule: string; severity: Severity; test: (t: string) => boolean };

const NEG_BEFORE = /\b(no|not|never|can'?t|cannot|don'?t|doesn'?t|won'?t|isn'?t|without)\b/i;
const DIGIT_WORDS = "zero|oh|one|two|three|four|five|six|seven|eight|nine";
const SPOKEN_NUMBER = new RegExp(`\\b(?:(?:${DIGIT_WORDS})[\\s,.-]+){6,}(?:${DIGIT_WORDS})\\b`, "i");

export const TEXT_RULES: TextRule[] = [
  {
    rule: "guarantee",
    severity: "high",
    test: (t) => {
      const m = /\bguarant(?:ee|eed|ees|eeing)\b/i.exec(t);
      return Boolean(m) && !NEG_BEFORE.test(t.slice(Math.max(0, m!.index - 30), m!.index));
    },
  },
  {
    rule: "promised_timeframe",
    severity: "high",
    test: (t) => {
      if (!(/\b(?:24|twenty[- ]?four)\s*hours?\b/i.test(t) || /\bsame[- ]day\b/i.test(t))) return false;
      // The approved phrase: "many customers can move through ... in less than 24 hours when ... completed promptly".
      return !(/less than (?:24|twenty[- ]?four) hours/i.test(t) && /\bwhen\b/i.test(t));
    },
  },
  {
    rule: "deposit_amount",
    severity: "high",
    // The amount must be tied to the deposit itself ("deposit is $300", "a $300 refundable deposit"), not just nearby.
    test: (t) =>
      /deposit\s*(?:is|of|will be|would be|comes to|runs|:)?\s*(?:about|around|roughly|just|only)?\s*\$\s?\d/i.test(t) ||
      /\$\s?\d[\d,]*\s*(?:(?:refundable|security|flat|one-time)\s+)*deposit/i.test(t) ||
      /deposit\s*(?:is|of|will be)?\s*(?:about|around|roughly)?\s*\d{2,4}\s*dollars/i.test(t),
  },
  {
    rule: "mileage_limit",
    severity: "high",
    test: (t) =>
      !/unlimited|no (?:mileage )?(?:limit|cap)/i.test(t) &&
      (/\b\d[\d,]*\s*(?:miles|mi)\b[^.?!]{0,20}\b(?:per|a|each|every)\s+(?:day|week|month)/i.test(t) || /\bmileage\s+(?:cap|limit)\b/i.test(t)),
  },
  {
    rule: "cash_accepted",
    severity: "medium",
    test: (t) => /\bcash\b/i.test(t) && /\b(?:accept|take|can pay|pay (?:in|with))\b/i.test(t) && !NEG_BEFORE.test(t),
  },
  {
    rule: "callback_timing",
    severity: "medium",
    test: (t) =>
      /(?:call|reach|get back to|contact)[^.?!]{0,40}\b(?:within|in the next|by)\s+(?:\d+|an?|one|two|three|a few|few)\s*(?:minutes?|hours?|days?)/i.test(t) ||
      /\b(?:tomorrow|tonight|later today|this afternoon|this evening|first thing)\b[^.?!]{0,30}(?:call|reach|contact)/i.test(t) ||
      /(?:call|reach|contact)[^.?!]{0,40}\b(?:tomorrow|tonight|later today|this afternoon|this evening|first thing)/i.test(t),
  },
  {
    rule: "phone_number_given",
    severity: "low",
    test: (t) => /(?<!\d)\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?!\d)/.test(t) || SPOKEN_NUMBER.test(t),
  },
  {
    rule: "outcome_hint",
    severity: "high",
    test: (t) =>
      /\byou(?:'re| are| have been| were)\s+(?:approved|declined|denied|accepted|rejected)\b/i.test(t) ||
      /\b(?:we|the team)\s+(?:approved|declined|denied)\s+(?:you|your)\b/i.test(t),
  },
];

/** Runs every text rule on one string. Used on assistant speech and on proposed prompt wording. */
export function scanText(text: string): { rule: string; severity: Severity }[] {
  return TEXT_RULES.filter((r) => r.test(text)).map((r) => ({ rule: r.rule, severity: r.severity }));
}

const AI_QUESTION =
  /(?:are you|is this|am i (?:talking|speaking) (?:to|with)|you(?:'re| are)) (?:a |an |the )?(?:real|actual|live)?\s*(?:human|person|robot|bot|ai|a\.i\.|machine|automated|computer|recording|real person)\b|\bis this (?:a |an )?(?:ai|bot|robot|recording|real person|machine)\b/i;
const AI_DENIAL = /\b(?:i'?m|i am) (?:a |an )?(?:real|actual|live) (?:person|human)\b|\bnot (?:a |an )?(?:bot|robot|ai|machine)\b|\b(?:yes|yeah),? (?:i'?m|i am) (?:a )?(?:person|human)\b/i;
const AI_DISCLOSURE = /\b(?:virtual|ai|a\.i\.|artificial|automated|assistant|bot|computer)\b/i;

function quote(t: string): string {
  return redact(t).replace(/\s+/g, " ").slice(0, 220);
}

export function runChecks(call: NormalizedCall): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  const push = (f: Finding) => {
    const key = `${f.rule}|${f.quote}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(f);
    }
  };

  call.turns.forEach((turn, i) => {
    if (turn.role === "assistant") {
      for (const r of TEXT_RULES) {
        if (!r.test(turn.text)) continue;
        // The pickup assistant legitimately talks about an approved rental; hold it to medium, not high.
        const severity: Severity = r.rule === "outcome_hint" && call.assistantKey === "pickup" ? "medium" : r.severity;
        push({ rule: r.rule, severity, quote: quote(turn.text) });
      }
    } else if (AI_QUESTION.test(turn.text)) {
      const replies = call.turns.slice(i + 1).filter((t) => t.role === "assistant").slice(0, 2).map((t) => t.text).join(" ");
      if (replies) {
        if (AI_DENIAL.test(replies)) push({ rule: "ai_denial", severity: "high", quote: quote(replies) });
        else if (!AI_DISCLOSURE.test(replies)) push({ rule: "ai_not_disclosed", severity: "high", quote: quote(replies) });
      }
    }
  });

  // Asked to stop being contacted but the stop tool was never used.
  const stopAsk = call.turns.find((t) => t.role === "user" && t.text.length > 6 && STOP_PHRASES.test(t.text));
  if (stopAsk && !call.toolCalls.some((c) => c.name === "stop_contacting")) {
    push({ rule: "stop_without_tool", severity: "high", quote: quote(stopAsk.text) });
  }

  // Outbound assistants must file exactly one outcome report.
  const outcomeTool = Object.entries(OUTCOME_TOOLS).find(([, key]) => key === call.assistantKey)?.[0];
  if (outcomeTool) {
    const n = call.toolCalls.filter((c) => c.name === outcomeTool).length;
    if (n === 0) push({ rule: "missing_outcome_report", severity: "medium", quote: `${outcomeTool} was not called` });
    if (n > 1) push({ rule: "duplicate_outcome_report", severity: "low", quote: `${outcomeTool} called ${n} times` });
  }

  for (const name of new Set(call.toolCalls.filter((c) => c.failed).map((c) => c.name))) {
    push({ rule: "tool_failure", severity: "medium", quote: `${name} returned an error` });
  }

  if (call.endedReason && /error|failed|pipeline|invalid/i.test(call.endedReason)) {
    push({ rule: "call_error", severity: "medium", quote: call.endedReason.slice(0, 120) });
  }

  return out;
}

export function transcriptText(call: NormalizedCall): string {
  return call.turns.map((t) => `${t.role === "assistant" ? "A" : "C"}: ${redact(t.text)}`).join("\n");
}

/** The outcome the assistant reported for itself (from its outcome tool), if any. */
export function reportedOutcome(call: NormalizedCall): string | null {
  const tool = call.toolCalls.find((c) => c.name in OUTCOME_TOOLS);
  const o = tool?.args?.outcome;
  return typeof o === "string" ? o.slice(0, 60) : null;
}
