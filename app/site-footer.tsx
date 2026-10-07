import { PHONE_DISPLAY, PHONE_TEL, PHONE_IS_LIVE, SUPPORT_EMAIL } from "@/lib/site-config";
import { SERVICE_AREA_CITIES } from "@/lib/service-areas";

// Shared footer for the public pages: contact, service areas, legal links, copyright.
export default function SiteFooter({ brandName = "Zivo", showTagline = true }: { brandName?: string; showTagline?: boolean }) {
  const year = new Date().getFullYear();
  return (
    <footer className="footer">
      <div className="container">
        {showTagline && (
          <p style={{ margin: "0 0 8px" }}>
            {brandName} — Get a car. Get to work. Get moving. A car that works as hard as you do.
          </p>
        )}
        <p style={{ margin: "0 0 8px" }}>
          Car rentals for rideshare &amp; delivery drivers in{" "}
          {SERVICE_AREA_CITIES.map((c, i) => (
            <span key={c.slug}>
              {i > 0 ? " and " : ""}
              <a href={`/${c.slug}`}>{c.displayName}</a>
            </span>
          ))}
          , Tennessee.
        </p>
        <p style={{ margin: "0 0 8px" }}>
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          {PHONE_IS_LIVE && (
            <>
              {" · "}
              <a href={`tel:${PHONE_TEL}`}>{PHONE_DISPLAY}</a>
            </>
          )}
        </p>
        <p style={{ margin: "0 0 8px" }}>
          Already started? <a href="/apply">Continue your application</a>
        </p>
        <p style={{ margin: "0 0 8px" }}>
          <a href="/terms">Terms</a> · <a href="/privacy">Privacy Policy</a>
        </p>
        <p style={{ margin: 0 }}>© {year} Zivo Mobility LLC. All rights reserved.</p>
      </div>
    </footer>
  );
}
