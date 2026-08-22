# Local Valhalla Routing Setup (Phase A)

Proof-of-concept / local-dev setup for a self-hosted Valhalla routing engine,
built from the same Bangladesh OSM extract already used for the PMTiles
basemap (M1) and the POI database (M3). This is infrastructure only - there
is no Express integration yet (see `server/services/poiService.js`-style
integration, planned for Phase B).

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

## 6. Rebuilding after the source PBF changes

The image's default restart behavior (`use_tiles_ignore_pbf=True`) will
otherwise just re-serve whatever's already in `valhalla_tiles/` without
rebuilding - **explicitly force a rebuild**:

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

## 7. Environment variable for the future backend

Not implemented yet (Phase B), but the value the Express backend will use,
following this repo's existing plain-`UPPER_SNAKE` env convention:

```
VALHALLA_URL=http://localhost:8002
```

No API key - this is a fully self-hosted, unauthenticated local service.

## 8. Stopping / cleanup

```bash
docker stop banglaghar-valhalla   # keeps the container, and the built tiles on disk
docker rm banglaghar-valhalla     # removes the container object only - /custom_files data on disk is untouched
```
