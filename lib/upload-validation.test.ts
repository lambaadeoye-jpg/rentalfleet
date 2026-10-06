import { describe, it, expect } from "vitest";
import { sniffFileType, checkUpload, isUploadDocumentType, UPLOAD_TOKEN_RE, reviewBadge, uploadErrorMessage, MAX_UPLOAD_BYTES } from "./upload-validation";
import { fitWithin } from "./image-compress";
import { generateUploadToken, hashUploadToken } from "./upload-token";

const bytes = (...n: number[]) => Uint8Array.from([...n, ...new Array(Math.max(0, 16 - n.length)).fill(0)]);
const ascii = (s: string) => Array.from(s).map((c) => c.charCodeAt(0));

describe("sniffFileType", () => {
  it("recognises real formats by content", () => {
    expect(sniffFileType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg");
    expect(sniffFileType(bytes(0x89, ...ascii("PNG"), 0x0d, 0x0a, 0x1a, 0x0a))).toBe("png");
    expect(sniffFileType(bytes(...ascii("%PDF-1.7")))).toBe("pdf");
    expect(sniffFileType(bytes(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")))).toBe("webp");
    expect(sniffFileType(bytes(0, 0, 0, 24, ...ascii("ftypheic")))).toBe("heic");
  });
  it("rejects scripts, html, executables, short and empty input", () => {
    expect(sniffFileType(bytes(...ascii("<script>alert(1)</script>")))).toBeNull();
    expect(sniffFileType(bytes(...ascii("<html><body>")))).toBeNull();
    expect(sniffFileType(bytes(0x4d, 0x5a, 0x90, 0)))
      .toBeNull();
    expect(sniffFileType(new Uint8Array(0))).toBeNull();
    expect(sniffFileType(bytes(0, 0, 0, 24, ...ascii("ftypmp42")))).toBeNull(); // video, not a photo
  });
});

describe("checkUpload", () => {
  it("accepts a normal jpeg", () => expect(checkUpload(1000, bytes(0xff, 0xd8, 0xff))).toEqual({ ok: true, type: "jpeg" }));
  it("rejects empty, oversized and disguised files", () => {
    expect(checkUpload(0, bytes(0xff, 0xd8, 0xff)).ok).toBe(false);
    expect(checkUpload(MAX_UPLOAD_BYTES + 1, bytes(0xff, 0xd8, 0xff)).ok).toBe(false);
    expect(checkUpload(500, bytes(...ascii("<?php echo 1;"))).ok).toBe(false);
  });
});

describe("tokens and types", () => {
  it("generated tokens match the format and hash deterministically", () => {
    const { token, hash } = generateUploadToken();
    expect(UPLOAD_TOKEN_RE.test(token)).toBe(true);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashUploadToken(token)).toBe(hash);
    expect(generateUploadToken().token).not.toBe(token);
  });
  it("rejects malformed tokens and unknown document types", () => {
    for (const t of ["", "short", "a".repeat(44), "a".repeat(42) + "!", "../../etc/passwd"]) expect(UPLOAD_TOKEN_RE.test(t)).toBe(false);
    expect(isUploadDocumentType("drivers_license")).toBe(true);
    expect(isUploadDocumentType("passport")).toBe(false);
  });
});

describe("labels", () => {
  it("badges", () => {
    expect(reviewBadge("accepted").tone).toBe("ok");
    expect(reviewBadge("rejected").tone).toBe("warn");
    expect(reviewBadge("pending").tone).toBe("wait");
    expect(reviewBadge(null).tone).toBe("wait");
  });
  it("error messages hide internals", () => {
    expect(uploadErrorMessage("link_invalid")).toMatch(/expired/);
    expect(uploadErrorMessage("duplicate key value violates unique constraint")).toBe("Upload failed. Please try again.");
  });
});

describe("fitWithin", () => {
  it("shrinks long edge, keeps ratio, never upsizes", () => {
    expect(fitWithin(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(3000, 4000, 2000)).toEqual({ width: 1500, height: 2000 });
    expect(fitWithin(800, 600, 2000)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(0, 0, 2000)).toEqual({ width: 0, height: 0 });
  });
});
