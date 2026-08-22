# Local Valhalla Routing Setup

Local-dev setup for the self-hosted Valhalla routing engine that
`server/services/routingService.js` talks to, built from the same
Bangladesh OSM extract already used for the PMTiles basemap and the POI
database. This document covers the Valhalla/Docker side only - see
`routingService.js`, `routingController.js`, and `accessibilityService.js`
for how the Express backend consumes it.

Valhalla is a long-running service - it cannot run inside a Netlify
Function, so in every environment (local dev and production) it runs as its
own separate always-on process, reached over plain HTTP.

## 1. Requirements

- Docker.
- The existing Bangladesh extract at `map-build/data/sources/bangladesh.osm.pbf`
  (same file M3's POI import uses - no new data source needed).

## 2. Image

`ghcr.io/valhalla/valhalla-scripted:latest` - the official Valhalla project's
"scripted" Docker image (no separate Dockerfile needed; it wraps the base
`ghcr.io/valhalla/valhalla` image with an entrypoint that builds tiles from
any `.pbf` file placed in a mounted directory, then starts the HTTP service).
Confirmed working version at the time of this setup: **Valhalla 3.8.3**
(`3.8.3-49cd28bc5`).

## 3. Directory layout

All generated routing data lives under `map-build/data/valhalla/`, already
covered by the repo's blanket `map-build/` gitignore rule - nothing here is
ever committed.

```
map-build/data/valhalla/
  custom_files/            <- mounted into the container as /custom_files
    bangladesh.osm.pbf     <- hard-linked copy of the source PBF (no extra disk usage)
    admins.sqlite          <- built once, reused across rebuilds
    timezones.sqlite       <- built once, reused across rebuilds
    default_speeds.json    <- downloaded once, reused across rebuilds
    valhalla.json           <- generated config
    valhalla_tiles/         <- generated graph tiles (working directory)
    valhalla_tiles.tar      <- the tile extract Valhalla actually serves from
```

## 4. One-time setup

```bash
mkdir -p map-build/data/valhalla/custom_files
# Hard link avoids duplicating the 337MB PBF on disk (same volume required).
# Falls back to a plain copy if hard-linking isn't possible in your environment.
ln map-build/data/sources/bangladesh.osm.pbf map-build/data/valhalla/custom_files/bangladesh.osm.pbf \
  || cp map-build/data/sources/bangladesh.osm.pbf map-build/data/valhalla/custom_files/bangladesh.osm.pbf

docker pull ghcr.io/valhalla/valhalla-scripted:latest
```

## 5. Build + run

A single `docker run` both builds the routing graph (first run only) and
starts the HTTP API on port 8002:

```bash
docker run -dt --name banglaghar-valhalla \
  -p 8002:8002 \
  -e server_threads=1 \
  -v "<absolute-repo-path>/map-build/data/valhalla/custom_files:/custom_files" \
  ghcr.io/valhalla/valhalla-scripted:latest
```

(On Windows/Git Bash, prefix with `MSYS_NO_PATHCONV=1` and pass a Windows-style
path, e.g. `D:/BanglaGhar/map-build/data/valhalla/custom_files:/custom_files`,
matching the same pattern already used for the M1/M3 Docker tooling.)

**Why `server_threads=1`**: the default (one thread per CPU core) reliably
segfaulted during the graph-"enhance" build stage in this environment - a
known, previously-reported class of Valhalla bug (see `valhalla/valhalla`
issues #1968, #4689, #487, #2479, #5028 and `valhalla/docker` issue #32, all
describing the same multi-threaded crash during `valhalla_build_tiles`).
Confirmed not an out-of-memory kill (`OOMKilled=false`, and observed memory
use during the build stayed under ~550MB, far below the container's 7.58GB
limit). Single-threaded enhancement is slower but has been reliable; if you
want to try higher concurrency, the same failure mode is easy to detect (a
`Segmentation fault (core dumped)` line in `docker logs` right after
`Enhancing local graph...`) - if it recurs, drop back to `server_threads=1`.

First build takes roughly 15-20 minutes for the current ~337MB Bangladesh
extract on a 12-core/7.5GB-RAM Docker Desktop allocation. Watch progress:

```bash
docker logs -f banglaghar-valhalla
```

The service is ready once `/status` responds:

```bash
curl http://localhost:8002/status
```

## 6. Normal start / stop (day-to-day - does NOT rebuild)

Once section 5 has built the tiles once, everyday start/stop of the *same*
container is fast (a few seconds) and never rebuilds, because the image's
own default (`use_tiles_ignore_pbf=True`) just loads the existing
`valhalla_tiles.tar`:

```bash
docker stop banglaghar-valhalla
docker start banglaghar-valhalla   # NOT `docker run` - see the warning below
```

Confirm it came back up correctly (should return almost immediately):

```bash
curl http://localhost:8002/status
```

`docker logs banglaghar-valhalla --tail 20` should show `Found routing
tiles with 'use_tiles_ignore_pbf' True` / `Jumping directly to the tile
loading!`, not `Running valhalla_build_tiles`. If you see the latter after a
plain `docker start`, something is wrong - see the warning immediately
below.

**Important Docker semantics gotcha, discovered the hard way**: environment
variables are baked into a container at `docker run`/`docker create` time,
not re-read on every `docker start`. If a container was ever created with
`-e force_rebuild=True` (e.g. by copy-pasting section 7's forced-rebuild
command as your *normal* start command), **every subsequent `docker start`
on that same container will rebuild again** - in this environment that
cost roughly 40 minutes, discovered when a container created this way was
restarted and appeared to hang. The fix is not a flag - it's to never reuse
a force_rebuild container for ordinary start/stop: after finishing a
forced rebuild (section 7), immediately recreate the container with the
plain command in section 5 (no `force_rebuild`) before doing anything else
with it, so every future `docker start` on it stays fast. This has been
verified directly against this repository's own Valhalla container.

## 7. Rebuilding after the source PBF changes

`use_tiles_ignore_pbf=True` (the default) means a plain restart never
rebuilds - **explicitly force a rebuild** when you have new/changed OSM
data:

```bash
docker rm -f banglaghar-valhalla
rm -rf map-build/data/valhalla/custom_files/valhalla_tiles \
       map-build/data/valhalla/custom_files/valhalla_tiles.tar
docker run -dt --name banglaghar-valhalla \
  -p 8002:8002 \
  -e server_threads=1 \
  -e force_rebuild=True \
  -v "<absolute-repo-path>/map-build/data/valhalla/custom_files:/custom_files" \
  ghcr.io/valhalla/valhalla-scripted:latest
```

`admins.sqlite`, `timezones.sqlite`, and `default_speeds.json` do not need to
be deleted - they're reused automatically.

**Immediately after this rebuild finishes**, recreate the container without
`force_rebuild` so it's safe for normal start/stop from then on (see the
warning in section 6):

```bash
docker rm -f banglaghar-valhalla
docker run -dt --name banglaghar-valhalla \
  -p 8002:8002 \
  -e server_threads=1 \
  -v "<absolute-repo-path>/map-build/data/valhalla/custom_files:/custom_files" \
  ghcr.io/valhalla/valhalla-scripted:latest
```

This picks the already-just-built tiles straight back up (same
`use_tiles_ignore_pbf=True` fast path as section 6) - it does not rebuild
again.

## 8. Environment variable for the backend

The value the Express backend reads via `VALHALLA_URL` (see
`server/services/routingService.js`), following this repo's existing plain-
`UPPER_SNAKE` env convention:

```
VALHALLA_URL=http://localhost:8002
```

No API key - this is a fully self-hosted, unauthenticated local service.
The application has no other runtime dependency on Valhalla beyond this one
URL - nothing else needs to know it's Docker-based, self-hosted, or how it
was built.

## 9. Removing the container entirely

```bash
docker rm -f banglaghar-valhalla   # removes the container object only - /custom_files data on disk is untouched, rebuild from section 5 to recreate it
```
