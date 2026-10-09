#!/usr/bin/env node
/**
 * Extracts a 2-colour palette from each poster in index/pictures/posters/
 * and emits a JSON manifest at index/pictures/posters/palettes.json.
 *
 * Strategy:
 *   - sharp decodes WebP/JPG/PNG to raw RGBA (node-vibrant's underlying Jimp
 *     doesn't speak WebP, so we transcode to PNG buffer first).
 *   - node-vibrant builds a palette of 6 swatches (Vibrant, Muted, Dark*,
 *     Light*) ranked by population.
 *   - We pick:
 *       primary   = highest-population non-light swatch (visual identity)
 *       secondary = a darker companion suitable for type contrast
 *
 * Output format:
 *   {
 *     "BarrattsPoster-4.10.24.webp": {
 *       "primary":   "#c43234",
 *       "secondary": "#3a1f1f",
 *       "textOnPrimary":   "#fff",
 *       "textOnSecondary": "#fff"
 *     },
 *     ...
 *   }
 *
 * Run locally:  node scripts/extract-poster-palettes.mjs
 * In CI:        .github/workflows/poster-palettes.yml
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { Vibrant } from "node-vibrant/node";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const POSTER_DIR = resolve(ROOT, "index/pictures/posters");
const OUT = resolve(POSTER_DIR, "palettes.json");

const SWATCH_ORDER = [
  "Vibrant",
  "DarkVibrant",
  "Muted",
  "DarkMuted",
  "LightVibrant",
  "LightMuted",
];

/** Decide white or black text for a given background colour. */
function bestTextOn(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // WCAG-ish luminance
  const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return L > 0.55 ? "#111" : "#fff";
}

/** Hex string from a swatch (rounded RGB). */
function hexFromSwatch(swatch) {
  if (!swatch) return null;
  return swatch.hex;
}

function luminance(swatch) {
  const [r, g, b] = swatch.rgb;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
function lumRgb(rgb) {
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
}

/* RGB (0-255) → HSL (h: 0-360, s: 0-1, l: 0-1). Standard formula. */
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = ((b - r) / d + 2); break;
      case b: h = ((r - g) / d + 4); break;
    }
    h *= 60;
  }
  return { h, s, l };
}

/* Primary will host white-ish text. For AA contrast (4.5+) against pure
   white (L=1.0), primary's luminance must be ≤ ~0.18. We over-tighten to
   0.16 so even body text reads. Light/mid colours get darkened to fit. */
const READABLE_AS_BG = 0.16;
const READABLE_AS_FG = 0.70;

function toHex(r, g, b) {
  return (
    "#" +
    [r, g, b]
      .map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0"))
      .join("")
  );
}

/* Darken an RGB triplet preserving hue. */
function darken(rgb, factor = 0.7, steps = 20, target = READABLE_AS_BG) {
  let [r, g, b] = rgb;
  for (let i = 0; i < steps; i++) {
    if (lumRgb([r, g, b]) <= target) break;
    r *= factor; g *= factor; b *= factor;
  }
  return toHex(r, g, b);
}

/* Lighten an RGB triplet (preserve hue) until it has enough WCAG contrast
   against `primaryLum` for type to read against the primary background. */
function lighten(rgb, primaryLum, targetContrast = 4.5) {
  let [r, g, b] = rgb;
  for (let i = 0; i < 40; i++) {
    const L = lumRgb([r, g, b]);
    if (contrast(L, primaryLum) >= targetContrast) break;
    r += (255 - r) * 0.18;
    g += (255 - g) * 0.18;
    b += (255 - b) * 0.18;
  }
  return toHex(r, g, b);
}

/* WCAG-ish contrast ratio between two luminance values. */
function contrast(L1, L2) {
  const a = Math.max(L1, L2);
  const b = Math.min(L1, L2);
  return (a + 0.05) / (b + 0.05);
}

function pickPair(palette) {
  const ranked = SWATCH_ORDER
    .map((k) => [k, palette[k]])
    .filter(([, s]) => s)
    .sort((a, b) => (b[1].population || 0) - (a[1].population || 0));

  /* PRIMARY = the poster's actual brand-identity colour, RAW.
     Score = population × saturation² × darkness-bonus. The darkness
     bonus heavily penalises near-white swatches (paper, cream, etc),
     since those can't host text and aren't what humans call "the
     poster's primary colour". This picks oxblood over cream for the
     Barratts poster, magenta over white for Damn Teeth, etc. */
  const scored = SWATCH_ORDER
    .map((k) => [k, palette[k]])
    .filter(([, s]) => s)
    .map(([k, s]) => {
      const L = luminance(s);
      const { s: sat } = rgbToHsl(s.rgb);
      // Darkness bonus: 1.0 below L=0.4, drops sharply for lighter colours.
      const darkBonus = L < 0.4 ? 1 : Math.max(0.05, 1 - (L - 0.4) * 1.6);
      const score = (s.population || 0) * (sat * sat) * darkBonus;
      return { key: k, swatch: s, score, sat, L };
    })
    .sort((a, b) => b.score - a.score);

  let primarySwatch = scored[0]?.swatch || ranked[0][1];
  const primary = primarySwatch.hex;
  const primaryL = luminance(primarySwatch);

  /* SECONDARY = the poster's natural light/cream/highlight colour, RAW.
     Prefer LightMuted → LightVibrant. These tend to be cream/paper or
     poster-highlight colours. If primary is already light, we accept lower
     contrast — the user requested the literal poster pair. */
  let secondarySwatch = null;
  for (const k of ['LightMuted', 'LightVibrant', 'Muted', 'Vibrant']) {
    const s = palette[k];
    if (s && s !== primarySwatch) { secondarySwatch = s; break; }
  }
  if (!secondarySwatch) {
    secondarySwatch = ranked.find(([, s]) => s !== primarySwatch)?.[1] || primarySwatch;
  }
  const secondary = secondarySwatch.hex;

  /* TEXT = the raw secondary, per the brief: "primary as background,
     secondary as text". May have lower contrast than WCAG AA on some
     posters — accepted trade-off for literal poster fidelity. */
  const text = secondary;

  return { primary, secondary, text };
}

/* =============================================================
   FONT VIBE HEURISTIC
   Picks a Google Font display face based on the primary's HSL.
   Set:
     - Bowlby One        — chunky, loud (high-sat punk/pop)
     - Anton             — heavy condensed (industrial, low-sat dark)
     - Abril Fatface     — bold display serif (warm + saturated)
     - Special Elite     — typewriter (muted greys/blacks, DIY zine vibe)
     - Cormorant Garamond — refined serif (cool, sophisticated)
     - Bebas Neue        — clean condensed sans (modern, mid-sat)
   Returns: { family, css }   where `family` is the Google Fonts family
   name and `css` is the CSS font-family stack with fallbacks.
   ============================================================= */
function pickFont(primaryRgb) {
  const { h, s, l } = rgbToHsl(primaryRgb);

  // Warm hues: red/orange/yellow (h 0-60 or 300-360)
  // Cool hues: green/blue (h 60-300)
  const warm = h <= 60 || h >= 300;

  let family;
  if (s >= 0.65 && l >= 0.25) {
    // High saturation, mid-bright → loud, punk-pop
    family = 'Bowlby One';
  } else if (s >= 0.5 && warm) {
    // Saturated + warm → bold display serif
    family = 'Abril Fatface';
  } else if (s >= 0.5 && !warm) {
    // Saturated + cool → industrial condensed
    family = 'Anton';
  } else if (s < 0.2 && l < 0.35) {
    // Desaturated dark grey/black → typewriter
    family = 'Special Elite';
  } else if (s < 0.35) {
    // Muted → modern condensed
    family = 'Bebas Neue';
  } else {
    // Default refined serif
    family = 'Cormorant Garamond';
  }

  return {
    family,
    css: `'${family}', 'Cormorant Garamond', Georgia, serif`,
  };
}

async function paletteFor(file) {
  const buf = await readFile(file);
  // Convert WebP/anything to PNG so Jimp accepts it.
  const png = await sharp(buf).png().toBuffer();
  const palette = await Vibrant.from(png).quality(3).getPalette();
  const { primary, secondary, text } = pickPair(palette);

  // Vibe-based display font, derived from the primary's HSL.
  const primaryRgb = [
    parseInt(primary.slice(1, 3), 16),
    parseInt(primary.slice(3, 5), 16),
    parseInt(primary.slice(5, 7), 16),
  ];
  const font = pickFont(primaryRgb);

  return {
    primary,
    secondary,
    text,
    font: font.family,
    fontCss: font.css,
    textOnPrimary: bestTextOn(primary),
    textOnSecondary: bestTextOn(secondary),
  };
}

async function main() {
  const files = (await readdir(POSTER_DIR))
    .filter((f) => /\.(webp|jpe?g|png)$/i.test(f))
    .sort();

  const out = {};
  for (const f of files) {
    try {
      out[f] = await paletteFor(join(POSTER_DIR, f));
      console.log(
        `  ${f.padEnd(40)} bg=${out[f].primary} fg=${out[f].secondary} text=${out[f].text} font=${out[f].font}`
      );
    } catch (err) {
      console.error(`  ${f}: FAILED — ${err.message}`);
    }
  }

  await writeFile(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`\nWrote ${Object.keys(out).length} palettes to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
