# Kota Baru — City Redevelopment Game

An offline, top-down city-redevelopment game. You play a property developer who buys plots from NPC
owners in a real neighborhood (imported from OpenStreetMap), then demolishes, lays roads and builds.

**Status: Milestone 6** (all milestones done): map, plots and owners, negotiation, redevelopment,
economy and save/load, plus a lifelike satellite-style look, traffic, sound, 16 building types and
district planning.

## Quick start

Requires Node.js 18+ (20 or 22 recommended).

```bash
npm install
npm run dev            # open http://localhost:5173
```

The repo ships with `maps/sample-kampung.json`, a **synthetic** 1 km² Indonesian kampung (not a real
place) so you can play without importing anything. Regenerate it with `npm run sample-map`.

### Controls

| Action | Input |
| --- | --- |
| Pan | Drag (any mouse button), or WASD / arrow keys |
| Zoom | Mouse wheel (zooms toward the cursor), or `+` / `-` |
| Reset view | `Home` key or the **Reset view** button |
| Inspect a plot | Click it (hover shows owner and value) · `Esc` closes |
| Switch view | `1` normal · `2` plot status · `3` land value |

| Pause / resume time | `Space` or the speed buttons in the top bar |

### Negotiating

Click a plot → **Visit owner**. In the conversation:

- **Offer**: drag the slider (percent of market value) and tick deal options. Moving costs and
  relocation help are paid now; a free apartment or a shop unit are promises you'll fulfil when
  you build. Each owner values the options differently: a warung owner loves a shop unit, a
  grandmother who can't climb stairs doesn't want an apartment.
- **Listen**: hear one of their stories and learn what they care about most (or that they will never sell).
- **Gift**: small cost, better mood, a bit more patience.
- **Pressure**: may knock their price down, especially for owners who need money, but always costs
  reputation and their friends and family hear about it.
- They **accept**, **counter** (each counter comes down toward their real minimum), say your offer is
  **too low**, or feel **insulted** by a lowball (reputation −2, the neighbours' mood drops). Run out
  their patience and they'll ask you to come back in a few days; anger them and they won't see you
  for weeks. **Holdouts** never sell.
- Their hidden minimum price moves with mood, your reputation, how many of their friends and family
  already sold, rumours of generous deals nearby (they'll expect the same), and slow drift over time.
- State land: **Apply to buy from the city** at the assessed value plus fees (more if your reputation
  is poor). Public parks aren't for sale.

Time pauses while you talk. Moods recover slowly as days pass.

### Building

| Tool | Key | What it does |
| --- | --- | --- |
| Select | `V` | Inspect plots and your new buildings |
| Demolish | `X` | Demolish a building on land you own (costs money, takes days), remove your new roads or buildings, or remove an old gang/footpath once you own the land on both sides |
| Road | `N` | Click points (snaps to existing roads and a 1 m grid), double-click or `Enter` to build. Gang 4 m, street 7 m, avenue 12 m. Only over your land or existing roads. |
| Build | `B` | Pick a building in the palette; it aligns itself to the nearest road. `R` rotates 90°, `Q`/`E` 15°. |
| District | `Z` | Paint zones on your land once district planning is unlocked |

Placement rules: every square metre of the footprint must be land you own (not road, water or a
standing building), larger buildings need a margin of your own land around them (shown as a thin
outline), and the building must be within 4 m of a drivable road. Your land is highlighted in green
while a tool is active. Cost is paid up front; construction takes in-game days (a house 45, an
apartment tower 300). Tick developer mode for an "Add money" button when testing big projects.

### Money

Click the money in the top bar for the **Finances** panel. Every month (on the 1st):

- **Income**: houses, offices and parking are rented out; ruko rows and malls lease shop units;
  apartment towers sell units month by month (≈1.7× their construction cost in total). Occupancy
  and sales pace grow with your reputation and with parks, mosques, schools and halls you build
  nearby. Old houses you bought but haven't demolished bring in a little rent.
- **Costs**: loan interest, maintenance (0.6%/yr of building cost), land tax (0.2%/yr of land value).
  Going below zero costs an overdraft penalty and reputation.
- **Loans**: borrow against half the value of your land and buildings (plus a small unsecured line).
  The rate is 7%/yr with a good reputation, up to ~16% with a bad one. Repay any time.
- **Permits**: buildings of 3+ floors or 900+ m² wait for a permit (shorter with a good reputation)
  and are refused below reputation 25. Civic buildings (school, mosque, park, hall) raise reputation.
- **Promises**: a promised apartment is handed over when your next apartment tower opens; a promised
  shop unit when a mall or ruko row opens. Promises not kept within two years are broken (reputation −5).

### Looks, life and sound

- The ground is baked per map into a texture: tiled or paved yards and trodden earth around houses,
  grass and scrub further out, dense vegetation, rice fields at different growth stages with planting
  rows, and a tree canopy of thousands of shaded trees in natural clusters (cleared when you demolish,
  pave or build). Roofs are weathered and some carry water tanks or solar heaters.
- Cars and many motorbikes drive on the left along the roads (including the ones you build), cloud
  shadows drift over the map, cranes swing over building sites and demolitions raise dust.
- Sound effects and ambience (birds, distant traffic) are synthesised in the browser: no audio files.
  Mute with 🔊 in the top bar; volume, ambience, traffic and clouds are in **☰ Game → Settings**.

### District planning (new-city mode)

Once you own **2 ha of connected land** (streets running between your plots count as connecting), the
**District** tool (`Z`) unlocks. Paint residential, commercial and green zones on your land with
a brush (left-drag; right-drag still pans). Buildings that match their zone get more demand (homes,
kost, hotels and apartments in residential; shops, markets and malls in commercial; anything civic
anywhere), a balanced plan (about 50/30/20) lifts demand for everything inside it, and permits in
zoned land come faster.

### Saving

**☰ Game** in the top bar: three save slots plus an automatic save every month (stored in this
browser), **Download save file** / **Load save file…** to keep or move saves, and **New game**.
A save is a small JSON file (a few KB) of what changed; the neighbourhood itself is regenerated
from the map. Saves remember which map they belong to.

**Land registry.** Every square metre that isn't road or water belongs to exactly one plot: land
between houses is split between the nearest buildings (up to 10 m), open land becomes 20 m
state/park/field parcels, and the remaining gaps go to the nearest parcel. So buying neighbouring
plots gives you one continuous piece of land.

Tick **Developer mode** in the map info panel to see hidden owner values (minimum price, holdout
flag, mood). Useful for testing; it's a spoiler in normal play.

## Importing your own neighborhood

Run this **once while online**; it saves a processed file into `/maps` and the game stays offline after.

1. Find the coordinates. Easiest: right-click a spot in Google Maps or openstreetmap.org and copy the
   `lat, lon`. Or draw a box at <https://bboxfinder.com> / openstreetmap.org → *Export*.
2. Run one of:

```bash
# A 1 km × 1 km square around a center point (recommended to start)
npm run import-map -- --center -6.2297,106.8295 --size 1000 --name "Setiabudi"

# An exact bounding box: south,west,north,east
npm run import-map -- --bbox -6.234,106.825,-6.225,106.834 --name "Setiabudi"
```

3. Reload the game and choose the map in the **Map** dropdown (or use **Open map file…** to load any
   processed `.json` from disk).

Other options:

| Option | Meaning |
| --- | --- |
| `--country XX` | ISO country code (used later for owner names). Auto-detected if omitted. |
| `--save-raw` | Also keep the raw Overpass response in `maps/raw/` (git-ignored). |
| `--input file.json` | Process a saved Overpass response instead of downloading. |
| `--endpoint URL` | Use a specific Overpass server. |
| `--print-query` | Just print the Overpass query and exit. |

If the public Overpass servers are busy, the script retries on mirrors. As a fallback you can paste the
query printed by `npm run import-map -- --center … --print-query` into <https://overpass-turbo.eu>,
export the raw data as JSON, and run the importer with `--input that-file.json` plus the same bbox.

Areas with no OSM building data simply show empty land (later this becomes state-owned land).
Map data © OpenStreetMap contributors, ODbL. The attribution is shown in the game.

### Satellite reference overlay (optional, personal use)

Bottom toolbar → **Satellite overlay** → *Load image…*. Pick a screenshot of the same area. It is
auto-fitted to the map; with *Adjust position* ticked you can drag to move it, wheel to scale and
Shift+wheel to rotate. Opacity and draw-order are adjustable. The image and its alignment are stored
in your browser (IndexedDB / localStorage) per map. Nothing is copied into the project.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Typecheck + production build into `dist/` (works from `file://`, ready for Tauri/Electron) |
| `npm run build:single` | One self-contained `dist-single/kota-baru.html` you can double-click to play offline |
| `npm run typecheck` | TypeScript only |
| `npm run import-map -- …` | OSM importer (see above) |
| `npm run sample-map` | Regenerate the synthetic sample map |
| `npm test` | Importer, world generation, negotiation, development and economy/save tests |

## Project plan

### Folder structure

```
maps/                    processed map JSON files (bundled into the game, loaded offline)
scripts/
  import-osm.ts          CLI: bbox → Overpass download → maps/<name>.json
  lib/osm.ts             pure Overpass-JSON → MapData conversion (tested)
  generate-sample.ts     synthetic sample kampung
  test-import.ts         importer test, fixtures/ holds sample Overpass data
src/
  main.ts                boot: Pixi app, camera, map loading, game loop
  shared/                code used by BOTH importer and game
    mapTypes.ts          MapData format
    projection.ts        lat/lon ↔ local meters (equirectangular)
    geometry.ts          area, centroid, point-in-polygon, simplification
  i18n/strings.ts        all UI text (en, id) — translate here
  i18n/dialogue.ts       all negotiation dialogue (en, id), several variants per line
  render/                PixiJS: MapRenderer, Camera, input controls, styles, overlay
  map/mapStore.ts        lists/loads maps from /maps or a file
  ui/hud.ts              DOM HUD: top bar, side panel, status bar, toolbar
  util/                  seeded RNG, IndexedDB helper
  game/
    World.ts             generates and holds plots + owners for a map; hit testing
    plots.ts             plots from footprints (+2 m yard) and 20 m empty-land cells, value, neighbours
    owners.ts            owner generation: stats, stories, multi-plot landlords, relationships
    names.ts             country-specific names and honorifics (ID, MY, TH, PH, VN, fallback)
    regional.ts          currency and price levels per country, money formatting
    Game.ts              mutable state: clock, money, reputation, negotiation records, promises
    negotiation.ts       the negotiation engine (pure logic, tested in Node)
    LandGrid.ts          1 m raster: ownership, roads, water, buildings (placement rules)
    Development.ts       demolition, roads, buildings, construction progress
    catalog.ts           building and road types (size, floors, cost, build time, income model)
    Economy.ts           monthly close, income, loans, credit, promises
    save.ts, saveStore.ts  save/load (JSON) and browser save slots
    District.ts          district zoning, unlock rule, balance and demand effects
  render/Terrain.ts      baked ground texture and tree canopy
  render/Life.ts         traffic, cloud shadows, cranes, dust
  audio/Sound.ts         synthesised sound effects and ambience
```

### Data model

**Static map (`MapData`, from the importer)** — never changes during play. Coordinates are meters
around the map center (x = east, y = south, matching screen space), stored as flat arrays.

- `buildings[]`: `id`, `type` (OSM building tag), `use` (amenity/shop), `levels`, `name`, `poly`
- `roads[]`: `kind` (primary…path, rail), `width` m, `name`, `bridge`, `line`
- `water[]`, `waterways[]`, `greens[]` (park, forest, paddy…), `landuse[]`, `trees`
- `center`, `bbox`, `bounds`, `country`, `attribution`

**How plots are made.** On a 1 m raster, land is assigned to the nearest building (up to 10 m),
then open land is cut into 20 m cells: rice fields/farmland become farmer-owned plots (one farmer per 2×2
block), parks and other empty land belong to the city, cemeteries to a community trust. Plot value =
land area × country price × location factor (main road ×1.7, street ×1.0, alley ×0.85, footpath only
×0.7) + floor area × build cost × condition.

**Game state (saved as JSON from Milestone 5)** — everything that changes, referencing map ids:

- `Plot`: id, polygon (footprint + buffer, or empty state land), area, base value, road access,
  neighbor plot ids, status (`not_approached | negotiating | sold | refused`), building state
  (original / demolished / new building id)
- `Owner`: id, plotIds, name, family size, years lived, attachment, greed, finances
  (`needs_money | comfortable | wealthy`), holdout flag, hidden minimum price (+ drift), mood,
  relationships `{ownerId: -100..100}`, story hooks for dialogue, negotiation log
- `Player`: money, loans, reputation
- `World`: date/clock, speed, roads added/removed, placed buildings + construction progress
- Generation is deterministic from the map id + a seed, so saves only store what changed.

### Milestones

1. ✅ Setup, OSM import, map rendering with pan/zoom
2. ✅ Plots and owners: click a plot → owner info panel
3. ✅ Negotiation: offers, counters, refusals, deal options, reputation, neighbor influence, logs
4. ✅ Demolish, road drawing, placing buildings on owned land
5. ✅ Economy, clock, income, loans, save/load
6. ✅ Polish: sound, animation, more building types, district/new-city mode, lifelike terrain
