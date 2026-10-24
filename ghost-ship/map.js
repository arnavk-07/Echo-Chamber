// Ghost Ship layout: rooms and corridors carved by coordinates (tile units).
const TILE = 32;
const MAP_W = 64;
const MAP_H = 42;

function buildShip() {
  const grid = [];
  for (let y = 0; y < MAP_H; y++) grid.push(new Array(MAP_W).fill(1));
  const carve = (x, y, w, h) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) grid[j][i] = 0;
  };

  const rooms = [
    { name: 'CAFETERIA', x: 26, y: 2, w: 12, h: 9 },
    { name: 'WEAPONS', x: 44, y: 3, w: 9, h: 7 },
    { name: 'NAVIGATION', x: 54, y: 16, w: 8, h: 9 },
    { name: 'SHIELDS', x: 44, y: 30, w: 9, h: 8 },
    { name: 'STORAGE', x: 26, y: 30, w: 12, h: 9 },
    { name: 'ELECTRICAL', x: 14, y: 24, w: 9, h: 8 },
    { name: 'REACTOR', x: 2, y: 15, w: 8, h: 10 },
    { name: 'ENGINE', x: 12, y: 3, w: 9, h: 8 },
    { name: 'MEDBAY', x: 14, y: 14, w: 8, h: 6 },
    { name: 'ADMIN', x: 40, y: 17, w: 9, h: 7 },
  ];
  for (const r of rooms) carve(r.x, r.y, r.w, r.h);

  // Corridors
  carve(21, 5, 5, 3);   // cafeteria - engine
  carve(38, 5, 6, 3);   // cafeteria - weapons
  carve(31, 11, 3, 19); // central hall down to storage
  carve(34, 19, 6, 3);  // hall - admin
  carve(49, 19, 5, 3);  // admin - navigation
  carve(53, 5, 6, 3);   // weapons east
  carve(56, 8, 3, 8);   // down to navigation
  carve(56, 25, 3, 8);  // navigation - shields
  carve(53, 31, 6, 3);
  carve(38, 33, 6, 3);  // shields - storage
  carve(23, 30, 3, 2);  // storage - electrical
  carve(5, 25, 3, 4);   // reactor - electrical
  carve(5, 28, 9, 3);
  carve(5, 7, 3, 8);    // reactor - engine
  carve(5, 7, 7, 3);
  carve(22, 16, 9, 3);  // medbay - hall
  carve(16, 11, 3, 3);  // engine - medbay

  return {
    grid,
    rooms,
    playerStart: [32, 7],
    ghostStart: [48, 34],
    escapePod: [32, 3],
    workbench: [28, 4],
    tasks: [
      { name: 'Align Engine Output', room: 'ENGINE', x: 16, y: 4, type: 'slider' },
      { name: 'Restart Reactor', room: 'REACTOR', x: 3, y: 19, type: 'simon' },
      { name: 'Calibrate Scanner', room: 'MEDBAY', x: 18, y: 16, type: 'timing' },
      { name: 'Fix Wiring', room: 'ELECTRICAL', x: 15, y: 27, type: 'wires' },
      { name: 'Fuel Engines', room: 'STORAGE', x: 35, y: 36, type: 'fuel' },
      { name: 'Prime Shields', room: 'SHIELDS', x: 48, y: 36, type: 'hexes' },
      { name: 'Chart Course', room: 'NAVIGATION', x: 60, y: 20, type: 'waypoints' },
      { name: 'Enter Admin Code', room: 'ADMIN', x: 44, y: 18, type: 'keypad' },
      { name: 'Clear Asteroids', room: 'WEAPONS', x: 50, y: 4, type: 'asteroids' },
    ],
    // UV Flash parts, crafted at the Cafeteria workbench
    parts: [
      { kind: 'battery', x: 16, y: 30 },
      { kind: 'bulb', x: 20, y: 15 },
      { kind: 'wire', x: 13, y: 4 },
    ],
    // bear: snaps shut (disarm + reuse vs the ghost) · tripwire: alarm (crouch over / cut)
    // shock: stuns (kill it at its fuse switch) · creak: loud unless you crouch
    traps: [
      { type: 'creak', x: 34, y: 9 },
      { type: 'bear', x: 17, y: 8 },
      { type: 'tripwire', x: 6, y: 21 }, { type: 'bear', x: 4, y: 17 },
      { type: 'tripwire', x: 18, y: 18 },
      { type: 'shock', x: 18, y: 29, sw: [22, 25] },
      { type: 'bear', x: 30, y: 34 }, { type: 'creak', x: 35, y: 32 },
      { type: 'shock', x: 47, y: 33, sw: [52, 36] },
      { type: 'creak', x: 57, y: 22 },
      { type: 'tripwire', x: 45, y: 22 },
      { type: 'shock', x: 47, y: 7, sw: [44, 8] },
      { type: 'bear', x: 32, y: 24 }, { type: 'creak', x: 32, y: 14 },
    ],
    clues: [
      { x: 19, y: 9, text: 'LOG: "She is almost blind in the dark, but she HEARS everything. Hold C to crouch and move silently. Running is loud."' },
      { x: 15, y: 18, text: 'Sticky note: "ADMIN KEYPAD CODE: {CODE}. Don\'t forget it."' },
      { x: 27, y: 37, text: 'LOG: "Bear traps everywhere. Crouch beside one and hold E to disarm it, then press G to set it for HER."' },
      { x: 60, y: 24, text: 'LOG: "Crouch to step over tripwires, or hold E to cut them. Fuse switches kill the shock floors."' },
      { x: 51, y: 8, text: 'LOG: "I was building a UV flash at the Cafeteria workbench. Battery in Electrical, bulb in MedBay, wire in Engine. The light stuns her."' },
      { x: 47, y: 20, text: 'LOG: "Never hide while she is watching. If she hears something near a vent, she checks inside."' },
    ],
    vents: [[27, 9], [13, 9], [8, 16], [21, 15], [21, 30], [36, 31], [51, 31], [55, 17], [41, 22], [45, 4]],
  };
}

if (typeof module !== 'undefined') module.exports = { buildShip, MAP_W, MAP_H, TILE };
