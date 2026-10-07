import AttributionCapture from "./attribution-capture";
import Tracking from "./tracking";
import type { Metadata } from "next";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "@fontsource/plus-jakarta-sans/800.css";
import "./globals.css";

const SITE_URL = "https://rentzivo.com";
const TITLE = "Gig Driver & Rideshare Car Rentals in Nashville | Zivo";
const DESCRIPTION =
  "Weekly and daily vehicle rentals for rideshare, delivery, courier, and independent driving work throughout Greater Nashville. No credit check, insurance included if you don’t have your own.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s | Zivo" },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: "Zivo",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AttributionCapture />
        <Tracking />
        {children}
      </body>
    </html>
  );
}
