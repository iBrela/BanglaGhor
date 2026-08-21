// ============================================================================
// TOOL: Bangladesh Map Coverage Audit
// ============================================================================
// Purpose: Systematically, empirically measure how completely our
//          bangladesh.pmtiles archive covers the WHOLE country — not a
//          hand-picked list of cities. It enumerates every z13 tile whose
//          center falls inside the real Bangladesh boundary (parsed from the
//          Geofabrik .poly file the OSM extract itself was clipped with, see
//          boundary.js — not a rectangular bounding box, which would wrongly
//          count ocean/India/Myanmar territory as "missing Bangladesh data"),
//          decodes each tile directly from the archive, and tallies feature
//          presence per layer/class. This is read-only: it never touches
//          mapBasemapStyle.js or any other production file.
//
// Zoom choice: z13 is the lowest zoom at which every OpenMapTiles layer in
// this archive has started rendering (building's minzoom=13 is the last one
// to turn on — see the real per-layer minzoom/maxzoom pulled from the
// archive's own metadata, printed below). Auditing at z13 therefore captures
// the full nationwide feature set in one pass.
//
// Usage:
//   node tools/mapCoverageAudit/run.js [--pmtiles=<path>] [--zoom=13] [--output=<path>]
// ============================================================================

const path = require("path");
const fs = require("fs");
const { openPmtiles } = require("./pmtilesReader");
const { isInsideBangladesh, getBoundaryBBox } = require("./boundary");
const { lonLatToTile, tileCenter } = require("./tileMath");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
  })
);

const PMTILES_PATH = path.resolve(
  args.pmtiles || path.join(__dirname, "..", "..", "map-build", "data", "bangladesh.pmtiles")
);
const ZOOM = parseInt(args.zoom, 10) || 13;
const OUTPUT_PATH = path.resolve(args.output || path.join(__dirname, "report.json"));

// Division centroids (same source as src/constants/divisionCenters.js) used
// only for a coarse "which region are the gaps in" breakdown — this is
// nearest-centroid bucketing, NOT authoritative administrative polygons.
const DIVISION_CENTERS = {
  dhaka: [23.8103, 90.4125],
  chattogram: [22.3569, 91.7832],
  khulna: [22.8456, 89.5403],
  rajshahi: [24.3636, 88.6241],
  barisal: [22.701, 90.3535],
  sylhet: [24.8949, 91.8687],
  rangpur: [25.7466, 89.25],
  mymensingh: [24.7471, 90.4203],
};

function nearestDivision(lat, lon) {
  let best = null;
  let bestD = Infinity;
  for (const [name, [dLat, dLon]] of Object.entries(DIVISION_CENTERS)) {
    const d = Math.hypot(lat - dLat, lon - dLon);
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

// Feature classes we specifically care about for the rural/POI questions
// this audit exists to answer. Matched against real `class`/`subclass`
// values found in the data — nothing here is assumed, it's just a lens we
// apply to the full tally computed below.
const POI_WATCHLIST = {
  hospital: (c, s) => c === "hospital",
  clinic: (c, s) => c === "clinic" || s === "clinic",
  school: (c, s) => c === "school",
  college: (c, s) => c === "college",
  university: (c, s) => c === "university",
  market: (c, s) => c === "marketplace" || s === "marketplace" || s === "market",
  mosque: (c, s) => c === "place_of_worship" && s === "mosque",
  place_of_worship_other: (c, s) => c === "place_of_worship" && s !== "mosque",
  pharmacy: (c, s) => c === "pharmacy",
  bus_station: (c, s) => c === "bus" || s === "bus_stop" || s === "bus_station",
  ferry_terminal: (c, s) => c === "ferry_terminal" || s === "ferry_terminal",
};

function makeCounter() {
  return { total: 0, byValue: new Map() };
}
function bump(counter, value) {
  counter.total++;
  const key = value == null || value === "" ? "(none)" : String(value);
  counter.byValue.set(key, (counter.byValue.get(key) || 0) + 1);
}
function counterToObject(counter) {
  return {
    total: counter.total,
    byValue: Object.fromEntries(
      [...counter.byValue.entries()].sort((a, b) => b[1] - a[1])
    ),
  };
}

async function main() {
  console.log(`Bangladesh Map Coverage Audit`);
  console.log(`PMTiles archive: ${PMTILES_PATH}`);
  if (!fs.existsSync(PMTILES_PATH)) {
    console.error(`ERROR: PMTiles file not found at ${PMTILES_PATH}`);
    process.exit(1);
  }

  const { header, metadata, getDecodedTile } = await openPmtiles(PMTILES_PATH);
  console.log(
    `Archive bounds: [${header.minLon}, ${header.minLat}] -> [${header.maxLon}, ${header.maxLat}], minZoom=${header.minZoom}, maxZoom=${header.maxZoom}`
  );
  const layerZoomRanges = Object.fromEntries(
    (metadata.vector_layers || []).map((l) => [l.id, { minzoom: l.minzoom, maxzoom: l.maxzoom }])
  );
  console.log(`Auditing at z${ZOOM}. Per-layer minzoom/maxzoom from archive metadata:`);
  console.log(layerZoomRanges);

  const boundaryBBox = getBoundaryBBox();
  console.log(`Real Bangladesh boundary bbox (from Geofabrik .poly):`, boundaryBBox);

  // Enumerate every z13 tile whose center falls inside the real country
  // polygon. This is exhaustive (every tile the archive could possibly have
  // data for within Bangladesh), not a statistical sample.
  const c1 = lonLatToTile(boundaryBBox.minLon, boundaryBBox.maxLat, ZOOM);
  const c2 = lonLatToTile(boundaryBBox.maxLon, boundaryBBox.minLat, ZOOM);
  const minX = Math.min(c1.x, c2.x);
  const maxX = Math.max(c1.x, c2.x);
  const minY = Math.min(c1.y, c2.y);
  const maxY = Math.max(c1.y, c2.y);

  const tiles = [];
  for (let tx = minX; tx <= maxX; tx++) {
    for (let ty = minY; ty <= maxY; ty++) {
      const { lon, lat } = tileCenter(tx, ty, ZOOM);
      if (isInsideBangladesh(lon, lat)) tiles.push({ x: tx, y: ty, lat, lon });
    }
  }
  console.log(`Tiles to audit (center inside Bangladesh boundary): ${tiles.length}`);

  // ---- Stats accumulators ------------------------------------------------
  let tilesWithNoDataAtAll = 0;
  let tilesWithBuilding = 0;
  let tilesWithRoad = 0;
  let tilesWithWater = 0;
  let tilesWithWaterway = 0;
  let tilesWithPark = 0;
  let tilesWithPlace = 0;
  let tilesWithPoi = 0;
  let tilesWithBoundary = 0;
  let tilesMissingBuildingAndRoad = 0;
  let tilesMissingBuildingRoadButHasWater = 0; // likely open water/river, not a real land gap
  let tilesMissingBuildingRoadAndWater = 0; // no building/road AND no water either
  let tilesWithNothingMeaningful = 0; // none of building/road/water/waterway/park/place/poi

  const layerFeatureCounts = {}; // layer -> total feature count across all tiles
  const roadClass = makeCounter();
  const roadSubclass = makeCounter();
  const waterwayClass = makeCounter();
  const waterClass = makeCounter();
  const parkClass = makeCounter();
  const placeClass = makeCounter();
  const poiClass = makeCounter();
  const poiSubclass = makeCounter();
  const boundaryAdminLevel = makeCounter();

  const poiWatchlistCounts = Object.fromEntries(
    Object.keys(POI_WATCHLIST).map((k) => [k, { count: 0, examples: [] }])
  );

  const regionStats = {}; // division name -> { total, withBuildingOrRoad }
  for (const name of Object.keys(DIVISION_CENTERS)) {
    regionStats[name] = { total: 0, withBuildingOrRoad: 0, noDataAtAll: 0, realLandGap: 0 };
  }

  const t0 = Date.now();
  let processed = 0;

  for (const tile of tiles) {
    const region = nearestDivision(tile.lat, tile.lon);
    regionStats[region].total++;

    const vt = await getDecodedTile(ZOOM, tile.x, tile.y);
    processed++;
    if (processed % 2000 === 0) {
      console.log(`  ...${processed}/${tiles.length} tiles processed`);
    }

    if (!vt) {
      tilesWithNoDataAtAll++;
      tilesMissingBuildingAndRoad++;
      regionStats[region].noDataAtAll++;
      continue;
    }

    const layers = vt.layers;
    let hasBuilding = false;
    let hasRoad = false;
    let hasWaterAny = false;
    let hasAnyMeaningfulLayer = false;

    for (const layerName of Object.keys(layers)) {
      const layer = layers[layerName];
      layerFeatureCounts[layerName] = (layerFeatureCounts[layerName] || 0) + layer.length;
    }

    if (layers.building && layers.building.length > 0) {
      hasBuilding = true;
      tilesWithBuilding++;
    }

    if (layers.transportation && layers.transportation.length > 0) {
      hasRoad = true;
      tilesWithRoad++;
      for (let i = 0; i < layers.transportation.length; i++) {
        const f = layers.transportation.feature(i);
        bump(roadClass, f.properties.class);
        bump(roadSubclass, f.properties.subclass);
      }
    }

    if (layers.water && layers.water.length > 0) {
      tilesWithWater++;
      hasWaterAny = true;
      for (let i = 0; i < layers.water.length; i++) {
        bump(waterClass, layers.water.feature(i).properties.class);
      }
    }

    if (layers.waterway && layers.waterway.length > 0) {
      tilesWithWaterway++;
      hasWaterAny = true;
      for (let i = 0; i < layers.waterway.length; i++) {
        bump(waterwayClass, layers.waterway.feature(i).properties.class);
      }
    }

    if (layers.park && layers.park.length > 0) {
      tilesWithPark++;
      for (let i = 0; i < layers.park.length; i++) {
        bump(parkClass, layers.park.feature(i).properties.class);
      }
    }

    if (layers.place && layers.place.length > 0) {
      tilesWithPlace++;
      for (let i = 0; i < layers.place.length; i++) {
        bump(placeClass, layers.place.feature(i).properties.class);
      }
    }

    if (layers.boundary && layers.boundary.length > 0) {
      tilesWithBoundary++;
      for (let i = 0; i < layers.boundary.length; i++) {
        bump(boundaryAdminLevel, layers.boundary.feature(i).properties.admin_level);
      }
    }

    if (layers.poi && layers.poi.length > 0) {
      tilesWithPoi++;
      for (let i = 0; i < layers.poi.length; i++) {
        const f = layers.poi.feature(i);
        const c = f.properties.class;
        const s = f.properties.subclass;
        bump(poiClass, c);
        bump(poiSubclass, s);
        for (const [watchKey, matches] of Object.entries(POI_WATCHLIST)) {
          if (matches(c, s)) {
            const entry = poiWatchlistCounts[watchKey];
            entry.count++;
            if (entry.examples.length < 5) {
              entry.examples.push({
                name: f.properties.name || f.properties["name:en"] || "(unnamed)",
                class: c,
                subclass: s,
                nearTile: { lat: tile.lat.toFixed(4), lon: tile.lon.toFixed(4) },
              });
            }
          }
        }
      }
    }

    hasAnyMeaningfulLayer =
      hasBuilding ||
      hasRoad ||
      hasWaterAny ||
      (layers.park && layers.park.length > 0) ||
      (layers.place && layers.place.length > 0) ||
      (layers.poi && layers.poi.length > 0);
    if (!hasAnyMeaningfulLayer) tilesWithNothingMeaningful++;

    if (!hasBuilding && !hasRoad) {
      tilesMissingBuildingAndRoad++;
      if (hasWaterAny) {
        tilesMissingBuildingRoadButHasWater++;
      } else {
        tilesMissingBuildingRoadAndWater++;
        regionStats[region].realLandGap++;
      }
    } else {
      regionStats[region].withBuildingOrRoad++;
    }
  }

  const elapsedMs = Date.now() - t0;
  console.log(`Done. Processed ${tiles.length} tiles in ${(elapsedMs / 1000).toFixed(1)}s.`);

  const report = {
    generatedAt: new Date().toISOString(),
    pmtilesPath: PMTILES_PATH,
    zoom: ZOOM,
    archiveHeader: header,
    layerZoomRanges,
    boundaryBBox,
    tilesAudited: tiles.length,
    summary: {
      tilesWithNoDataAtAll,
      pctNoDataAtAll: pct(tilesWithNoDataAtAll, tiles.length),
      tilesWithBuilding,
      pctWithBuilding: pct(tilesWithBuilding, tiles.length),
      tilesWithRoad,
      pctWithRoad: pct(tilesWithRoad, tiles.length),
      tilesMissingBuildingAndRoad,
      pctMissingBuildingAndRoad: pct(tilesMissingBuildingAndRoad, tiles.length),
      tilesMissingBuildingRoadButHasWater,
      pctMissingBuildingRoadButHasWater: pct(tilesMissingBuildingRoadButHasWater, tiles.length),
      tilesMissingBuildingRoadAndWater,
      pctMissingBuildingRoadAndWater: pct(tilesMissingBuildingRoadAndWater, tiles.length),
      tilesWithNothingMeaningful,
      pctWithNothingMeaningful: pct(tilesWithNothingMeaningful, tiles.length),
      tilesWithWater,
      pctWithWater: pct(tilesWithWater, tiles.length),
      tilesWithWaterway,
      pctWithWaterway: pct(tilesWithWaterway, tiles.length),
      tilesWithPark,
      pctWithPark: pct(tilesWithPark, tiles.length),
      tilesWithPlace,
      pctWithPlace: pct(tilesWithPlace, tiles.length),
      tilesWithPoi,
      pctWithPoi: pct(tilesWithPoi, tiles.length),
      tilesWithBoundary,
      pctWithBoundary: pct(tilesWithBoundary, tiles.length),
    },
    layerFeatureCounts,
    classBreakdown: {
      road_class: counterToObject(roadClass),
      road_subclass: counterToObject(roadSubclass),
      water_class: counterToObject(waterClass),
      waterway_class: counterToObject(waterwayClass),
      park_class: counterToObject(parkClass),
      place_class: counterToObject(placeClass),
      poi_class: counterToObject(poiClass),
      poi_subclass: counterToObject(poiSubclass),
      boundary_admin_level: counterToObject(boundaryAdminLevel),
    },
    poiWatchlist: poiWatchlistCounts,
    regionStats: Object.fromEntries(
      Object.entries(regionStats).map(([name, s]) => [
        name,
        { ...s, pctWithBuildingOrRoad: pct(s.withBuildingOrRoad, s.total) },
      ])
    ),
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
  console.log(`\nFull report written to: ${OUTPUT_PATH}`);

  printSummary(report);
}

function pct(n, total) {
  return total === 0 ? 0 : Math.round((n / total) * 1000) / 10;
}

function printSummary(report) {
  const s = report.summary;
  console.log(`\n==================== SUMMARY ====================`);
  console.log(`Tiles audited (real BD boundary, z${report.zoom}): ${report.tilesAudited}`);
  console.log(`No archive data at all:        ${s.tilesWithNoDataAtAll} (${s.pctNoDataAtAll}%)`);
  console.log(`Has building data:             ${s.tilesWithBuilding} (${s.pctWithBuilding}%)`);
  console.log(`Has road data:                 ${s.tilesWithRoad} (${s.pctWithRoad}%)`);
  console.log(`Missing BOTH building+road:    ${s.tilesMissingBuildingAndRoad} (${s.pctMissingBuildingAndRoad}%)`);
  console.log(`  ...of which has water/waterway (likely sea/river, not a gap): ${s.tilesMissingBuildingRoadButHasWater} (${s.pctMissingBuildingRoadButHasWater}%)`);
  console.log(`  ...of which has NO water either (real land-data gap):         ${s.tilesMissingBuildingRoadAndWater} (${s.pctMissingBuildingRoadAndWater}%)`);
  console.log(`Tiles with NOTHING meaningful rendered (no building/road/water/waterway/park/place/poi): ${s.tilesWithNothingMeaningful} (${s.pctWithNothingMeaningful}%)`);
  console.log(`Has water:                     ${s.tilesWithWater} (${s.pctWithWater}%)`);
  console.log(`Has waterway:                  ${s.tilesWithWaterway} (${s.pctWithWaterway}%)`);
  console.log(`Has park:                      ${s.tilesWithPark} (${s.pctWithPark}%)`);
  console.log(`Has place label:               ${s.tilesWithPlace} (${s.pctWithPlace}%)`);
  console.log(`Has POI:                       ${s.tilesWithPoi} (${s.pctWithPoi}%)`);
  console.log(`Has admin boundary:            ${s.tilesWithBoundary} (${s.pctWithBoundary}%)`);

  console.log(`\n-- place.class values --`);
  console.log(report.classBreakdown.place_class.byValue);

  console.log(`\n-- poi.class values (top 20) --`);
  console.log(Object.fromEntries(Object.entries(report.classBreakdown.poi_class.byValue).slice(0, 20)));

  console.log(`\n-- POI watchlist (hospital/school/college/market/mosque/etc.) --`);
  for (const [key, entry] of Object.entries(report.poiWatchlist)) {
    console.log(`  ${key}: ${entry.count}`);
  }

  console.log(`\n-- Regional breakdown (nearest-division bucketing) --`);
  for (const [name, r] of Object.entries(report.regionStats)) {
    const pctRealGap = pct(r.realLandGap, r.total);
    console.log(
      `  ${name.padEnd(12)} total=${String(r.total).padStart(5)}  withBuildingOrRoad=${r.pctWithBuildingOrRoad}%  realLandGap=${pctRealGap}%  noDataAtAll=${r.noDataAtAll}`
    );
  }
  console.log(`==================================================\n`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
