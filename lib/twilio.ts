// Plain-HTTPS Twilio sender shared by the automation routes. Server-only.

export function twilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN &&
    (process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_FROM_NUMBER)
  );
}

export async function sendViaTwilio(to: string, body: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const service = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || (!service && !from)) return { ok: false, error: "twilio_not_configured" };
  const form = new URLSearchParams({ To: to, Body: body });
  if (service) form.set("MessagingServiceSid", service);
  else if (from) form.set("From", from);
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
      signal: AbortSignal.timeout(10000),
    });
    const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (!res.ok) return { ok: false, error: `twilio_${res.status}: ${json.message ?? "error"}`.slice(0, 200) };
    return { ok: true, id: json.sid };
  } catch (e) {
    return { ok: false, error: `twilio_network: ${(e as Error).message}`.slice(0, 200) };
  }
}
