# Local Floci (S3 Emulator) Setup

Local-dev setup for Floci, the self-hosted AWS/S3 emulator
`server/services/s3Provider.js` talks to when `S3_MODE` resolves to
`"floci"` (see that file's own doc comment for the full provider-selection
story). This document covers the Floci/Docker side only.

## 1. Image

`floci/floci:latest` (an open-source LocalStack-Community alternative).
Confirmed working version at the time of this setup: **Floci 2.0.1**.

## 2. Persistence - why this matters

By default Floci's S3 emulation runs in **in-memory** mode: buckets and
every uploaded object are held only in the running process's memory and
are lost the moment that process exits - a plain `docker restart` or
`docker stop`/`docker start` is enough to wipe every bucket, not just the
objects in it (confirmed directly: after a restart, even a `HeadBucket`
on a bucket created moments earlier came back `NoSuchBucket`).

Floci supports a **`persistent`** storage mode, controllable **per
emulated AWS service** via `FLOCI_STORAGE_SERVICES_<SERVICE>_MODE` (there
is also a global `FLOCI_STORAGE_MODE`, deliberately not used here so this
change can't affect any other emulated service - S3 is the only one this
app actually uses). Setting `FLOCI_STORAGE_SERVICES_S3_MODE=persistent`
makes Floci write bucket/object state to disk under
`FLOCI_STORAGE_PERSISTENT_PATH` (already baked into the image as
`/app/data`) as it goes, and reload it on startup.

Confirmed directly (not assumed): with this env var set, an uploaded
object survived `docker restart`, `docker stop` + `docker start`, **and**
a full `docker rm` + `docker run` recreation - as long as the same named
Docker volume is reattached at `/app/data` each time.

## 3. One-time setup / normal start

The container needs exactly one extra flag over a bare `floci/floci`
run - a named volume (so `/app/data` survives container removal) and the
persistence env var:

```bash
docker run -d --name banglaghar-floci \
  -p 4566:4566 \
  -v banglaghar-floci-data:/app/data \
  -e FLOCI_STORAGE_SERVICES_S3_MODE=persistent \
  floci/floci:latest
```

(On Windows/Git Bash, the same `MSYS_NO_PATHCONV=1` prefix used for this
repo's other Docker tooling isn't needed here - no absolute container
paths appear as bare command arguments.)

No credentials are involved - Floci accepts any access key/secret
(`floci`/`floci` is the convention already used in `s3Provider.js`'s
`buildFlociClient()`), so nothing here is a secret and nothing here
should ever be committed to `.env`.

## 4. Normal restart (does not lose data, unlike before)

```bash
docker restart banglaghar-floci
# or
docker stop banglaghar-floci && docker start banglaghar-floci
```

Both are now safe - buckets and objects survive, because they're
written to the `banglaghar-floci-data` volume, not just held in memory.

## 5. Recreating the container (e.g. after an image update)

```bash
docker rm -f banglaghar-floci
docker run -d --name banglaghar-floci \
  -p 4566:4566 \
  -v banglaghar-floci-data:/app/data \
  -e FLOCI_STORAGE_SERVICES_S3_MODE=persistent \
  floci/floci:latest
```

As long as the **same volume name** (`banglaghar-floci-data`, or whatever
existing named volume is already in use - check with
`docker inspect banglaghar-floci --format '{{range .Mounts}}{{.Name}}{{end}}'`
before removing the old container) is reattached, all bucket/object data
survives this too - confirmed directly.

## 6. Removing the container AND its data

```bash
docker rm -f banglaghar-floci
docker volume rm banglaghar-floci-data   # only if you actually want to wipe local S3 data
```

## 7. Required buckets

The application bootstraps its own required buckets automatically on
every startup when running against Floci (see `ensureFlociBucketsExist()`
in `server/services/s3Provider.js` - idempotent, never touches an
already-existing bucket, never runs against real AWS). You do not need to
create `APP_S3_BUCKET_PROPERTY_IMAGES` / `S3_BUCKET_NAME` by hand.

## 8. Environment variables the backend reads

Already documented in `server/.env.example` - `FLOCI_ENDPOINT` (defaults
to `http://localhost:4566`, matching this container's port mapping
above). No other Floci-specific variables are
needed on the app side; the persistence behavior above is entirely a
property of how the *container itself* is launched, not of anything the
Node process passes to it.
