import { createPublicClient } from "@/lib/supabase/public";
import LeadForm from "./lead-form";
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
} from "lucide-react";

export const dynamic = "force-dynamic"; // always fetch fresh categories/platforms/tenant name

export default async function Home() {
  const supabase = createPublicClient();

  const [{ data: tenant }, { data: categories }, { data: platforms }] = await Promise.all([
    supabase.from("tenant").select("name").eq("status", "active").limit(1).maybeSingle(),
    supabase.from("vehicle_category").select("id, name, description").eq("active", true),
    supabase.from("gig_platform").select("id, code, name").order("sort_order"),
  ]);

  const brandName = tenant?.name ?? "Fleet Rental";
  const primaryCategory = categories?.[0];

  return (
    <>
      {/* NAV */}
      <div className="hero">
        <img src="/images/hero-road-sunset.jpg" alt="" className="hero-bg-image" />
        <div className="container">
          <nav className="nav-bar">
            <span className="nav-logo" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Car size={20} color="var(--teal)" />
              {brandName}
            </span>
            <a href="#apply" className="button-secondary" style={{ padding: "10px 18px", fontSize: 14 }}>
              Start My Application
            </a>
          </nav>

          <div className="hero-content">
            <div className="eyebrow">Greater Nashville's Work-Ready Vehicle Rentals</div>
            <h1>Get a car. Get to work. Get moving.</h1>
            <p className="hero-sub">
              Reliable, fuel-efficient vehicles for drivers who need a dependable way to work
              and earn. Drive rideshare, deliver food and packages, run Amazon Flex routes,
              provide medical courier services, and more — with a vehicle built to keep you
              moving.
            </p>
            <div className="cta-row">
              <a href="#apply" className="button-primary">
                Find My Car
              </a>
              <a href="#apply" className="button-secondary">
                Start My Application
              </a>
            </div>
            <div className="benefit-strip">
              <span>Unlimited mileage</span>
              <span>•</span>
              <span>No credit check</span>
              <span>•</span>
              <span>Fuel-efficient vehicles</span>
              <span>•</span>
              <span>Fast process</span>
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
              <h3>Insurance Included</h3>
              <p>Company liability coverage is included with every rental.</p>
            </div>
          </div>
        </div>
      </section>

      {/* PLATFORMS */}
      <section className="section section-dark">
        <div className="container">
          <h2 className="section-title">One car. More ways to work.</h2>
          <p className="section-lede">
            Our vehicles are intended for drivers working across major rideshare, delivery,
            courier, and independent-driving platforms, subject to applicable platform,
            vehicle, driver, insurance, and local requirements.
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
      <section className="section">
        <div className="container">
          <h2 className="section-title">Find the vehicle that fits your work.</h2>
          <p className="section-lede">
            Choose the vehicle category that fits your needs. We&apos;ll match you with an
            available vehicle in that category. You don&apos;t need to choose a specific VIN.
          </p>
          <div className="card vehicle-card">
            <img src="/images/vehicle-economy-sedan.jpg" alt="Economy sedan" />
            <div className="vehicle-card-body">
              <h3 style={{ fontSize: 22, marginBottom: 8 }}>
                {primaryCategory?.name ?? "Economy Sedan"}
              </h3>
              <p className="muted-text" style={{ marginBottom: 16 }}>
                {primaryCategory?.description ??
                  "4-door sedan. Automatic transmission. Great for rideshare & gig work."}
              </p>
              <ul style={{ margin: "0 0 20px", paddingLeft: 18, color: "var(--text-secondary)", fontSize: 14 }}>
                <li>Unlimited mileage included</li>
                <li>Fuel-efficient, practical choice for high-mileage driving</li>
              </ul>
              <a href="#apply" className="button-primary" style={{ alignSelf: "flex-start" }}>
                Check Availability
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="section section-dark">
        <div className="container">
          <h2 className="section-title">Simple rental options for working drivers.</h2>
          <div className="price-grid">
            <div className="card price-card" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)" }}>
              <div style={{ color: "var(--teal)", fontWeight: 700, fontSize: 13 }}>DAILY</div>
              <div className="price">$220</div>
              <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 14, margin: 0 }}>
                for your first 3 days, then $74/day after. 1-week minimum rental applies.
              </p>
            </div>
            <div className="card price-card" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)" }}>
              <div style={{ color: "var(--teal)", fontWeight: 700, fontSize: 13 }}>WEEKLY</div>
              <div className="price">Ask us</div>
              <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 14, margin: 0 }}>
                For drivers who need a vehicle for ongoing work. Pricing shown during rental
                selection, may vary by category.
              </p>
            </div>
          </div>
          <p style={{ marginTop: 24, color: "rgba(255,255,255,0.6)", fontSize: 14 }}>
            Unlimited mileage included on every rental. We currently offer daily and weekly
            rental options — we do not offer a monthly rental plan.
          </p>
        </div>
      </section>

      {/* FAST PROCESS */}
      <section className="section">
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
        </div>
      </section>

      {/* LEAD FORM */}
      <section className="section section-dark" id="apply">
        <div className="container" style={{ maxWidth: 640 }}>
          <h2 className="section-title">Let&apos;s find the right vehicle for your work.</h2>
          <p className="section-lede">
            No document uploads here — just the basics. We&apos;ll follow up with next steps.
          </p>
          <LeadForm categories={categories ?? []} platforms={platforms ?? []} />
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
            {["Nashville", "Murfreesboro", "Franklin", "Hendersonville", "Antioch", "Smyrna", "La Vergne", "Mt. Juliet", "Lebanon"].map(
              (area) => (
                <span
                  key={area}
                  className="platform-pill"
                  style={{ background: "var(--cloud)", border: "1px solid var(--border)", color: "var(--text)" }}
                >
                  {area}
                </span>
              )
            )}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="section" style={{ background: "var(--white)" }}>
        <div className="container" style={{ maxWidth: 720 }}>
          <h2 className="section-title">Frequently asked questions</h2>
          <div style={{ marginTop: 24 }}>
            <details className="faq-item">
              <summary>Do you offer monthly rentals?</summary>
              <p>No. We currently offer daily and weekly rental options only.</p>
            </details>
            <details className="faq-item">
              <summary>What&apos;s the minimum rental period?</summary>
              <p>The minimum rental period is one week.</p>
            </details>
            <details className="faq-item">
              <summary>How does daily pricing work?</summary>
              <p>
                The daily option is $220 for the first 3 days, followed by $74/day after the
                first 3 days. A one-week minimum rental applies.
              </p>
            </details>
            <details className="faq-item">
              <summary>Is mileage limited?</summary>
              <p>Unlimited mileage is included.</p>
            </details>
            <details className="faq-item">
              <summary>Do you run a credit check?</summary>
              <p>
                We don&apos;t use a traditional credit check as part of our rental process.
                Other eligibility, identity, driving, insurance, payment, and screening
                requirements may apply.
              </p>
            </details>
            <details className="faq-item">
              <summary>Do I pick the exact car?</summary>
              <p>You select a vehicle category. We assign an available vehicle within that category.</p>
            </details>
            <details className="faq-item">
              <summary>Can I finish my application later?</summary>
              <p>
                Yes. Your application can be saved and continued online. Email and SMS
                reminders can provide a secure link back to your application.
              </p>
            </details>
            <details className="faq-item">
              <summary>How do I get support during my rental?</summary>
              <p>Customer support is initiated through the customer portal.</p>
            </details>
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
            <a href="#apply" className="button-primary">
              Find My Car
            </a>
            <a href="#apply" className="button-secondary">
              Start My Application
            </a>
          </div>
          <p className="muted-text" style={{ color: "rgba(255,255,255,0.6)", marginTop: 20, fontSize: 14 }}>
            Daily and weekly rentals • 1-week minimum • Unlimited mileage
          </p>
        </div>
      </section>

      <footer className="footer">
        <div className="container">
          <p style={{ margin: 0 }}>
            {brandName} — Get a car. Get to work. Get moving. A car that works as hard as you
            do.
          </p>
        </div>
      </footer>
    </>
  );
}
