import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@supabase/supabase-js", () => ({ createClient: () => { throw new Error("should not be reached without authorization"); } }));

import { POST } from "./route";

const req = (secret?: string) => new Request("http://localhost/api/automation/weekly-summary", { method: "POST", headers: secret ? { "x-automation-secret": secret } : {} });

describe("POST /api/automation/weekly-summary", () => {
  beforeEach(() => {
    process.env.AUTOMATION_API_SECRET = "right-secret";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });
  it("rejects a call with no secret or the wrong one", async () => {
    expect((await POST(req())).status).toBe(401);
    expect((await POST(req("wrong"))).status).toBe(401);
  });
  it("says the server is misconfigured when the database keys are missing, without touching the database", async () => {
    expect((await POST(req("right-secret"))).status).toBe(500);
  });
});
