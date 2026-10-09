import { createHash, timingSafeEqual } from "node:crypto";

// Checks the shared secret the n8n workflows send. Compared in constant time, and the env value may hold
// several comma-separated secrets so the key can be rotated without downtime (add the new one, update n8n, remove the old).
function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function isAutomationAuthorized(request: Request): boolean {
  const sent = request.headers.get("x-automation-secret");
  const configured = process.env.AUTOMATION_API_SECRET;
  if (!sent || !configured) return false;
  const sentDigest = digest(sent);
  let ok = false;
  for (const candidate of configured.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (timingSafeEqual(sentDigest, digest(candidate))) ok = true;
  }
  return ok;
}
