"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, Camera, Video, ChevronRight, ChevronLeft } from "lucide-react";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { prepareUploadFile } from "@/lib/image-compress";
import { cardChargedStatus } from "@/lib/runner-access";
import { checkVideo, handoverMissing, MAX_VIDEO_SECONDS } from "@/lib/handover";
import { confirmPickup } from "../applications/rental-actions";
import type { PickupItem } from "./list-actions";
import {
  getHandover, verifyIdentity, getLicensePhotoUrl, setQuickCheck, setRuleExplained, uploadWalkthroughPhoto,
  prepareVideoUpload, recordVideo, saveTestimonialRelease, declineTestimonial, type HandoverView,
} from "./handover-actions";

const STEPS = ["Renter", "Agreement and card", "Condition", "Rules", "Hand over"] as const;

function videoSeconds(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    const done = (n: number | null) => { clearTimeout(timer); URL.revokeObjectURL(url); resolve(n); };
    // Some phones never fire either event for formats the browser can't read; don't hang forever.
    const timer = setTimeout(() => done(null), 8000);
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => done(null);
    v.src = url;
  });
}

function Row({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, padding: "8px 0" }}>
      {ok ? <CheckCircle2 size={20} color="var(--signal-green, #16a34a)" /> : <Circle size={20} color="var(--text-secondary)" />}
      <span>{children}</span>
    </div>
  );
}

export default function PickupFlow({ item }: { item: PickupItem }) {
  const router = useRouter();
  const [view, setView] = useState<HandoverView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [licenseUrl, setLicenseUrl] = useState<string | null>(null);
  const [mileage, setMileage] = useState("");
  const [wantsTestimonial, setWantsTestimonial] = useState<boolean | null>(null);
  const [releaseName, setReleaseName] = useState("");
  const [finished, setFinished] = useState(false);
  const [rulesNote, setRulesNote] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const pendingArea = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await getHandover(item.rentalId);
    if (res.success) { setView(res.view); setLoadError(null); }
    else setLoadError(res.error);
  }, [item.rentalId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Keep the runner's place and mileage if the page reloads (signal drop, phone lock).
  const saveKey = `pickup-flow:${item.rentalId}`;
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(saveKey);
      if (raw) {
        const saved = JSON.parse(raw) as { step?: number; mileage?: string };
        if (typeof saved.step === "number" && saved.step >= 0 && saved.step < STEPS.length) setStep(saved.step);
        if (typeof saved.mileage === "string") setMileage(saved.mileage);
      }
    } catch { /* storage unavailable: start from the top */ }
  }, [saveKey]);
  useEffect(() => {
    try { sessionStorage.setItem(saveKey, JSON.stringify({ step, mileage })); } catch { /* ignore */ }
  }, [saveKey, step, mileage]);

  const card = cardChargedStatus(item.money);

  if (finished) {
    return (
      <div style={{ padding: "16px 0" }}>
        <p style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>Pickup confirmed.</p>
        <p className="muted-text">{rulesNote ?? "The renter was sent their house rules by text or email."}</p>
        <button type="button" className="button-primary" style={{ minHeight: 48, marginTop: 14 }} onClick={() => router.refresh()}>Done</button>
      </div>
    );
  }
  if (loadError) return <p className="error-text">{loadError}</p>;
  if (!view) return <p className="muted-text">Loading…</p>;

  const ruleIds = view.rules.map((r) => r.id);
  const missing = handoverMissing(
    { identityVerified: view.identityVerified, agreementSigned: item.agreementSigned, cardCharged: card.allPaid, areaCounts: view.areaCounts, hasWalkthroughVideo: view.hasWalkthroughVideo, checks: view.checks, briefingAcked: view.briefingAcked },
    ruleIds,
  );
  const conditionDone = view.areas.every((a) => (view.areaCounts[a.key] ?? 0) > 0) && view.hasWalkthroughVideo && view.quickChecks.every((q) => view.checks[q.key]);
  const rulesDone = ruleIds.every((id) => view.briefingAcked.includes(id));
  const stepDone = [view.identityVerified, item.agreementSigned && card.allPaid, conditionDone, rulesDone, false];

  async function run(label: string, fn: () => Promise<{ success: boolean; error?: string }>) {
    setBusy(label);
    setError(null);
    try {
      const res = await fn();
      if (!res.success) setError(res.error ?? "Something went wrong. Please try again.");
      await refresh();
    } catch {
      setError("That didn’t go through. Check your signal and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function showLicense() {
    setBusy("license");
    setError(null);
    try {
      const res = await getLicensePhotoUrl(item.rentalId);
      if (!res.success || !res.url) { setError(res.error ?? "Couldn’t open the photo."); return; }
      setLicenseUrl(res.url);
    } catch {
      setError("Couldn’t open the photo. Check your signal and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function onPhotoPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const area = pendingArea.current;
    e.target.value = "";
    if (!file || !area) return;
    await run(`photo-${area}`, async () => {
      const small = await prepareUploadFile(file);
      const fd = new FormData();
      fd.set("file", small);
      return uploadWalkthroughPhoto(item.rentalId, area, fd);
    });
  }

  async function uploadVideo(kind: "walkthrough" | "testimonial", file: File) {
    setBusy(`video-${kind}`);
    setError(null);
    try {
      const secs = await videoSeconds(file);
      const ok = checkVideo({ seconds: secs, bytes: file.size });
      if (!ok.ok) { setError(ok.message); return; }
      const ext = (file.name.includes(".") ? file.name.split(".").pop() : null) || (file.type.split("/")[1] ?? "mp4");
      const prep = await prepareVideoUpload(item.rentalId, kind, ext.toLowerCase());
      if (!prep.success || !prep.path || !prep.token) { setError(prep.error ?? "Couldn’t start the upload."); return; }
      const supabase = createBrowserClient();
      const { error: upErr } = await supabase.storage.from("inspection-photos").uploadToSignedUrl(prep.path, prep.token, file);
      if (upErr) { setError("The video didn’t upload. Check your signal and try again."); return; }
      const rec = await recordVideo(item.rentalId, kind, prep.path, secs as number);
      if (!rec.success) setError(rec.error ?? "Couldn’t save the video.");
      await refresh();
    } catch {
      setError("The video didn’t upload. Check your signal and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function handleConfirm() {
    if (missing.length > 0) { setError(missing[0] + "."); return; }
    if (!window.confirm(`Hand over the ${item.vehicleLabel} to ${item.customerFirstName} ${item.customerLastName}? This can’t be undone from here.`)) return;
    setBusy("confirm");
    setError(null);
    try {
      const res = await confirmPickup(item.rentalId, Number(mileage), true);
      if (!res.success) { setError(res.error ?? "Couldn’t confirm pickup."); return; }
      try { sessionStorage.removeItem(saveKey); } catch { /* ignore */ }
      setRulesNote(res.rulesSent ? null : (res.rulesNote ?? null));
      setFinished(true);
    } catch {
      setError("Couldn’t confirm. Check your signal and tap confirm again. If the car already shows as handed over, you’re done.");
    } finally {
      setBusy(null);
    }
  }

  const big: React.CSSProperties = { minHeight: 48, fontSize: 15 };

  return (
    <div>
      {error && <p className="error-text" role="alert" style={{ marginBottom: 12, fontWeight: 600 }}>{error}</p>}
      {/* progress */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }} aria-label="Pickup steps">
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => { setStep(i); setError(null); }}
            aria-current={i === step ? "step" : undefined}
            style={{
              flex: 1, border: "none", borderRadius: 8, padding: "10px 2px", minHeight: 44, fontSize: 12, fontWeight: 700, cursor: "pointer",
              background: i === step ? "var(--midnight, #0f172a)" : stepDone[i] ? "#dcfce7" : "var(--cloud, #f1f5f9)",
              color: i === step ? "white" : stepDone[i] ? "#166534" : "var(--text-secondary)",
            }}
          >
            {stepDone[i] ? "✓ " : `${i + 1}. `}{label}
          </button>
        ))}
      </div>

      {step === 0 && (
        <div>
          <p style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{item.customerFirstName} {item.customerLastName}</p>
          <p className="muted-text" style={{ marginBottom: 12 }}>Introduce yourself, then check their license against the photo on file.</p>
          {licenseUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={licenseUrl} alt="Driver’s license on file" style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border)", marginBottom: 12 }} />
          ) : (
            <button type="button" className="button-secondary" style={{ ...big, color: "var(--text)", borderColor: "var(--border)", marginBottom: 12 }} onClick={showLicense} disabled={busy === "license"}>
              {busy === "license" ? "Opening…" : "Show license photo"}
            </button>
          )}
          <button
            type="button"
            className={view.identityVerified ? "button-secondary" : "button-primary"}
            style={{ ...big, width: "100%" }}
            disabled={busy === "identity" || view.identityVerified || !licenseUrl}
            onClick={() => run("identity", () => verifyIdentity(item.rentalId))}
          >
            {view.identityVerified ? "ID checked ✓" : licenseUrl ? "The license and the person match" : "Show the photo first"}
          </button>
        </div>
      )}

      {step === 1 && (
        <div>
          <Row ok={item.agreementSigned}>Rental agreement signed</Row>
          <Row ok={card.rentPaid}>First rent charged to the card</Row>
          <Row ok={card.depositPaid}>Deposit charged to the card</Row>
          {!(item.agreementSigned && card.allPaid) && (
            <p className="error-text" style={{ fontSize: 14, marginTop: 8 }}>
              Don’t hand over the keys yet. Ask the office to fix the item above, then tap the button below.
            </p>
          )}
          <button type="button" className="button-secondary" style={{ ...big, marginTop: 8 }} onClick={() => router.refresh()}>Check again</button>
        </div>
      )}

      {step === 2 && (
        <div>
          <input ref={photoInput} type="file" accept="image/*" capture="environment" onChange={onPhotoPicked} style={{ display: "none" }} />
          <p className="muted-text" style={{ marginBottom: 10 }}>Take at least one photo of each part of the car.</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
            {view.areas.map((a) => {
              const n = view.areaCounts[a.key] ?? 0;
              return (
                <button
                  key={a.key}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => { pendingArea.current = a.key; photoInput.current?.click(); }}
                  style={{ ...big, textAlign: "left", padding: "10px 12px", borderRadius: 10, border: `1px solid ${n > 0 ? "#86efac" : "var(--border)"}`, background: n > 0 ? "#f0fdf4" : "white", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
                >
                  {busy === `photo-${a.key}` ? "Uploading…" : (<><Camera size={16} /> <span style={{ flex: 1 }}>{a.label}</span> {n > 0 && <b>✓ {n}</b>}</>)}
                </button>
              );
            })}
          </div>

          <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>Walkthrough video (up to {MAX_VIDEO_SECONDS} seconds)</p>
          <label className={view.hasWalkthroughVideo ? "button-secondary" : "button-primary"} style={{ ...big, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer", marginBottom: 16, color: view.hasWalkthroughVideo ? "var(--text)" : undefined }}>
            <Video size={18} /> {busy === "video-walkthrough" ? "Uploading…" : view.hasWalkthroughVideo ? "Video saved ✓ (tap to replace)" : "Record walkthrough video"}
            <input type="file" accept="video/*" capture="environment" style={{ display: "none" }} disabled={busy !== null} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadVideo("walkthrough", f); }} />
          </label>

          <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>Quick checks</p>
          {view.quickChecks.map((q) => (
            <label key={q.key} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 44, fontSize: 15 }}>
              <input type="checkbox" style={{ width: 22, height: 22 }} checked={view.checks[q.key] === true} disabled={busy !== null} onChange={(e) => run(`check-${q.key}`, () => setQuickCheck(item.rentalId, q.key, e.target.checked))} />
              {q.label}
            </label>
          ))}
        </div>
      )}

      {step === 3 && (
        <div>
          <p className="muted-text" style={{ marginBottom: 10 }}>Explain each rule to the renter, then tap it. The renter also gets these by text and email afterwards.</p>
          {view.rules.map((r) => {
            const done = view.briefingAcked.includes(r.id);
            return (
              <div key={r.id} style={{ border: `1px solid ${done ? "#86efac" : "var(--border)"}`, background: done ? "#f0fdf4" : "white", borderRadius: 10, padding: 12, marginBottom: 8 }}>
                <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{r.title}</p>
                <p style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 8 }}>{r.text}</p>
                <button type="button" className={done ? "button-secondary" : "button-primary"} style={{ minHeight: 48, fontSize: 14, color: done ? "var(--text)" : undefined, borderColor: done ? "var(--border)" : undefined }} disabled={busy !== null} onClick={() => run(`rule-${r.id}`, () => setRuleExplained(item.rentalId, r.id, !done))}>
                  {done ? "Explained ✓ (tap to undo)" : "I explained this"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {step === 4 && (
        <div>
          <label className="field">
            <span style={{ fontSize: 13, fontWeight: 600 }}>Starting mileage</span>
            <input type="number" inputMode="numeric" value={mileage} onChange={(e) => setMileage(e.target.value)} style={{ minHeight: 48, fontSize: 16 }} />
          </label>

          <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12, margin: "16px 0" }}>
            <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Video testimonial (optional)</p>
            {view.testimonialStatus === "recorded" ? (
              <p style={{ fontSize: 14 }}>Recorded, with a signed release ✓</p>
            ) : view.testimonialStatus === "declined" ? (
              <p className="muted-text" style={{ fontSize: 14 }}>The renter said no thanks.</p>
            ) : wantsTestimonial === null ? (
              <>
                <p className="muted-text" style={{ fontSize: 14, marginBottom: 8 }}>Ask: “Would you mind a short video about your experience?”</p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="button-primary" style={{ ...big, flex: 1 }} onClick={() => setWantsTestimonial(true)}>Yes, they agreed</button>
                  <button type="button" className="button-secondary" style={{ ...big, flex: 1, color: "var(--text)", borderColor: "var(--border)" }} onClick={() => run("decline", () => declineTestimonial(item.rentalId))}>No thanks</button>
                </div>
              </>
            ) : (
              <>
                <label className={view.hasTestimonialVideo ? "button-secondary" : "button-primary"} style={{ ...big, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer", marginBottom: 12, color: view.hasTestimonialVideo ? "var(--text)" : undefined }}>
                  <Video size={18} /> {busy === "video-testimonial" ? "Uploading…" : view.hasTestimonialVideo ? "Video saved ✓ (tap to replace)" : "Record: “How was your experience?”"}
                  <input type="file" accept="video/*" capture="user" style={{ display: "none" }} disabled={busy !== null} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadVideo("testimonial", f); }} />
                </label>
                {view.hasTestimonialVideo && (
                  <>
                    <p style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 8 }}>{view.releaseText}</p>
                    <label className="field">
                      <span style={{ fontSize: 13, fontWeight: 600 }}>Renter types their full name to agree</span>
                      <input value={releaseName} onChange={(e) => setReleaseName(e.target.value)} style={{ minHeight: 48, fontSize: 16 }} autoComplete="off" />
                    </label>
                    <button type="button" className="button-primary" style={big} disabled={busy !== null} onClick={() => run("release", () => saveTestimonialRelease(item.rentalId, releaseName))}>Save release</button>
                  </>
                )}
              </>
            )}
          </div>

          {missing.length > 0 && (
            <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 10, padding: 12, marginBottom: 12 }}>
              <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Still to do</p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.6 }}>{missing.map((m) => <li key={m}>{m}</li>)}</ul>
            </div>
          )}

          <button type="button" className="button-primary" style={{ ...big, width: "100%" }} disabled={busy !== null || missing.length > 0 || !mileage} onClick={handleConfirm}>
            {busy === "confirm" ? "Confirming…" : "Confirm pickup and send rules"}
          </button>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
        <button type="button" className="button-secondary" style={{ ...big, visibility: step === 0 ? "hidden" : "visible" }} onClick={() => { setStep(step - 1); setError(null); }}><ChevronLeft size={16} /> Back</button>
        {step < STEPS.length - 1 && <button type="button" className="button-primary" style={big} onClick={() => { setStep(step + 1); setError(null); }}>Next <ChevronRight size={16} /></button>}
      </div>
    </div>
  );
}
