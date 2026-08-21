// ============================================================================
// Thin Node.js wrapper around the `pmtiles` + `@mapbox/vector-tile` libraries
// for reading and decoding tiles directly from a local .pmtiles archive.
//
// Uses fs.openAsBlob() (Node 19.8+) to get a Web-Blob-like handle that
// pmtiles' FileSource can read via range requests (.slice().arrayBuffer()) —
// no HTTP server, no custom Source adapter needed.
// ============================================================================

const fs = require("fs");
const { PMTiles, FileSource } = require("pmtiles");
const { VectorTile } = require("@mapbox/vector-tile");
const { PbfReader: Protobuf } = require("pbf");

async function openPmtiles(filePath) {
  const blob = await fs.openAsBlob(filePath);
  blob.name = filePath;
  const pmtiles = new PMTiles(new FileSource(blob));

  const header = await pmtiles.getHeader();
  const metadata = await pmtiles.getMetadata();

  async function getDecodedTile(z, x, y) {
    const res = await pmtiles.getZxy(z, x, y);
    if (!res) return null; // tile does not exist in the archive at all
    const vt = new VectorTile(new Protobuf(Buffer.from(res.data)));
    return vt;
  }

  return { header, metadata, getDecodedTile };
}

module.exports = { openPmtiles };
