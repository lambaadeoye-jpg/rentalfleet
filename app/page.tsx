import { createPublicClient } from "@/lib/supabase/public";
import { createClient } from "@supabase/supabase-js";
import MobileCtaBar from "./mobile-cta-bar";
import CtaTracker from "./cta-tracker";
import { Suspense } from "react";
import LeadForm from "./lead-form";
import { PHONE_DISPLAY, PHONE_TEL, PHONE_IS_LIVE, MINIMUM_AGE } from "@/lib/site-config";
import { SERVICE_AREA_CITIES } from "@/lib/service-areas";
import {
  Gauge,
  ShieldCheck,
  Fuel,
  Briefcase,
  Zap,
  LifeBuoy,
  Wrench,
  Layers,
  Car,
  FileText,
  ClipboardCheck,
  BadgeCheck,
  KeyRound,
  Phone,
  IdCard,
  UserCheck,
} from "lucide-react";

export const dynamic = "force-dynamic"; // always fetch fresh categories/platforms/tenant name

// Daily pricing shown on the page, read from the approved pricing policy so the page never drifts from what staff set.
// Returns null (price lines are hidden) if daily pricing is not approved or can't be read.
type DailyPricing = { days: number; total: number; perDay: number };
async function getDailyPricing(): Promise<DailyPricing | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    const db = createClient(url, key);
    const { data } = await db.from("policy_version").select("rules").eq("policy_type", "pricing_and_mileage").eq("immutable", false).maybeSingle();
    const d = (data?.rules as { daily?: { approved?: boolean; first_tier_days?: number; first_tier_total_usd?: number; per_day_after_usd?: number } } | null)?.daily;
    if (!d?.approved || !(d.first_tier_days! > 0) || !(d.first_tier_total_usd! > 0) || !(d.per_day_after_usd! > 0)) return null;
    return { days: d.first_tier_days!, total: d.first_tier_total_usd!, perDay: d.per_day_after_usd! };
  } catch {
    return null;
  }
}

// One repeated call to action, same words everywhere, with the reassurance right under it.
function SectionCta({ name, label = "Find My Car" }: { name: string; label?: string }) {
  return (
    <div className="section-cta">
      <a href="#apply-bottom" className="button-primary" data-cta={name}>{label}</a>
      <p className="section-cta-note">No credit check. Takes about a minute.</p>
    </div>
  );
}

export default async function Home() {
  const supabase = createPublicClient();

  const [{ data: tenant }, { data: categories }, { data: platforms }, pricing] = await Promise.all([
    supabase.from("tenant").select("name").eq("status", "active").limit(1).maybeSingle(),
    supabase.from("vehicle_category").select("id, name, description").eq("active", true),
    supabase.from("gig_platform").select("id, code, name").order("sort_order"),
    getDailyPricing(),
  ]);

  const brandName = tenant?.name ?? "Fleet Rental";

  // FAQ content lives in one list so the visible answers and the FAQPage structured data can never drift apart.
  const faqs: { q: string; a: string; schema?: boolean }[] = [
    { q: "Do you offer monthly rentals?", a: "No. We do not offer a monthly rental plan." },
    { q: "What's the minimum rental period?", a: "The minimum rental period is one week, so every rental is a weekly rental or longer." },
    {
      q: "How does daily pricing work?",
      a:
        (pricing
          ? `The daily option is $${pricing.total} for the first ${pricing.days} days, followed by $${pricing.perDay}/day after the first ${pricing.days} days. `
          : "Daily pricing is shown during rental selection. ") + "A one-week minimum rental applies.",
    },
    {
      q: "Do I need my own insurance?",
      a: "Not if you don't have any. Bring your own coverage if you have it. If you don't, insurance is included with your rental. Either way, you'll be covered before you drive.",
    },
    { q: "Is mileage limited?", a: "Unlimited mileage is included." },
    { q: "What's the minimum age to rent?", a: `You must be at least ${MINIMUM_AGE} years old with a valid driver's license.` },
    {
      q: "Do you run a credit check?",
      a: "We don't use a traditional credit check as part of our rental process. Other eligibility, identity, driving, insurance, payment, and screening requirements may apply.",
    },
    {
      q: "Where do I pick up the car?",
      a: "Pickup is in Nashville and Murfreesboro. We confirm the exact location and time with you once you're approved.",
    },
    { q: "Do I pick the exact car?", a: "You select a vehicle category. We assign an available vehicle within that category." },
    {
      q: "Can I finish my application later?",
      a: "Yes. Your application can be saved and continued online. Email and SMS reminders can provide a secure link back to your application.",
    },
    { q: "How do I get support during my rental?", a: "Customer support is initiated through the customer portal." },
    {
      q: "Can I apply or ask questions by phone instead of online?",
      a: `Yes — call ${PHONE_DISPLAY} and we can walk you through availability, pricing, and the application process directly.`,
      schema: PHONE_IS_LIVE, // don't publish the placeholder number into search results
    },
    {
      q: "Can I use this rental for DoorDash, Uber Eats, or Instacart?",
      a: "Yes. Our vehicles are intended for drivers working across major rideshare, delivery, courier, and independent-driving platforms, subject to applicable platform, vehicle, driver, insurance, and local requirements.",
    },
    {
      q: "Do I need a specific vehicle for Instacart or Amazon Flex?",
      a: "Vehicle requirements vary by platform. You select a category and we assign an available vehicle within it — our team can help confirm what a given platform currently requires as part of your application.",
    },
    {
      q: "Can I drive for more than one platform with the same rental?",
      a: "Yes — our vehicles aren't limited to a single platform. Many drivers run rideshare, delivery, and courier apps on the same vehicle, subject to each platform's own requirements.",
    },
  ];


  return (
    <>
      {/* AutoRental structured data (schema.org) -- tells search engines
          unambiguously "this is a car rental business," independent of how
          the visible copy reads. Deliberately omits a street address: no
          real one has been established yet, and inventing one would be the
          same mistake as guessing the weekly rate or deposit policy. Add
          "address" here once a real pickup location exists. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "AutoRental",
            name: brandName,
            description:
              "Weekly and daily car rentals for rideshare, delivery, courier, and independent-driving work in Nashville, Tennessee.",
            url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://rentzivo.com",
            ...(PHONE_IS_LIVE ? { telephone: PHONE_TEL } : {}),
            areaServed: ["Nashville", "Murfreesboro"].map((name) => ({
              "@type": "City",
              name,
              containedInPlace: { "@type": "State", name: "Tennessee" },
            })),
          }),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: faqs
              .filter((f) => f.schema !== false)
              .map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
          }),
        }}
      />

      <CtaTracker />

      {/* NAV */}
      <div className="hero">
        <img
          src="/images/hero-road-sunset.jpg"
          alt="Sedan on a highway at sunset — a rideshare and delivery-ready vehicle for gig drivers"
          className="hero-bg-image"
          fetchPriority="high"
          decoding="async"
        />
        <div className="container">
          <nav className="nav-bar">
            <span className="nav-logo" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Car size={20} color="var(--teal)" />
              {brandName}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <a href="#fleet" className="nav-jump-link">Fleet</a>
              <a href="#how-it-works" className="nav-jump-link">How It Works</a>
              <a href="#pricing" className="nav-jump-link">Pricing</a>
              <a href="#faq" className="nav-jump-link">FAQ</a>
              {PHONE_IS_LIVE && (
                <a href={`tel:${PHONE_TEL}`} className="nav-phone-link">
                  <Phone size={15} />
                  {PHONE_DISPLAY}
                </a>
              )}
              <a href="#apply" data-cta="nav" className="button-primary nav-cta" style={{ padding: "10px 18px", fontSize: 14 }}>
                Find My Car
              </a>
            </div>
          </nav>

          <div className="hero-content hero-grid">
            <div className="hero-copy">
              <div className="eyebrow">Gig, Rideshare &amp; Delivery Car Rentals in Nashville</div>
              <h1>Car rentals for rideshare &amp; delivery drivers.</h1>
              <p className="hero-sub">
                {pricing
                  ? `$${pricing.total} for your first ${pricing.days} days, then $${pricing.perDay}/day.`
                  : "Reliable, fuel-efficient cars for working drivers."}
              </p>
              <p className="hero-keywords">
                Weekly and daily car rentals for Uber, Lyft, DoorDash, Instacart and Amazon Flex
                drivers in Nashville, TN.
              </p>
              <div className="benefit-strip">
                <span>Unlimited mileage</span>
                <span>•</span>
                <span>No credit check</span>
                <span>•</span>
                <span>Insurance if you need it</span>
              </div>
            </div>
            <div className="hero-form" id="apply">
              <Suspense fallback={null}>
                <LeadForm categories={categories ?? []} platforms={platforms ?? []} ctaDefault="hero_form" />
              </Suspense>
            </div>
          </div>
        </div>
      </div>

      {/* CORE BENEFITS */}
      <section className="section">
        <div className="container">
          <h2 className="section-title">Built for drivers who need a car to earn.</h2>
          <p className="section-lede">
            Reliable, affordable, fuel-efficient vehicles for working drivers throughout
            Greater Nashville.
          </p>
          <div className="grid-3">
            <div className="card benefit-card">
              <Gauge size={24} color="var(--teal)" style={{ marginBottom: 10 }} />
              <h3>Unlimited Mileage</h3>
              <p>
                Drive without watching the odometer. Focus on routes, customers, shifts, and
                deliveries instead of mileage limits.
              </p>
            </div>
            <div className="card benefit-card">
              <ShieldCheck size={24} color="var(--teal)" style={{ marginBottom: 10 }} />
              <h3>No Credit Check</h3>
              <p>
                We don&apos;t use a traditional credit check as part of our rental process.
                Other eligibility, identity, driving, insurance, payment, and screening
                requirements may apply.
              </p>
            </div>
            <div className="card benefit-card">
              <Fuel size={24} color="var(--teal)" style={{ marginBottom: 10 }} />
              <h3>Fuel Efficiency</h3>
              <p>Choose economical vehicles designed to help keep fuel costs under control.</p>
            </div>
            <div className="card benefit-card">
              <Briefcase size={24} color="var(--teal)" style={{ marginBottom: 10 }} />
              <h3>Work-Ready Vehicles</h3>
              <p>
                Vehicles are selected with the needs of rideshare, delivery, courier, and
                independent drivers in mind.
              </p>
            </div>
            <div className="card benefit-card">
              <Zap size={24} color="var(--teal)" style={{ marginBottom: 10 }} />
              <h3>Fast Process</h3>
              <p>Complete the required steps, get approved, make your rental payment, and get on the road.</p>
            </div>
            <div className="card benefit-card">
              <LifeBuoy size={24} color="var(--teal)" style={{ marginBottom: 10 }} />
              <h3>24/7 Roadside Assistance</h3>
              <p>Help is available around the clock if something goes wrong on the road.</p>
            </div>
            <div className="card benefit-card">
              <Wrench size={24} color="var(--teal)" style={{ marginBottom: 10 }} />
              <h3>Regular Maintenance Covered</h3>
              <p>Routine maintenance is handled for you, so your vehicle stays road-ready.</p>
            </div>
            <div className="card benefit-card">
              <Layers size={24} color="var(--teal)" style={{ marginBottom: 10 }} />
              <h3>Multi-Platform Ready</h3>
              <p>
                Built for drivers working across major rideshare, delivery, courier, and
                independent-driving platforms, subject to applicable requirements.
              </p>
            </div>
            <div className="card benefit-card">
              <ShieldCheck size={24} color="var(--teal)" style={{ marginBottom: 10 }} />
              <h3>Insurance, Sorted Simply</h3>
              <p>
                Already have coverage? Bring it. Don&apos;t have any? Insurance is included with
                your rental. Either way, you&apos;ll be covered before you drive.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* PLATFORMS */}
      <section className="section section-dark">
        <div className="container">
          <h2 className="section-title">Built for Gig, Rideshare &amp; Delivery Drivers</h2>
          <p className="section-lede">
            One car. More ways to work. Our vehicles are intended for drivers working across
            major rideshare, delivery, courier, and independent-driving platforms, subject to
            applicable platform, vehicle, driver, insurance, and local requirements.
          </p>
          <div className="platform-pill-row">
            {(platforms ?? []).map((p) => (
              <span key={p.id} className="platform-pill">
                {p.name}
              </span>
            ))}
          </div>
          <p className="muted-text" style={{ color: "rgba(255,255,255,0.5)", marginTop: 24, fontSize: 13 }}>
            Platform and vehicle requirements can change. Eligibility depends on the
            applicable platform, driver, vehicle, insurance, and local requirements.
          </p>
        </div>
      </section>

      {/* VEHICLE / FUEL EFFICIENCY */}
      <section className="section" id="fleet">
        <div className="container">
          <h2 className="section-title">Find the vehicle that fits your work.</h2>
          <p className="section-lede">
            Choose the vehicle category that fits your needs. We&apos;ll match you with an
            available vehicle in that category. You don&apos;t need to choose a specific VIN.
          </p>
          {/* Shows every active category, not just the first -- previously
              only categories[0] ever rendered here, which worked by
              accident while there was only one category and would have
              silently hidden any others added later. */}
          {(categories && categories.length > 0
            ? categories
            : [{ id: "fallback", name: "Economy Sedan", description: "4-door sedan. Automatic transmission. Great for rideshare & gig work." }]
          ).map((category) => (
            <div className="card vehicle-card" key={category.id} style={{ marginBottom: 20 }}>
              {/* Same photo for every category for now -- vehicle_category has
                  no per-category image column yet, so all cards share the one
                  real fleet photo until that's added. */}
              <img src="/images/vehicle-economy-sedan.jpg" alt={category.name} />
              <div className="vehicle-card-body">
                <h3 style={{ fontSize: 22, marginBottom: 8 }}>{category.name}</h3>
                <p className="muted-text" style={{ marginBottom: 16 }}>
                  {category.description ?? "Reliable, well-maintained, and ready for gig work."}
                </p>
                <ul style={{ margin: "0 0 20px", paddingLeft: 18, color: "var(--text-secondary)", fontSize: 14 }}>
                  <li>Unlimited mileage included</li>
                  <li>Fuel-efficient, practical choice for high-mileage driving</li>
                </ul>
                <a href="#apply-bottom" data-cta="fleet_card" className="button-primary" style={{ alignSelf: "flex-start" }}>
                  Find My Car
                </a>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section className="section section-dark" id="pricing">
        <div className="container">
          <h2 className="section-title">Simple pricing for working drivers.</h2>
          <div className="price-grid">
            <div className="card price-card" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)" }}>
              <div style={{ color: "var(--teal)", fontWeight: 700, fontSize: 13 }}>DAILY</div>
              {pricing ? (
                <>
                  <div className="price">${pricing.total}</div>
                  <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 14, margin: 0 }}>
                    for your first {pricing.days} days, then ${pricing.perDay}/day after. 1-week minimum rental applies.
                  </p>
                </>
              ) : (
                <>
                  <div className="price">Daily rates</div>
                  <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 14, margin: 0 }}>
                    Pricing is shown during rental selection. 1-week minimum rental applies.
                  </p>
                </>
              )}
            </div>
          </div>
          <p style={{ marginTop: 24, color: "rgba(255,255,255,0.6)", fontSize: 14 }}>
            Unlimited mileage included on every rental. Rentals start at one week, then continue day by day.
            Insurance is included if you don&apos;t have your own. We do not offer a monthly rental plan.
          </p>
          <SectionCta name="after_pricing" label="Check Availability" />
        </div>
      </section>

      {/* FAST PROCESS */}
      <section className="section" id="how-it-works">
        <div className="container">
          <h2 className="section-title">From application to road — without unnecessary delays.</h2>
          <div className="steps-row" style={{ marginTop: 32 }}>
            <div>
              <FileText size={20} color="var(--teal)" style={{ marginBottom: 6 }} />
              <div className="step-number">01</div>
              <h3 style={{ fontSize: 16, margin: "8px 0" }}>Apply</h3>
              <p className="muted-text" style={{ fontSize: 14 }}>
                Tell us what you&apos;re driving for and what type of vehicle you need.
              </p>
            </div>
            <div>
              <ClipboardCheck size={20} color="var(--teal)" style={{ marginBottom: 6 }} />
              <div className="step-number">02</div>
              <h3 style={{ fontSize: 16, margin: "8px 0" }}>Complete Requirements</h3>
              <p className="muted-text" style={{ fontSize: 14 }}>
                Provide required information and documentation.
              </p>
            </div>
            <div>
              <BadgeCheck size={20} color="var(--teal)" style={{ marginBottom: 6 }} />
              <div className="step-number">03</div>
              <h3 style={{ fontSize: 16, margin: "8px 0" }}>Get Approved</h3>
              <p className="muted-text" style={{ fontSize: 14 }}>
                Complete verification and screening.
              </p>
            </div>
            <div>
              <KeyRound size={20} color="var(--teal)" style={{ marginBottom: 6 }} />
              <div className="step-number">04</div>
              <h3 style={{ fontSize: 16, margin: "8px 0" }}>Pay &amp; Pick Up</h3>
              <p className="muted-text" style={{ fontSize: 14 }}>
                Make your rental payment, complete the staff-assisted pickup, and get on the road.
              </p>
            </div>
          </div>
          <p className="muted-text" style={{ marginTop: 24, fontSize: 14 }}>
            Many customers can move through the process in less than 24 hours when required
            information, documentation, and approvals are completed promptly.
          </p>
          <SectionCta name="after_process" />
        </div>
      </section>

      {/* WHAT YOU NEED */}
      <section className="section" style={{ background: "var(--white)" }}>
        <div className="container">
          <h2 className="section-title">What you need to get started.</h2>
          <p className="section-lede">
            A few simple requirements — nothing more than that.
          </p>
          <div className="grid-3">
            <div className="card benefit-card">
              <UserCheck size={24} color="var(--teal)" style={{ marginBottom: 10 }} />
              <h3>{MINIMUM_AGE}+ Years Old</h3>
              <p>Minimum age requirement for all rentals.</p>
            </div>
            <div className="card benefit-card">
              <IdCard size={24} color="var(--teal)" style={{ marginBottom: 10 }} />
              <h3>Valid Driver&apos;s License</h3>
              <p>A current, non-expired license with valid ID.</p>
            </div>
            <div className="card benefit-card">
              <ShieldCheck size={24} color="var(--teal)" style={{ marginBottom: 10 }} />
              <h3>Insurance Coverage</h3>
              <p>Bring your own. If you don&apos;t have any, insurance is included with your rental.</p>
            </div>
            <div className="card benefit-card">
              <BadgeCheck size={24} color="var(--teal)" style={{ marginBottom: 10 }} />
              <h3>No Credit Check</h3>
              <p>
                We don&apos;t use a traditional credit check as part of our rental process.
                Other eligibility requirements may apply.
              </p>
            </div>
          </div>
          <SectionCta name="after_requirements" label="I Have These. Check Availability." />
        </div>
      </section>

      {/* LEAD FORM */}
      <section className="section section-dark" id="apply-bottom">
        <div className="container" style={{ maxWidth: 640 }}>
          <h2 className="section-title">Let&apos;s find the right vehicle for your work.</h2>
          <p className="section-lede">
            No document uploads here — just the basics. We&apos;ll follow up with next steps.
            {PHONE_IS_LIVE && (
              <>
                {" "}Prefer to talk it through instead?{" "}
                <a href={`tel:${PHONE_TEL}`} style={{ color: "var(--teal)", fontWeight: 700 }}>
                  Call {PHONE_DISPLAY}
                </a>
                .
              </>
            )}
          </p>
          <Suspense fallback={null}>
            <LeadForm categories={categories ?? []} platforms={platforms ?? []} ctaDefault="bottom_form" />
          </Suspense>
        </div>
      </section>

      {/* GREATER NASHVILLE */}
      <section className="section">
        <div className="container">
          <h2 className="section-title">A work-ready vehicle, close to where you work.</h2>
          <p className="section-lede">
            We&apos;re focused on serving drivers throughout Greater Nashville with reliable,
            affordable transportation designed around the realities of working on the road.
          </p>
          <div className="platform-pill-row">
            {[
              "Nashville",
              "Murfreesboro",
              "Franklin",
              "Hendersonville",
              "Antioch",
              "Smyrna",
              "La Vergne",
              "Mt. Juliet",
              "Lebanon",
              "Brentwood",
              "Hermitage",
              "Donelson",
              "Madison",
              "Germantown",
              "East Nashville",
              "The Gulch",
              "Green Hills",
              "Belle Meade",
              "Sylvan Park",
              "12 South",
              "Hillsboro Village",
              "Goodlettsville",
              "Nolensville",
            ].map((area) => {
              const pill = { background: "var(--cloud)", border: "1px solid var(--border)", color: "var(--text)" };
              const city = SERVICE_AREA_CITIES.find((c) => c.displayName === area);
              return city ? (
                <a key={area} href={`/${city.slug}`} className="platform-pill" style={{ ...pill, textDecoration: "none", fontWeight: 600 }}>
                  {area}
                </a>
              ) : (
                <span key={area} className="platform-pill" style={pill}>
                  {area}
                </span>
              );
            })}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="section" id="faq" style={{ background: "var(--white)" }}>
        <div className="container" style={{ maxWidth: 720 }}>
          <h2 className="section-title">Frequently asked questions</h2>
          <div style={{ marginTop: 24 }}>
            {faqs.map((f) => (
              <details className="faq-item" key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="section section-dark">
        <div className="container" style={{ textAlign: "center" }}>
          <h2 className="section-title">Ready to get on the road?</h2>
          <p className="section-lede" style={{ margin: "0 auto 28px" }}>
            Get started with a reliable, fuel-efficient vehicle designed for working drivers
            throughout Greater Nashville.
          </p>
          <div className="cta-row" style={{ justifyContent: "center" }}>
            <a href="#apply-bottom" data-cta="final" className="button-primary">
              Find My Car
            </a>
          </div>
          <p className="muted-text" style={{ color: "rgba(255,255,255,0.6)", marginTop: 20, fontSize: 14 }}>
            No credit check. No commitment to apply. Takes about a minute.
          </p>
        </div>
      </section>

      <footer className="footer">
        <div className="container">
          <p style={{ margin: "0 0 8px" }}>
            {brandName} — Get a car. Get to work. Get moving. A car that works as hard as you
            do.
          </p>
          {PHONE_IS_LIVE && (
            <p style={{ margin: "0 0 8px" }}>
              <a href={`tel:${PHONE_TEL}`} style={{ color: "rgba(255,255,255,0.8)" }}>
                {PHONE_DISPLAY}
              </a>
            </p>
          )}
          <p style={{ margin: "0 0 8px" }}>
            Already started? <a href="/apply">Continue your application</a>
          </p>
          <p style={{ margin: 0 }}>
            <a href="/terms">Terms</a> · <a href="/privacy">Privacy Policy</a>
          </p>
        </div>
      </footer>

      {/* Sticky mobile bar: the main action always, plus Call once a real number is live. */}
      <MobileCtaBar phoneLive={true} phoneDisplay={PHONE_DISPLAY} phoneTel={PHONE_TEL} />
    </>
  );
}
