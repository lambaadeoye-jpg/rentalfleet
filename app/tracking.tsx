import Script from "next/script";

// Installs the Meta Pixel and Google tag only when their IDs are set. IDs are public by design.
const ID_OK = /^[A-Za-z0-9-]{5,40}$/;

export default function Tracking() {
  const meta = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  const google = process.env.NEXT_PUBLIC_GOOGLE_TAG_ID;
  const metaId = meta && ID_OK.test(meta) ? meta : null;
  const googleId = google && ID_OK.test(google) ? google : null;
  if (!metaId && !googleId) return null;
  return (
    <>
      {metaId && (
        <Script id="meta-pixel" strategy="afterInteractive">{`
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${metaId}');fbq('track','PageView');`}</Script>
      )}
      {googleId && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${googleId}`} strategy="afterInteractive" />
          <Script id="google-tag" strategy="afterInteractive">{`
window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}window.gtag=gtag;gtag('js',new Date());gtag('config','${googleId}');`}</Script>
        </>
      )}
    </>
  );
}
