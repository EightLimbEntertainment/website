#!/usr/bin/env node
/**
 * Walks each event HTML, collects unique venue names, queries Mapbox's
 * geocoding API for each, and writes events/venues.json with accurate
 * lat/lng + a normalised display name.
 *
 * The existing Google-iframe coordinates are the *viewport center*,
 * which is often slightly offset from the actual venue pin. Geocoding
 * from the venue name gives us the true location.
 *
 * Run locally: node scripts/geocode-venues.mjs
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EVENTS_DIR = resolve(ROOT, "events");
const OUT = resolve(EVENTS_DIR, "venues.json");

const MAPBOX_TOKEN =
  process.env.MAPBOX_TOKEN;
if (!MAPBOX_TOKEN) throw new Error("Set MAPBOX_TOKEN env var");

// Pull venue from the page's <p class="event-venue">…</p>
const VENUE_RE = /<p class="event-venue">([^<]+)<\/p>/i;
// Map raw venue strings to a single canonical lookup key + a town hint so
// geocoding has enough context.
const MANUAL = {
  "THE LAB": { search: "The Lab, Northampton, UK", display: "The Lab" },
  "The Lab": { search: "The Lab, Northampton, UK", display: "The Lab" },
  "The Black Prince": { search: "The Black Prince, Northampton, UK", display: "The Black Prince" },
  "The Pomfret Arms": { search: "The Pomfret Arms, Northampton, UK", display: "The Pomfret Arms" },
  "Bedford Esquires - Music Venue": { search: "Esquires, Bedford, UK", display: "Bedford Esquires" },
  "St Andrew's Church, Rugby": { search: "St Andrew's Church, Rugby, UK", display: "St Andrew's Church" },
};

async function geocode(search) {
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/` +
    `${encodeURIComponent(search)}.json?country=GB&limit=1&access_token=${MAPBOX_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mapbox geocoding ${res.status} for ${search}`);
  const data = await res.json();
  const f = data.features?.[0];
  if (!f) throw new Error(`No result for ${search}`);
  return {
    lng: f.center[0],
    lat: f.center[1],
    place_name: f.place_name,
    relevance: f.relevance,
  };
}

async function main() {
  const files = (await readdir(EVENTS_DIR))
    .filter((f) => f.endsWith(".html") && f !== "event-template.html")
    .sort();

  // Collect unique raw venue strings
  const raw = new Set();
  for (const f of files) {
    const html = await readFile(join(EVENTS_DIR, f), "utf8");
    const m = html.match(VENUE_RE);
    if (m) raw.add(decodeURIComponent(m[1].replace(/\+/g, " ")));
  }
  console.log(`Found ${raw.size} unique venues across ${files.length} event pages.`);

  const out = {};
  for (const v of raw) {
    const m = MANUAL[v] || { search: `${v}, UK`, display: v };
    try {
      const geo = await geocode(m.search);
      out[v] = {
        display: m.display,
        lat: geo.lat,
        lng: geo.lng,
        place_name: geo.place_name,
      };
      console.log(`  ${v.padEnd(35)} → ${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}  (${geo.place_name})`);
    } catch (err) {
      console.error(`  ${v}: FAILED — ${err.message}`);
    }
  }

  await writeFile(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`\nWrote ${Object.keys(out).length} venues to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
