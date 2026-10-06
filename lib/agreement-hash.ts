import { createHash } from "node:crypto";
import type { RenderedAgreement } from "./agreement";

// Server-only. A fixed key order makes the hash reproducible, so the stored
// signed text can always be re-checked against the hash recorded at signing.
export function agreementHash(r: RenderedAgreement): string {
  const canonical = JSON.stringify({
    intro: r.intro,
    clauses: r.clauses.map((c) => ({ number: c.number, title: c.title, body: c.body, initial: c.initial })),
  });
  return createHash("sha256").update(canonical).digest("hex");
}
