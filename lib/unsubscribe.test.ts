import { describe, it, expect, beforeEach } from "vitest";
import { makeUnsubscribeToken, verifyUnsubscribeToken, unsubscribeUrl, maskEmail } from "./unsubscribe";

beforeEach(() => { process.env.AUTOMATION_API_SECRET = "s3cret"; });

describe("unsubscribe token", () => {
  it("round-trips and lowercases", () => {
    const t = makeUnsubscribeToken(" Sam@Example.com ")!;
    expect(verifyUnsubscribeToken(t)).toBe("sam@example.com");
  });
  it("rejects tampering, other addresses and a changed secret", () => {
    const t = makeUnsubscribeToken("a@b.com")!;
    const [, sig] = t.split(".");
    const other = Buffer.from("x@y.com").toString("base64url");
    expect(verifyUnsubscribeToken(`${other}.${sig}`)).toBeNull();
    expect(verifyUnsubscribeToken(t + "x")).toBeNull();
    expect(verifyUnsubscribeToken("garbage")).toBeNull();
    process.env.AUTOMATION_API_SECRET = "different";
    expect(verifyUnsubscribeToken(t)).toBeNull();
  });
  it("returns null without a secret", () => {
    delete process.env.AUTOMATION_API_SECRET;
    expect(makeUnsubscribeToken("a@b.com")).toBeNull();
    expect(unsubscribeUrl("https://x.com", "a@b.com")).toBeNull();
  });
  it("builds a url and masks the address", () => {
    expect(unsubscribeUrl("https://rentzivo.com/", "a@b.com")).toMatch(/^https:\/\/rentzivo\.com\/unsubscribe\?t=/);
    expect(maskEmail("samuel@example.com")).toBe("s*****@example.com");
  });
});
