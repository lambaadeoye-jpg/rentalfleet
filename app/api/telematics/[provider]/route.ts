import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { adapterFor } from "@/lib/telematics/adapters";
import { ingestReadings } from "@/lib/telematics/ingest";
import { PROVIDERS } from "@/lib/telematics/types";
import { fireN8nWebhook, N8N_WEBHOOK_PATHS } from "@/lib/n8n-webhook";

// Receives tracker messages. One URL per provider:
//   POST /api/telematics/bouncie   (Bouncie webhooks)
//   POST /api/telematics/goldstar  (generic JSON, see lib/telematics/adapters.ts)
//   POST /api/telematics/other     (generic JSON)
//
// Auth: the shared key must arrive in "Authorization" or "X-Bouncie-Authorization"
// (Bouncie sends both) or "x-telematics-secret". Set TELEMATICS_WEBHOOK_SECRET to match.
//
// Bouncie disables a webhook after repeated 4xx/5xx replies, so anything that is
// merely unusual (unknown device, event we don't use) is answered 200.

const MAX_BODY_BYTES = 1_000_000;

function sameSecret(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given.trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!PROVIDERS.includes(provider as (typeof PROVIDERS)[number]) || provider === "manual") {
    return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  }

  const expected = process.env.TELEMATICS_WEBHOOK_SECRET;
  if (!expected) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  const given =
    request.headers.get("authorization") ?? request.headers.get("x-bouncie-authorization") ?? request.headers.get("x-telematics-secret");
  const alt = request.headers.get("x-bouncie-authorization") ?? request.headers.get("x-telematics-secret");
  if (!sameSecret(given, expected) && !sameSecret(alt, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const db = createAdminClient();
  if (!db) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });

  try {
    const readings = adapterFor(provider).parse(body);
    const result = await ingestReadings(db, provider, readings);

    // Tell staff about new problems. Never blocks or fails the webhook.
    await Promise.allSettled(
      result.newAlerts.map((a) =>
        fireN8nWebhook(N8N_WEBHOOK_PATHS.telematicsAlert, {
          alert_type: a.alertType,
          severity: a.severity,
          occurred_at: a.occurredAt,
          vehicle: a.vehicleName,
          plate: a.plate,
        })
      )
    );

    return NextResponse.json({
      success: true,
      received: result.received,
      stored: result.stored,
      unknown_devices: result.unknownDevices.length,
    });
  } catch (error) {
    console.error("[telematics] ingest failed:", error);
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }
}
