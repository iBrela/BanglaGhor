# BanglaGhor

BanglaGhor is a real-estate web application developed as part of ICT Project A and continued in ICT Project B.

The platform is designed to help users browse and manage property listings while supporting features such as AI-assisted property search, multilingual functionality, location services, property management, and real-time communication.

## Technology Stack

- React.js – Frontend
- Node.js / Express.js – Backend
- MongoDB – Database
- AWS Cognito – Authentication
- AWS S3 – Property image storage
- Groq API – AI chatbot
- Google Translate API – English and Bangla translation
- OpenCage – Geocoding/location services
- Ably – Real-time messaging

## Project Structure

- `src/` – React frontend
- `server/` – Backend server, routes, controllers, models and services
- `public/` – Public frontend assets

## Initial Setup

After cloning the repository, install the frontend dependencies:

```bash
npm install
```

## Map data setup (required to run the site locally)

The website's map uses a local basemap tile archive, `map-build/data/bangladesh.pmtiles` (~445 MB). This file is too large for a normal Git commit, so it's distributed via **Git LFS** instead of being included directly in your regular clone download.

### 1. Install Git LFS (one-time, per machine)

```bash
git lfs install
```

If you don't already have the `git-lfs` command, install it first from [git-lfs.com](https://git-lfs.com) (or via your OS package manager), then run the command above.

### 2. Get the file

If you clone the repository **after** Git LFS is tracking `*.pmtiles`, a normal `git clone`/`git pull` will fetch the real file automatically. If you already had the repo cloned before LFS was set up, fetch it explicitly:

```bash
git lfs pull
```

Verify the file downloaded correctly (should show `bangladesh.pmtiles` with its real ~445 MB size, not a small pointer file):

```bash
git lfs ls-files
```

### 3. Serve the file locally

The frontend expects the map tiles to be served from `http://localhost:8080/bangladesh.pmtiles`. Serve the directory with a simple local HTTP server:

**Windows:**
```bat
cd map-build\data
python -m http.server 8080
```

**macOS/Linux:**
```bash
cd map-build/data
python3 -m http.server 8080
```

Leave that server running, then verify it in a browser or with curl:

```
http://localhost:8080/bangladesh.pmtiles
```

### 4. Configure the frontend

In your `.env` file (copied from `.env.example`, never committed), make sure this points at your local server:

```
REACT_APP_PMTILES_URL=http://localhost:8080/bangladesh.pmtiles
```

This is already the default `mapBasemapStyle.js` falls back to if the variable is unset, so for local development you typically don't need to set it explicitly - only override it if you're pointing at a different host (e.g. a hosted/CDN copy for a deployed environment).
