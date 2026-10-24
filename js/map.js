// Facility layout. Rooms are carved out of solid rock by coordinates so the
// walls stay aligned and the level is easy to tweak.
const TILE = 32;
const MAP_W = 60;
const MAP_H = 40;

function buildFacility() {
  const grid = []; // 1 = wall, 0 = floor
  const zone = []; // '' | 'vent' (masks noise) | 'water' (louder steps)
  for (let y = 0; y < MAP_H; y++) {
    grid.push(new Array(MAP_W).fill(1));
    zone.push(new Array(MAP_W).fill(''));
  }
  const fill = (x, y, w, h, v) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) grid[j][i] = v;
  };
  const carve = (x, y, w, h) => fill(x, y, w, h, 0);
  const wall = (x, y, w, h) => fill(x, y, w, h, 1);
  const setZone = (x, y, w, h, z) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) zone[j][i] = z;
  };

  // Hub (start) and corridors to each wing
  carve(24, 15, 12, 9);
  carve(29, 8, 2, 7);   // north
  carve(14, 19, 10, 2); // west
  carve(36, 17, 10, 2); // east
  carve(29, 24, 2, 6);  // south

  // Cryo wing (north): vent hiss masks your noise in the side rooms
  carve(14, 2, 32, 7);
  wall(22, 2, 1, 7); carve(22, 5, 1, 1);
  wall(37, 2, 1, 7); carve(37, 3, 1, 1);
  wall(26, 4, 2, 2); wall(32, 4, 2, 2);
  setZone(14, 2, 8, 7, 'vent');
  setZone(38, 2, 8, 7, 'vent');

  // Server wing (west): rows of racks
  carve(2, 10, 12, 22);
  for (const y of [13, 17, 21, 25, 29]) wall(4, y, 7, 1);

  // Flooded wing (east): drips reveal for free, splashing is loud
  carve(46, 10, 12, 22);
  wall(46, 21, 12, 1); carve(49, 21, 1, 1); carve(55, 21, 1, 1);
  wall(51, 10, 1, 11); carve(51, 14, 1, 1);
  setZone(46, 22, 12, 10, 'water');

  // Exit hall (south)
  carve(24, 30, 12, 7);

  return {
    grid,
    zone,
    playerStart: [29, 19],
    creatureStart: [55, 15],
    exit: [29, 36],
    lockers: [[25, 16], [34, 22], [20, 8], [40, 8], [30, 2], [2, 15], [13, 24], [2, 30],
              [50, 20], [57, 16], [46, 26], [25, 31], [34, 35]],
    radios: [[35, 7], [12, 12], [53, 27]],
    throwables: [[27, 22], [32, 16], [24, 3], [44, 5], [3, 20], [12, 28], [49, 13], [55, 24], [27, 34]],
    keyCandidates: {
      red: [[7, 11], [7, 23], [7, 31], [5, 27]],
      blue: [[16, 3], [16, 7], [43, 3], [43, 7]],
      green: [[47, 11], [56, 11], [56, 30], [47, 30]],
    },
    emitters: [
      { x: 17, y: 4, type: 'vent' }, { x: 42, y: 6, type: 'vent' }, { x: 30, y: 3, type: 'vent' },
      { x: 48, y: 24, type: 'drip' }, { x: 54, y: 28, type: 'drip' }, { x: 50, y: 30, type: 'drip' },
      { x: 56, y: 23, type: 'drip' },
      { x: 8, y: 15, type: 'hum' }, { x: 8, y: 23, type: 'hum' }, { x: 8, y: 27, type: 'hum' },
    ],
    // UV Flash: carry each part to the hub workbench, then assemble it.
    workbench: [34, 18],
    parts: [
      { part: 'battery', x: 10, y: 31 },
      { part: 'bulb', x: 20, y: 3 },
      { part: 'wire', x: 53, y: 17 },
    ],
    // Escape clues. `reveal` marks a target on the player's screen once read.
    notes: [
      { x: 31, y: 18, reveal: 'exit', title: 'EVACUATION NOTICE',
        text: 'FACILITY LOCKDOWN. The only way out is the EXIT door in the hall SOUTH of this hub. It has three card readers: RED, BLUE and GREEN. Bring one keycard to each reader, then run the override.' },
      { x: 30, y: 13, reveal: 'blue', title: "DR. HALE'S LOG",
        text: 'The keycards are locked inside terminals. RED: Server Wing (west). BLUE: Cryo Wing (north). GREEN: Flooded Wing (east). Each terminal needs a puzzle solved. I marked the BLUE one for you.' },
      { x: 29, y: 6, reveal: 'red', title: 'TORN PAGE',
        text: 'She is blind. She hunts by SOUND. Every sonar pulse, footstep and dropped keycard can bring her. Sneak (C) and she will not hear your steps. The RED terminal is between the server racks.' },
      { x: 3, y: 18, reveal: 'green', title: 'MAINTENANCE MEMO',
        text: 'Shock floors: pull the FUSE switch nearby. Tripwires: sneak over them or cut them. A disarmed bear trap can be set for HER. The GREEN terminal is past the flooded floor in the east wing.' },
      { x: 47, y: 19, title: "CHILD'S DRAWING",
        text: 'she sings when she walks. if you hear the music box, HIDE in a locker and hold your breath (F). she cannot see you. she can only hear you.' },
      { x: 43, y: 18, title: 'SCRIBBLED NOTE',
        text: 'You can only carry ONE thing. Throw a bottle or switch on a radio far away. She goes to the noise. THAT is when you carry the keycard to the door.' },
      { x: 34, y: 16, title: 'PROTOTYPE: UV FLASH',
        text: 'Her eyes are dead, but UV light still burns her. Build the flash at THIS workbench: BATTERY (server wing), UV BULB (cryo wing), COPPER WIRE (flooded wing). Carry them here one at a time. Aim with the mouse and press F: she is stunned for 30 seconds.' },
      { x: 33, y: 33, reveal: 'exit', title: 'SECURITY OVERRIDE',
        text: 'When all three readers glow, press E at the door and run the LOCKDOWN OVERRIDE: light every cell. Then the door opens. Do not let her catch you on the way.' },
    ],
    // bear: snaps shut (disarm + reuse vs the creature) · tripwire: alarm (sneak over / cut)
    // shock: stuns (kill it at its fuse switch) · creak: loud unless you sneak
    traps: [
      { type: 'creak', x: 26, y: 17 }, { type: 'creak', x: 32, y: 21 },
      { type: 'tripwire', x: 29, y: 11 },
      { type: 'bear', x: 25, y: 7 }, { type: 'shock', x: 40, y: 4, sw: [44, 8] }, { type: 'creak', x: 18, y: 6 },
      { type: 'bear', x: 12, y: 16 }, { type: 'tripwire', x: 3, y: 23 }, { type: 'shock', x: 12, y: 27, sw: [2, 26] },
      { type: 'creak', x: 7, y: 19 }, { type: 'bear', x: 18, y: 19 },
      { type: 'tripwire', x: 48, y: 17 }, { type: 'bear', x: 54, y: 26 }, { type: 'shock', x: 50, y: 28, sw: [57, 30] },
      { type: 'creak', x: 55, y: 12 }, { type: 'creak', x: 40, y: 17 },
      { type: 'tripwire', x: 29, y: 26 }, { type: 'bear', x: 27, y: 33 }, { type: 'creak', x: 32, y: 32 },
    ],
    waypoints: [[29, 19], [18, 5], [30, 6], [42, 4], [3, 12], [12, 22], [3, 30],
                [48, 15], [55, 16], [52, 27], [29, 33]],
  };
}

if (typeof module !== 'undefined') module.exports = { buildFacility, MAP_W, MAP_H, TILE };
