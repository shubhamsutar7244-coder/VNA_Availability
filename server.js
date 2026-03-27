const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

/* ═══════════════════════════════════════════════════════
   CONFIG — mirrors config.js for server-side validation
   ═══════════════════════════════════════════════════════ */
const CONFIG = {
  totalCapacity: 320,
  vna: {
    VNA01: { capacity: 112, rows: 8, columns: 7, sides: ["L", "R"], sph: "COL" },
    VNA02: { capacity: 112, rows: 8, columns: 7, sides: ["L", "R"], sph: "COL" },
    VNA03: { capacity: 96, rows: 6, columns: 8, sides: ["L", "R"], sph: "CRT" },
  },
  dropLocations: new Set(["DROPVNA1", "DROPVNA2", "DROPVNA3"]),
  pickupLocations: new Set(["PICKUP1", "PICKUP2", "PICKUP3"]),
};

// Generate all valid VNA location IDs
const allVNALocationIds = new Set();
const vnaLocations = {};

for (const [vnaId, vna] of Object.entries(CONFIG.vna)) {
  const num = vnaId.replace("VNA0", "");
  vnaLocations[vnaId] = [];
  for (const side of vna.sides) {
    for (let col = 1; col <= vna.columns; col++) {
      for (let r = 0; r < vna.rows; r++) {
        const row = String.fromCharCode(65 + r);
        const locId = num + side + vna.sph + String(col).padStart(2, "0") + row;
        vnaLocations[vnaId].push(locId);
        allVNALocationIds.add(locId);
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════
   STATE
   ═══════════════════════════════════════════════════════ */
const occupiedLocations = new Map(); // locationId → { awbNumber, sph, timestamp, pieces, weight }
const movementLog = [];              // last 200 movements

/* ═══════════════════════════════════════════════════════
   SSE — Server-Sent Events for real-time push
   ═══════════════════════════════════════════════════════ */
const sseClients = new Set();

function broadcastSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    res.write(payload);
  }
}

app.get("/api/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  res.write("event: connected\ndata: {\"message\":\"Connected to VNA monitor\"}\n\n");
  sseClients.add(res);

  // Send current state immediately
  res.write(`event: snapshot\ndata: ${JSON.stringify(buildSnapshot())}\n\n`);

  req.on("close", () => {
    sseClients.delete(res);
  });
});

/* ═══════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════ */
function locationType(loc) {
  const u = loc.toUpperCase();
  if (allVNALocationIds.has(u)) return "VNA";
  if (CONFIG.dropLocations.has(u)) return "DROP";
  if (CONFIG.pickupLocations.has(u)) return "PICKUP";
  return "UNKNOWN";
}

function getVnaForLocation(loc) {
  const u = loc.toUpperCase();
  for (const [vnaId, locs] of Object.entries(vnaLocations)) {
    if (locs.includes(u)) return vnaId;
  }
  return null;
}

function getVnaCounts() {
  const counts = {};
  for (const vnaId of Object.keys(CONFIG.vna)) counts[vnaId] = 0;
  for (const [locId] of occupiedLocations) {
    const vna = getVnaForLocation(locId);
    if (vna) counts[vna]++;
  }
  return counts;
}

function buildSnapshot() {
  const vnaCounts = getVnaCounts();
  const totalOccupied = occupiedLocations.size;
  return {
    totalCapacity: CONFIG.totalCapacity,
    totalOccupied,
    totalAvailable: CONFIG.totalCapacity - totalOccupied,
    utilization: Math.round((totalOccupied / CONFIG.totalCapacity) * 100),
    vnaCounts,
    vnaCapacities: {
      VNA01: CONFIG.vna.VNA01.capacity,
      VNA02: CONFIG.vna.VNA02.capacity,
      VNA03: CONFIG.vna.VNA03.capacity,
    },
    occupiedSlots: Object.fromEntries(occupiedLocations),
    recentMovements: movementLog.slice(0, 20),
    timestamp: new Date().toISOString(),
  };
}

/* ═══════════════════════════════════════════════════════
   API ROUTES
   ═══════════════════════════════════════════════════════ */

// GET /api/status — current snapshot for Raspberry Pi polling
app.get("/api/status", (req, res) => {
  res.json(buildSnapshot());
});

// POST /api/fps — process an FPS movement
app.post("/api/fps", (req, res) => {
  const { fromLocation, toLocation, awbNumber, sph, pieces, weight } = req.body;

  if (!fromLocation || !toLocation || !awbNumber) {
    return res.status(400).json({
      error: "Missing required fields: fromLocation, toLocation, awbNumber",
    });
  }

  const from = fromLocation.toUpperCase().trim();
  const to = toLocation.toUpperCase().trim();
  const fromType = locationType(from);
  const toType = locationType(to);

  if (fromType === "UNKNOWN" && toType === "UNKNOWN") {
    return res.status(400).json({ error: "Both locations are unknown." });
  }

  let action = "OTHER";
  const awbInfo = {
    awbNumber,
    sph: sph || "",
    pieces: parseInt(pieces, 10) || 1,
    weight: parseFloat(weight) || 0,
    timestamp: new Date().toISOString(),
  };

  if (fromType === "DROP" && toType === "VNA") {
    if (occupiedLocations.has(to)) {
      return res.status(409).json({ error: `Location ${to} is already occupied.` });
    }
    occupiedLocations.set(to, awbInfo);
    action = "STORE";
  } else if (fromType === "VNA" && toType === "PICKUP") {
    occupiedLocations.delete(from);
    action = "RETRIEVE";
  } else if (fromType === "VNA" && toType === "VNA") {
    const existing = occupiedLocations.get(from) || awbInfo;
    occupiedLocations.delete(from);
    occupiedLocations.set(to, { ...existing, timestamp: new Date().toISOString() });
    action = "RELOCATE";
  }

  const movement = {
    awbNumber,
    sph: sph || "",
    pieces: awbInfo.pieces,
    weight: awbInfo.weight,
    fromLocation: from,
    toLocation: to,
    action,
    timestamp: new Date().toISOString(),
    status: "active",
  };

  movementLog.unshift(movement);
  if (movementLog.length > 200) movementLog.length = 200;

  // Push to all SSE clients (Raspberry Pi monitors, dashboards)
  broadcastSSE("movement", movement);
  broadcastSSE("status", buildSnapshot());

  console.log(`[FPS] ${action}: ${awbNumber} | ${from} → ${to}`);

  res.json({ success: true, action, movement, snapshot: buildSnapshot() });
});

// POST /api/reset — clear all state
app.post("/api/reset", (req, res) => {
  occupiedLocations.clear();
  movementLog.length = 0;
  broadcastSSE("reset", buildSnapshot());
  console.log("[RESET] All data cleared.");
  res.json({ success: true, snapshot: buildSnapshot() });
});

// GET /api/locations — list all valid locations
app.get("/api/locations", (req, res) => {
  res.json({
    vnaLocations,
    dropLocations: [...CONFIG.dropLocations],
    pickupLocations: [...CONFIG.pickupLocations],
  });
});

/* ═══════════════════════════════════════════════════════
   START
   ═══════════════════════════════════════════════════════ */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  ╔══════════════════════════════════════════════════╗`);
  console.log(`  ║  VNA Cooler Room API Server                      ║`);
  console.log(`  ╠══════════════════════════════════════════════════╣`);
  console.log(`  ║  Dashboard:  http://localhost:${PORT}/              ║`);
  console.log(`  ║  Monitor:    http://localhost:${PORT}/monitor.html  ║`);
  console.log(`  ║  API Status: http://localhost:${PORT}/api/status    ║`);
  console.log(`  ║  SSE Stream: http://localhost:${PORT}/api/events    ║`);
  console.log(`  ╚══════════════════════════════════════════════════╝\n`);
});
