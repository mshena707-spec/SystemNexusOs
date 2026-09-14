/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  COLOR ENGINE                                                        ║
 * ║                                                                      ║
 * ║  Turns 1-2 colors a business owner picks into a complete, legible,   ║
 * ║  professional palette — hover states, muted fills, readable text     ║
 * ║  colors — using real color science (HSL manipulation + WCAG contrast ║
 * ║  math), not guesswork. No hardcoded brand identity anywhere in this  ║
 * ║  file: every value here is DERIVED from whatever the owner picks.    ║
 * ║                                                                      ║
 * ║  Pure functions, zero dependencies — runs identically server-side    ║
 * ║  (validating/persisting a theme) and client-side (instant live       ║
 * ║  preview while the owner is still turning the color wheel).          ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

export interface RGB { r: number; g: number; b: number; }
export interface HSL { h: number; s: number; l: number; }

// ── Conversions ─────────────────────────────────────────────────────────

export function hexToRgb(hex: string): RGB {
  const clean = hex.replace('#', '').trim();
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  const num = parseInt(full, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return '#' + [r, g, b].map(v => clamp(v).toString(16).padStart(2, '0')).join('');
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)); break;
    case gn: h = ((bn - rn) / d + 2); break;
    default: h = ((rn - gn) / d + 4);
  }
  return { h: h * 60, s: s * 100, l: l * 100 };
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  const sn = s / 100, ln = l / 100;
  if (sn === 0) { const v = ln * 255; return { r: v, g: v, b: v }; }
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;
  const hn = h / 360;
  return {
    r: hue2rgb(p, q, hn + 1 / 3) * 255,
    g: hue2rgb(p, q, hn) * 255,
    b: hue2rgb(p, q, hn - 1 / 3) * 255,
  };
}

export function hexToHsl(hex: string): HSL { return rgbToHsl(hexToRgb(hex)); }
export function hslToHex(hsl: HSL): string { return rgbToHex(hslToRgb(hsl)); }

const clampNum = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

// ── WCAG contrast ───────────────────────────────────────────────────────

function relativeLuminance({ r, g, b }: RGB): number {
  const lin = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colors, 1 (no contrast) to 21 (max, black/white). */
export function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexToRgb(hexA));
  const lB = relativeLuminance(hexToRgb(hexB));
  const lighter = Math.max(lA, lB), darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Picks whichever of near-black / near-white is more readable on top of `bgHex`, per WCAG. */
export function readableTextOn(bgHex: string, darkHex = '#141110', lightHex = '#FBFAF8'): string {
  const darkContrast = contrastRatio(bgHex, darkHex);
  const lightContrast = contrastRatio(bgHex, lightHex);
  return darkContrast >= lightContrast ? darkHex : lightHex;
}

// ── Palette derivation ──────────────────────────────────────────────────

export interface BrandInput {
  primary: string;    // hex, required — the owner's main brand color
  secondary?: string; // hex, optional — falls back to a derived complement of primary
  mode?: 'dark' | 'light'; // which UI mode this palette is for (admin defaults dark, storefront defaults light)
}

export interface DerivedPalette {
  primary: string;
  primaryHover: string;
  primaryActive: string;
  primaryMuted: string;      // low-saturation tint, for subtle fills/badges
  primaryText: string;       // readable text/icon color to place ON TOP of `primary`
  secondary: string;
  secondaryHover: string;
  secondaryText: string;
  // Neutral UI surfaces — kept mostly neutral for legibility, with a very
  // subtle tint of the brand hue so the whole UI feels cohesive rather than
  // like a generic gray template stamped with a logo color.
  surfaceVoid: string;
  surfaceBase: string;
  surfaceRaised: string;
  borderDefault: string;
  borderStrong: string;
  textPrimary: string;
  textMuted: string;
  textFaint: string;
  // Status colors stay in their conventional hue families (universal UX
  // convention — green=success, red=danger — changing these per-brand would
  // make the product harder to use, not more "on-brand"), but are nudged in
  // saturation/lightness to sit comfortably alongside the chosen brand color.
  success: string;
  danger: string;
  warning: string;
  info: string;
}

function deriveSecondary(primaryHsl: HSL): string {
  // A pleasant analogous-to-complementary shift, not a harsh opposite —
  // +40° reads as "a different but related color", avoiding the jarring
  // look of a literal 180° complement for most starting hues.
  return hslToHex({ h: (primaryHsl.h + 40) % 360, s: clampNum(primaryHsl.s * 0.85, 25, 70), l: clampNum(primaryHsl.l, 30, 45) });
}

export function derivePalette(input: BrandInput): DerivedPalette {
  const mode = input.mode ?? 'dark';
  const p = hexToHsl(input.primary);
  const secondaryHex = input.secondary ?? deriveSecondary(p);
  const s = hexToHsl(secondaryHex);

  const primaryHover = hslToHex({ ...p, l: clampNum(p.l + (mode === 'dark' ? 8 : -8), 12, 88) });
  const primaryActive = hslToHex({ ...p, l: clampNum(p.l + (mode === 'dark' ? -6 : -14), 8, 85) });
  const primaryMuted = hslToHex({ h: p.h, s: clampNum(p.s * 0.5, 15, 45), l: mode === 'dark' ? 22 : 92 });

  const secondaryHover = hslToHex({ ...s, l: clampNum(s.l + (mode === 'dark' ? 8 : -8), 12, 88) });

  // Neutrals: near-black/near-white with the faintest wash of the brand hue
  // (low saturation) so surfaces feel like "this brand's dark mode", not a
  // generic template — while staying comfortable for hours of reading.
  const tint = (l: number, sat: number) => hslToHex({ h: p.h, s: sat, l });
  const surfaceVoid    = mode === 'dark' ? tint(8, 18)  : tint(98, 8);
  const surfaceBase    = mode === 'dark' ? tint(11, 15) : tint(100, 4);
  const surfaceRaised  = mode === 'dark' ? tint(15, 14) : tint(96, 6);
  const borderDefault  = mode === 'dark' ? tint(21, 14) : tint(88, 8);
  const borderStrong   = mode === 'dark' ? tint(28, 13) : tint(78, 8);
  const textPrimary    = mode === 'dark' ? tint(95, 8)  : tint(12, 10);
  const textMuted      = mode === 'dark' ? tint(68, 10) : tint(42, 8);
  const textFaint      = mode === 'dark' ? tint(42, 8)  : tint(62, 6);

  return {
    primary: input.primary,
    primaryHover,
    primaryActive,
    primaryMuted,
    primaryText: readableTextOn(input.primary),
    secondary: secondaryHex,
    secondaryHover,
    secondaryText: readableTextOn(secondaryHex),
    surfaceVoid, surfaceBase, surfaceRaised, borderDefault, borderStrong,
    textPrimary, textMuted, textFaint,
    // Status hues nudged toward the brand's saturation level so a very
    // muted brand color doesn't sit next to jarringly neon status chips —
    // start from a conventional baseline, shift 30% toward the brand's
    // saturation, then clamp to a range that never looks washed-out or neon.
    success: hslToHex({ h: 142, s: clampNum(60 + (p.s - 60) * 0.3, 50, 78), l: mode === 'dark' ? 52 : 38 }),
    danger:  hslToHex({ h: 8,   s: clampNum(65 + (p.s - 65) * 0.3, 55, 80), l: mode === 'dark' ? 55 : 45 }),
    warning: hslToHex({ h: 42,  s: clampNum(70 + (p.s - 70) * 0.3, 60, 85), l: mode === 'dark' ? 55 : 45 }),
    info:    hslToHex({ h: 199, s: clampNum(55 + (p.s - 55) * 0.3, 45, 72), l: mode === 'dark' ? 55 : 42 }),
  };
}

/** A handful of ready-made starting points for owners who'd rather pick a vibe than a hex code. */
export const PALETTE_PRESETS: Array<{ name: string; primary: string; secondary?: string }> = [
  { name: 'Saffron & Basil (default)', primary: '#E67E22', secondary: '#2F5233' },
  { name: 'Royal Indigo',              primary: '#4338CA', secondary: '#D97706' },
  { name: 'Emerald Trade',             primary: '#059669', secondary: '#1E293B' },
  { name: 'Rose & Charcoal',           primary: '#E11D48', secondary: '#292524' },
  { name: 'Ocean Teal',                primary: '#0891B2', secondary: '#7C3AED' },
  { name: 'Sunset Coral',              primary: '#F97362', secondary: '#3B2F63' },
  { name: 'Slate & Gold',              primary: '#CA8A04', secondary: '#334155' },
  { name: 'Midnight Violet',           primary: '#7C3AED', secondary: '#F59E0B' },
];
