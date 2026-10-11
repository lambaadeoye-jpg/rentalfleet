// The one place the Zivo logo is rendered. Follows the logo usage guide:
//  - primary: full-colour on white / Cloud / light backgrounds
//  - white: for Midnight Navy or other dark backgrounds (never put the primary on dark)
//  - onecolor: navy only, for low-colour or print-like surfaces
//  - symbol: the Z on its own, for small spaces (avatars, tight headers); exempt from the 120px minimum
// Never stretched (width drives a fixed aspect ratio), never recoloured, never given effects.
// The wordmark has a 120px minimum width. These are the concept raster files; swap the PNGs in public/brand
// for the designer's final files when they exist (same filenames, same aspect) and nothing else changes.

export type BrandVariant = "primary" | "white" | "onecolor" | "symbol";

const FILES: Record<BrandVariant, { src: string; w: number; h: number }> = {
  primary: { src: "/brand/logo.png", w: 720, h: 183 },
  white: { src: "/brand/logo-white.png", w: 720, h: 183 },
  onecolor: { src: "/brand/logo-onecolor.png", w: 720, h: 183 },
  symbol: { src: "/brand/symbol.png", w: 256, h: 186 },
};

export const MIN_LOGO_WIDTH = 120;

/** Display size for a variant, enforcing the minimum width for the wordmark. */
export function logoSize(variant: BrandVariant, width: number): { width: number; height: number } {
  const f = FILES[variant];
  const w = variant === "symbol" ? Math.max(1, Math.round(width)) : Math.max(MIN_LOGO_WIDTH, Math.round(width));
  return { width: w, height: Math.round((w * f.h) / f.w) };
}

export function logoSrc(variant: BrandVariant): string {
  return FILES[variant].src;
}

export function BrandLogo({ variant = "primary", width = 148, className, style }: { variant?: BrandVariant; width?: number; className?: string; style?: React.CSSProperties }) {
  const size = logoSize(variant, width);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoSrc(variant)}
      alt="Zivo"
      width={size.width}
      height={size.height}
      className={className}
      style={{ display: "block", width: size.width, height: "auto", maxWidth: "100%", ...style }}
      decoding="async"
    />
  );
}
