/**
 * VNA Cooler Room Configuration
 * Total Capacity: 112 + 112 + 96 = 320 locations
 *
 * Each VNA has 2 racks — LEFT (L) and RIGHT (R) walls inside the room.
 *
 * VNA01 & VNA02 (COL): 8 rows (A-H) × 7 columns (01-07) = 56 per side × 2 = 112
 * VNA03       (CRT):   6 rows (A-F) × 8 columns (01-08) = 48 per side × 2 = 96
 *
 * Naming: {vna}{side}{sph}{col}{row}
 *   1LCOL03A = VNA1, Left side, COL type, Column 03, Row A
 *   2RCOL01B = VNA2, Right side, COL type, Column 01, Row B
 *   3LCRT08F = VNA3, Left side, CRT type, Column 08, Row F
 */
const CONFIG = {
  totalCapacity: 320,

  vna: {
    VNA01: {
      capacity: 112,
      rows: 8,        // A-H (vertical)
      columns: 7,     // 01-07
      sides: ["L", "R"],
      sph: "COL",
    },
    VNA02: {
      capacity: 112,
      rows: 8,        // A-H
      columns: 7,     // 01-07
      sides: ["L", "R"],
      sph: "COL",
    },
    VNA03: {
      capacity: 96,
      rows: 6,        // A-F
      columns: 8,     // 01-08
      sides: ["L", "R"],
      sph: "CRT",
    },
  },

  dropLocations: ["DROPVNA1", "DROPVNA2", "DROPVNA3"],
  pickupLocations: ["PICKUP1", "PICKUP2", "PICKUP3"],
};

/* ── Generate all valid location IDs ─────────────────────────── */
(function generateLocations() {
  CONFIG.vnaLocations = {};
  const allIds = [];

  for (const [vnaId, vna] of Object.entries(CONFIG.vna)) {
    var num = vnaId.replace("VNA0", ""); // "1", "2", "3"
    CONFIG.vnaLocations[vnaId] = [];

    for (var s = 0; s < vna.sides.length; s++) {
      var side = vna.sides[s]; // "L" or "R"
      for (var col = 1; col <= vna.columns; col++) {
        for (var r = 0; r < vna.rows; r++) {
          var row = String.fromCharCode(65 + r); // A, B, C...
          var locId =
            num +
            side +
            vna.sph +
            String(col).padStart(2, "0") +
            row;
          CONFIG.vnaLocations[vnaId].push(locId);
          allIds.push(locId);
        }
      }
    }
  }

  CONFIG.allVNALocationIds = new Set(allIds);
  CONFIG.allDropLocationIds = new Set(
    CONFIG.dropLocations.map(function (l) { return l.toUpperCase(); })
  );
  CONFIG.allPickupLocationIds = new Set(
    CONFIG.pickupLocations.map(function (l) { return l.toUpperCase(); })
  );
})();
