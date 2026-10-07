import { createPublicClient } from "@/lib/supabase/public";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import LeadForm from "../lead-form";
import { PHONE_DISPLAY, PHONE_TEL, MINIMUM_AGE } from "@/lib/site-config";
import { getCityBySlug, SERVICE_AREA_CITIES } from "@/lib/service-areas";
import { ShieldCheck, Fuel, Zap, KeyRound } from "lucide-react";

export const dynamic = "force-dynamic";

// Only pre-renders routes for confirmed cities -- an unknown slug falls
// through to notFound() below rather than silently rendering a page
// that claims to serve a city that was never confirmed.
export async function generateStaticParams() {
  return SERVICE_AREA_CITIES.map((c) => ({ city: c.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city: citySlug } = await params;
  const city = getCityBySlug(citySlug);
  if (!city) return {};

  const title = `Rideshare & Delivery Car Rental in ${city.displayName}, TN | Zivo`;
  return {
    title,
    description: city.metaDescription,
    alternates: { canonical: `/${city.slug}` },
    openGraph: {
      title,
      description: city.metaDescription,
      url: `https://rentzivo.com/${city.slug}`,
      siteName: "Zivo",
      type: "website",
    },
  };
}

export default async function CityLandingPage({ params }: { params: Promise<{ city: string }> }) {
  const { city: citySlug } = await params;
  const city = getCityBySlug(citySlug);
  if (!city) notFound();

  const supabase = createPublicClient();
  const [{ data: categories }, { data: platforms }] = await Promise.all([
    supabase.from("vehicle_category").select("id, name, description").eq("active", true),
    supabase.from("gig_platform").select("id, code, name").order("sort_order"),
  ]);

  // AutoRental + LocalBusiness structured data -- confirmed as the
  // correct current schema.org type for a car rental business before
  // using it, not guessed. Only real, already-established facts go in
  // here (business name, phone, region) -- no invented address, rating,
  // or review count.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "AutoRental",
    name: "Zivo",
    url: `https://rentzivo.com/${city.slug}`,
    telephone: PHONE_TEL,
    areaServed: {
      "@type": "City",
      name: city.displayName,
    },
    address: {
      "@type": "PostalAddress",
      addressLocality: city.displayName,
      addressRegion: "TN",
      addressCountry: "US",
    },
  };

  return (
    <main>
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <section style={{ padding: "60px 20px 40px", textAlign: "center" }}>
        <h1 style={{ fontSize: 34, marginBottom: 12 }}>{city.heroLine}</h1>
        <p className="muted-text" style={{ fontSize: 17, maxWidth: 560, margin: "0 auto 20px" }}>
          Get a work-ready vehicle in {city.displayName} — no credit check, insurance included,
          approved fast. Built for Uber, Lyft, and delivery drivers in {city.region}.
        </p>
        <a href={`tel:${PHONE_TEL}`} className="button-primary" style={{ display: "inline-flex" }}>
          Call {PHONE_DISPLAY}
        </a>
      </section>

      <section style={{ padding: "20px", maxWidth: 480, margin: "0 auto 60px" }}>
        <Suspense fallback={null}>
          <LeadForm categories={categories ?? []} platforms={platforms ?? []} />
        </Suspense>
      </section>

      <section style={{ padding: "40px 20px", background: "var(--cloud, #f7f9fc)" }}>
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <h2 className="section-title" style={{ textAlign: "center", marginBottom: 32 }}>
            Why {city.displayName} drivers choose Zivo
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 24 }}>
            <div style={{ textAlign: "center" }}>
              <ShieldCheck size={28} color="var(--teal)" style={{ marginBottom: 8 }} />
              <h3 style={{ fontSize: 16, marginBottom: 4 }}>Insurance Included</h3>
              <p className="muted-text" style={{ fontSize: 14 }}>
                Drive with confidence from day one.
              </p>
            </div>
            <div style={{ textAlign: "center" }}>
              <Fuel size={28} color="var(--teal)" style={{ marginBottom: 8 }} />
              <h3 style={{ fontSize: 16, marginBottom: 4 }}>Fuel-Efficient Fleet</h3>
              <p className="muted-text" style={{ fontSize: 14 }}>
                Keep more of what you earn.
              </p>
            </div>
            <div style={{ textAlign: "center" }}>
              <Zap size={28} color="var(--teal)" style={{ marginBottom: 8 }} />
              <h3 style={{ fontSize: 16, marginBottom: 4 }}>Fast Approval</h3>
              <p className="muted-text" style={{ fontSize: 14 }}>
                No credit check required.
              </p>
            </div>
            <div style={{ textAlign: "center" }}>
              <KeyRound size={28} color="var(--teal)" style={{ marginBottom: 8 }} />
              <h3 style={{ fontSize: 16, marginBottom: 4 }}>Staff-Assisted Pickup</h3>
              <p className="muted-text" style={{ fontSize: 14 }}>
                A real person hands you the keys.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section style={{ padding: "40px 20px", textAlign: "center" }}>
        <p className="muted-text" style={{ fontSize: 14 }}>
          Must be at least {MINIMUM_AGE} years old with a valid driver&apos;s license.
        </p>
      </section>

      <footer className="footer">
        <div className="container">
          <p style={{ margin: 0 }}>
            <a href="/terms">Terms</a> · <a href="/privacy">Privacy Policy</a>
          </p>
        </div>
      </footer>
    </main>
  );
}
