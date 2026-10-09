#!/usr/bin/env node
/**
 * Replaces the Google Maps <iframe> on each event detail page with a
 * Mapbox static image, themed per-event (marker pin uses the poster's
 * --poster-primary colour). The image is wrapped in an anchor that opens
 * Apple/Google Maps for navigation.
 *
 * - Lat/lng is parsed out of the existing iframe `src` (!2d = lng, !3d = lat).
 * - Per-event primary colour is loaded from index/pictures/posters/palettes.json,
 *   matched via the same poster-from-hero regex used by inject-poster-palettes.
 * - Style: mapbox/dark-v11 by default. Mapbox public tokens are designed for
 *   client-side embedding; the access token is baked into the generated <img src>.
 *
 * Idempotent — running twice produces the same output. Re-extract event
 * coordinates by re-running this script.
 *
 * Run locally: node scripts/inject-mapbox-maps.mjs
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EVENTS_DIR = resolve(ROOT, "events");
const PALETTE_FILE = resolve(ROOT, "index/pictures/posters/palettes.json");

const MAPBOX_TOKEN =
  process.env.MAPBOX_TOKEN;
if (!MAPBOX_TOKEN) throw new Error("Set MAPBOX_TOKEN env var");
const STYLE = "mapbox/dark-v11";
const ZOOM = 15;
const WIDTH = 1280;
const HEIGHT = 300;

const POSTER_FROM_HERO = /<section class="(?:event-container|event-hero)">[\s\S]*?<img\s[^>]*?src="[^"]*posters\/([^"\/]+)"/i;
// Match the whole .map-container including children (iframe / waves / anything).
const MAP_BLOCK_RE = /<div class="map-container">[\s\S]*?<\/div>\s*(?=<footer)/i;
// Lat/lng inside an existing Google iframe (!2d{lng} !3d{lat}).
const COORDS_RE = /!2d(-?[0-9.]+)[\s\S]*?!3d(-?[0-9.]+)/;
// Optional human-readable venue name (Google encodes it as !2s{name}).
const VENUE_RE = /!2s([^!]+)/;

function mapboxStaticUrl({ lat, lng, primary }) {
  // Marker pin colour: hex minus '#'. Mapbox accepts 3- or 6-digit hex.
  const pinHex = (primary || "#ff0000").replace("#", "");
  // pin-l = large pin
  const marker = `pin-l+${pinHex}(${lng},${lat})`;
  return (
    `https://api.mapbox.com/styles/v1/${STYLE}/static/` +
    `${marker}/${lng},${lat},${ZOOM},0/${WIDTH}x${HEIGHT}@2x` +
    `?access_token=${MAPBOX_TOKEN}`
  );
}

function mapsLink(lat, lng, venue) {
  // Universal `geo:` would work on mobile, but a Google Maps search URL is
  // friendliest on every desktop. Mobile devices that prefer Apple Maps will
  // happily handle this URL via their Maps app.
  const q = encodeURIComponent(venue || `${lat},${lng}`);
  return `https://www.google.com/maps/search/?api=1&query=${q}&center=${lat},${lng}`;
}

function buildMapBlock({ lat, lng, primary, venue }) {
  const src = mapboxStaticUrl({ lat, lng, primary });
  const href = mapsLink(lat, lng, venue);
  const alt = venue ? `Map of ${venue}` : "Venue map";
  return (
    `<div class="map-container">\n` +
    `    <a class="map-link" href="${href}" target="_blank" rel="noopener" aria-label="Open ${alt} in Maps">\n` +
    `      <img class="map-image" src="${src}" alt="${alt}" loading="lazy" decoding="async" width="${WIDTH}" height="${HEIGHT}">\n` +
    `    </a>\n` +
    `  </div>\n  `
  );
}

async function patch(file, palettes) {
  let html = await readFile(file, "utf8");

  // Parse poster filename → palette → primary
  const posterMatch = html.match(POSTER_FROM_HERO);
  const poster = posterMatch?.[1];
  const palette = poster ? palettes[poster] : null;
  const primary = palette?.primary || "#ff0000";

  // Find coords inside the existing map (iframe) — if there's no iframe but
  // we already wrote a mapbox block previously, skip the page.
  const mapBlock = html.match(MAP_BLOCK_RE)?.[0] || "";
  const coordsMatch = mapBlock.match(COORDS_RE);
  if (!coordsMatch) {
    return { file: basename(file), status: "no coords (map already converted or absent)" };
  }
  const lng = coordsMatch[1];
  const lat = coordsMatch[2];

  // Optional venue
  const venueMatch = mapBlock.match(VENUE_RE);
  const venue = venueMatch ? decodeURIComponent(venueMatch[1].replace(/\+/g, " ")) : "";

  const newBlock = buildMapBlock({ lat, lng, primary, venue });
  html = html.replace(MAP_BLOCK_RE, newBlock);

  await writeFile(file, html);
  return { file: basename(file), status: "ok", lat, lng, venue, primary };
}

async function main() {
  const palettes = JSON.parse(await readFile(PALETTE_FILE, "utf8"));
  const files = (await readdir(EVENTS_DIR))
    .filter((f) => f.endsWith(".html") && f !== "event-template.html")
    .sort();

  const results = [];
  for (const f of files) {
    results.push(await patch(join(EVENTS_DIR, f), palettes));
  }
  for (const r of results) {
    console.log(`  ${r.file.padEnd(45)} ${r.status}${r.venue ? "  · " + r.venue : ""}`);
  }
  const ok = results.filter((r) => r.status === "ok").length;
  console.log(`\nConverted ${ok}/${results.length} maps to Mapbox.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
