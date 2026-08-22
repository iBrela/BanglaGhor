# Bangladesh POI Import

Populates the `pointofinterests` collection from OpenStreetMap data. Three-step
pipeline, run manually and independently of the app server:

```
bangladesh.osm.pbf  →  osmium tags-filter  →  filtered .osm.pbf
                     →  osmium export       →  GeoJSON
                     →  importBangladeshPOIs.js  →  MongoDB
```

## 1. Prerequisites

- A Bangladesh OSM extract, e.g. `bangladesh.osm.pbf` (Geofabrik).
- Docker, for running `osmium-tool` (no official osmium Docker image exists;
  the commands below use the third-party `stefda/osmium-tool` image, which is
  what was actually used and verified for this import — inspect it yourself
  before trusting it in a new environment).
- Node.js + the server's existing `node_modules` (uses `mongoose`, `dotenv`).
- A `MONGO_URI` in `server/.env`, same as the rest of the server.

## 2. Filter the extract down to POI tags only

Run from the repository root. `poi-tag-filters.txt` (in this directory) lists
one `osmium tags-filter` expression per line, one per POI category rule used
by the importer — keep the two files in sync if you change categories.

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "<repo-root>:/repo" \
  --entrypoint osmium stefda/osmium-tool \
  tags-filter -o /repo/map-build/data/bangladesh-pois-filtered.osm.pbf --overwrite \
  -e /repo/server/tools/poi-tag-filters.txt \
  /repo/map-build/data/sources/bangladesh.osm.pbf
```

(`MSYS_NO_PATHCONV=1` is only needed on Git Bash for Windows, to stop it from
mangling the `-v` volume argument. Drop it on Linux/macOS.)

## 3. Export the filtered extract to GeoJSON

`-u type_id` is required — without it, osmium omits feature ids entirely, and
the importer has no way to build a stable `osmId`/`osmType`.

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "<repo-root>:/repo" \
  --entrypoint osmium stefda/osmium-tool \
  export -f geojson -u type_id --overwrite \
  -o /repo/map-build/data/bangladesh-pois.geojson \
  /repo/map-build/data/bangladesh-pois-filtered.osm.pbf
```

Both generated files land under `map-build/data/`, which is already
gitignored — never commit the `.osm.pbf`, filtered `.osm.pbf`, or `.geojson`
outputs.

## 4. Import into MongoDB

```bash
cd server
node tools/importBangladeshPOIs.js --geojson ../map-build/data/bangladesh-pois.geojson --dry-run
node tools/importBangladeshPOIs.js --geojson ../map-build/data/bangladesh-pois.geojson
```

Always dry-run first and check the category breakdown looks sane before
running for real. `MONGO_URI` is read from `server/.env` — this tool works
unchanged against any client's own database, it is not tied to any specific
cluster.

### Flags

- `--geojson <path>` (required) — path to the exported GeoJSON.
- `--dry-run` — parse and report counts, write nothing.
- `--refresh` — after a fully successful write, delete any existing
  `source=openstreetmap` documents not touched by this run (see below).
  Omit this flag for a plain incremental upsert, which never deletes.
- `--categories a,b,c` — import only the listed categories.
- `--batch-size <n>` — documents per `bulkWrite` batch (default 500).

### Refresh safety

`--refresh` is safe to re-run on a schedule to pick up new/changed/removed
OSM data. Every document written during a refresh run is tagged with a
run-scoped `importRunId`. Stale-document deletion only happens *after* every
batch has written successfully — if the import fails or is interrupted
partway through (crash, killed process, network failure), no deletion runs
at all, so a partial import can never wipe out existing data. A plain
(non-refresh) import never deletes anything, regardless of outcome.

### Re-running / idempotency

Safe to re-run at any time. Documents are upserted on `(osmId, osmType)`, so
re-importing the same GeoJSON updates existing documents in place instead of
duplicating them.
