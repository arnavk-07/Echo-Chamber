# Echo Chamber

> **Genre:** Horror / Audio-Visual Survival · **Team:** Clutch · **Doc version:** v1 (2026-10-17)

## 1. Pitch

You wake up in a pitch-black, abandoned research lab. You can't see anything except what your **sonar pulse** shows you: a brief, glowing outline of walls, doors and objects that fades after a few seconds. Every pulse is also a **sound**, and something blind is hunting the facility by ear. To get out, find **three keycards** in three wings, use thrown objects and radios to **lure the creature away**, **hide** when it comes close, and reach the **exit**.

**The core tension:** you can't see without making noise, and making noise gets you killed.

---

## 2. Reference games: what each one teaches us

| Game | Year | Why it matters | What we borrow |
|---|---|---|---|
| **Dark Echo** | 2015 | Top-down, fully black world. Sound waves are drawn as lines, and your own footsteps both reveal the world and attract monsters. | The visual language: sound drawn as light, red waves for danger. Top-down 2D keeps scope small. |
| **Stifled** | 2017 | Echolocation driven by the player's real microphone. Noise shows the world and also summons enemies. | Our exact core trade-off. Optional **mic mode** (stretch goal). |
| **Perception** | 2017 | Blind protagonist who sees by tapping a cane. Tapping too often summons "The Presence". | Punishing pulse spam. Hiding spots as a safety valve. |
| **Scanner Sombre** | 2017 | A LIDAR point cloud gradually builds a picture of the world. | Rendering style: echo **points/lines that persist, then fade**. |
| **Alien: Isolation** | 2014 | The hunter AI is split into a creature "brain" and a "director" that roughly knows where you are. Using the motion tracker makes noise. Noisemakers, lockers, holding your breath. | Creature FSM plus a **Director** layer, distraction items, hiding in lockers with a breath-hold mechanic. |
| **Amnesia: The Bunker** | 2023 | Cranking the dynamo flashlight makes noise the Beast can hear. Semi-open map with key items scattered around it. | A light-versus-noise trade-off that matches our pulse. Keycards can be collected in **any order**. |
| **Lethal Company** | 2023 | Eyeless Dogs are blind and hunt by sound. You collect loot in a dark facility, then extract. | A **blind, sound-hunting creature**. The "collect, then escape" loop. |
| **A Quiet Place: The Road Ahead** | 2024 | Noise meter on the HUD, and optional detection through the player's real microphone. | **Noise meter** UI and the optional mic idea. |
| **Iron Lung** | 2022 | Tiny scope, very little information, intense dread. | Proof that **information scarcity alone creates horror**. Keep it short. |

---

## 3. Horror trends from 2024 to 2026, and how we use them

| Trend | Examples | How Echo Chamber uses it |
|---|---|---|
| **Short, focused indie horror** | Mouthwashing, Iron Lung, Puppet Combo titles | A run lasts **15–25 minutes**. We put polish ahead of size. |
| **Lo-fi / retro presentation** | PS1 / VHS / analog-horror look | Our whole art style is a black screen with glowing vector lines, film grain and scanlines. It's cheap to make and still looks distinctive. |
| **Real voice or mic as gameplay** | Don't Scream, A Quiet Place: TRA, Lethal Company proximity chat | Optional **"shout to pulse"**: a louder voice gives a bigger pulse and also more noise (stretch goal). |
| **Moments that work in streams and clips** | Lethal Company, R.E.P.O., Content Warning | A **death replay** shows the full map, the creature's path and the noise that gave you away. A shareable **run card** shows time, pulses used and a "Ghost" rating. |
| **Systemic AI instead of scripted scares** | Alien: Isolation, Amnesia: The Bunker | Encounters come from the noise model plus the AI. There are only 1–2 scripted moments (the intro and the finale alarm). |
| **Replayability** | Roguelite runs, daily seeds | Each wing has a **pool of possible spawn spots** for its keycard, so every run is different. A daily seed is a stretch goal. |
| **Accessibility and audio-first design** | TLOU2-style accessibility options | Visual captions for sounds, keycards that differ by **shape as well as colour**, a flash-reduction option, remappable keys. |
| **Diegetic UI** | Dead Space, the Alien: Isolation tracker | A **wrist scanner** shows keycards, pulse charge and a noise meter instead of a floating HUD. |

> **Not in scope: co-op.** It's the biggest current trend (Lethal Company, R.E.P.O.), but networking would double our scope. It's listed as a stretch goal only.

---

## 4. Design pillars

1. **Information costs noise.** Every bit of visibility has a price.
2. **Sound is sight, for both sides.** The creature is blind and hunts by sound. When *it* makes noise (footsteps, growls), that noise briefly shows *it* to you.
3. **Fair fear.** No threat kills you without first being telegraphed by a sound you could have heard.
4. **Small and polished.** One facility, one creature, done well.

---

## 5. Core loop

```
          ┌──────────────────────────────────────────────┐
          ▼                                              │
   [Listen / Sneak in darkness]                          │
          │  need info?                                  │
          ▼                                              │
   [Sonar pulse]  ──► reveals map for ~3.5 s             │
          │        ──► emits NOISE                       │
          ▼                                              │
   [Creature reacts?] ──no──► [Navigate from memory] ────┤
          │yes                                           │
          ▼                                              │
   [Hide / Distract / Run] ──survive──► [Grab keycard] ──┘
          │caught                           │ 3/3
          ▼                                 ▼
   [Death replay → checkpoint]      [Exit unlock → alarm chase → ESCAPE]
```

---

## 6. Mechanics specification

### 6.1 Controls and movement

| Action | Input | Speed | Noise radius (tiles, measured along paths) |
|---|---|---|---|
| Sneak | Hold `C` (not Ctrl: Ctrl+W closes the browser tab) | 60 px/s | 0 |
| Walk | `WASD` | 120 px/s | 2 |
| Run | Hold `Shift` | 200 px/s | 6 |
| Tap pulse ("click") | Tap `Space` | — | 5 |
| Charged pulse ("ping") | Hold `Space` (up to 1.2 s), release | — | 8 → 14, scales with charge |
| Throw object | Aim with mouse, `LMB` | — | 10 at the **impact point** |
| Place / toggle radio | `E` near a radio, or `R` to drop one | — | 9 at the radio, looping for 12 s |
| Hide / leave hiding spot | `E` at a locker or desk | — | 3 |
| Hold breath (while hidden) | Hold `F` | — | Cancels breathing noise and drains the breath bar |
| Pick up keycard | `E` | — | 4 |

### 6.2 Sonar pulse

- **Tap:** range 160 px, cooldown 1.0 s. Cheap and quiet. Good for checking what's directly around you.
- **Charged:** range 160 → 480 px, cooldown 2.5 s. Reveals a lot and is loud.
- **Expanding ring:** the wavefront travels at 600 px/s. A surface lights up when the ring *reaches* it, which is what gives the pulse its wave feel.
- **Echo fade:** revealed outlines fade from alpha 1 to 0 over **3.5 s**, so the player has to navigate from memory.
- **Colour coding:**
  - Walls: cyan/white
  - Interactables (lockers, radios, throwables): amber
  - Keycards: their own colour **and** shape (■ red, ▲ blue, ● green)
  - Exit: green
  - Creature: **red**
- **Passive reveals (free information):** dripping pipes, sparking wires and ventilation fans emit small periodic echoes. Players who pay attention can learn the map without pulsing.
- **Creature footsteps** emit small red echoes every ~0.5 s. You can "see" it when it moves and lose it when it stands still.
- A faint **24 px glow** always surrounds the player, so they never lose track of their own position.

### 6.3 Noise model

- Every action publishes `NoiseEvent { pos, radius, source, timestamp }` on an event bus.
- Propagation uses **BFS distance over walkable tiles**, not straight-line distance. Sound travels down corridors and around corners, and solid walls block it.
- The creature hears a noise if `pathDistance ≤ radius × hearingMultiplier`.
- **Priority:** `intensity = radius − pathDistance`. A louder or closer noise overrides the current target, which is what makes distractions work.
- **Masking zones:** vent-hiss and server-hum areas lower the player's noise radius by 3. **Splash zones** (flooded floors) raise it by 3.

### 6.4 Creature AI (blind, hunts by sound)

```
        ┌─────────┐  hears noise   ┌─────────────┐  arrives   ┌─────────┐
        │ PATROL  │ ─────────────► │ INVESTIGATE │ ─────────► │ SEARCH  │
        └─────────┘                └─────────────┘            └─────────┘
             ▲   louder noise ──► (retarget)    ▲  new noise      │ 6–10 s,
             │                                  └─────────────────┤ nothing
             │                                                    ▼
             │   lost track (player silent 3 s)              back to PATROL
             │  ┌─────────┐ ◄──────── noise within 5 tiles ─── (any state)
             └──│  CHASE  │
                └─────────┘ ── contact & player not hidden ──► KILL
```

| State | Speed | Behaviour |
|---|---|---|
| PATROL | 80 px/s | Walks between waypoints that the Director picks. |
| INVESTIGATE | 140 px/s | Paths with A* to the position of the highest-priority noise. |
| SEARCH | 90 px/s | Wanders to random points within 4 tiles of where the noise came from. |
| CHASE | 190 px/s | Follows the player's live position for as long as the player keeps making noise. Starts with a **growl** (the telegraph). |

- Running (200 px/s) is just faster than the creature's chase speed (190 px/s). The player can break away, but running is loud, so it keeps hearing them.
- **Hiding:** if the creature passes a locker and the player is silent (holding breath), it moves on. If the breath bar runs out, the player gasps (noise 4) and the creature finds them.

**Director** (Alien: Isolation style). It re-evaluates every 10 s:
- If the creature has been more than 25 path-tiles from the player for over 45 s, it moves the patrol waypoints into the player's **wing**. It never sends the creature to the player's exact position.
- After a chase or a close call, it adds a 20 s **cool-down** during which the creature is sent away.
- Each keycard collected raises hearing by 10% and creature speed by 5%. Difficulty ramps up as the run goes on.

### 6.5 Distractions

- **Throwables** (bottles, cans, wrenches): 0–3 carried at once, found around the map. They follow an aim arc and make a noise of 10 **where they land**. A throw also makes a small passive echo at the impact point.
- **Radios:** a loop of static and music at noise 9 for 12 s. You can pick it up again and reuse it. It has 3 battery charges.
- **Alarm panel** (one per wing, single use): noise 20 across the wing. A huge lure, but it raises tension for 30 s.
- **Emergent combo:** start a radio, walk away, *then* use a charged pulse. The radio's noise has higher priority than the pulse and covers it.

### 6.6 Hiding

- **Lockers:** fully hidden. You can only see through the slats (a narrow cone of passive vision lit by the creature's footsteps).
- **Under desks:** partly hidden. Safe if the creature isn't within 1 tile.
- **Breath bar:** lasts 6 s and refills in 4 s.

### 6.7 Level layout

```
              ┌──────────────┐
              │  CRYO WING   │  (vent hiss = masking zone, BLUE ▲)
              └──────┬───────┘
┌──────────────┐ ┌───┴────┐ ┌──────────────┐
│ SERVER WING  ├─┤  HUB   ├─┤ FLOODED WING │
│ (hum, RED ■) │ │ (start)│ │(drips = free │
└──────────────┘ └───┬────┘ │ reveals, but │
                     │      │ splashing    │
                ┌────┴───┐  │ GREEN ●)     │
                │  EXIT  │  └──────────────┘
                └────────┘
```

- Each wing has its own **sound** (it doubles as navigation information) and its own **risk profile**.
- Each keycard spawns in 1 of 3–4 candidate spots in its wing, chosen randomly per run.
- The map is about 80×60 tiles at 32 px per tile, built in **Tiled** with layers `walls`, `floor_zones`, `objects`, `waypoints`.

### 6.8 Exit and finale

Swiping all three keycards at the exit starts a **90 s lockdown override**. An alarm sounds, the creature goes straight into CHASE, and the emergency strip lights give a little permanent visibility. Survive until the door opens. It's the one scripted set-piece in the game.

### 6.9 Failure and checkpoints

- **Caught:** a 4 s **death replay** (full map revealed, the creature's path, the noise that gave you away). Then you respawn at the last checkpoint. The hub counts as a checkpoint, and so does each keycard pickup.
- **Run stats:** time, pulses used, times detected, deaths. The **"Ghost" rating** is awarded for 0 detections.

### 6.10 HUD and audio cues

- **Wrist scanner** (bottom-left): keycard slots, pulse charge ring, noise meter showing how loud you currently are.
- **Heartbeat:** its tempo follows the creature's path distance from the player. This is audio-only, with no map marker.
- **Spatial audio:** left/right panning by x offset, distance-based gain, and a low-pass "muffle" when a wall blocks line of sight.
- **Captions:** small directional glyphs for important sounds (an accessibility setting).

---

## 7. Player strategies (what a good run looks like)

These are the strategies we're designing *for*. Playtests should confirm players discover them.

1. **Pulse from safety.** Stand next to a locker, use a charged pulse, and hide right away if you hear a growl.
2. **Read the free echoes.** Drips, sparks and the creature's own footsteps show the map without costing you any noise.
3. **Lure, then look.** Throw a bottle or start a radio far away, wait for the creature's footsteps to move toward it, *then* pulse.
4. **Use masking zones.** Pulse inside a vent-hiss area to cut the noise you make.
5. **Tap more than you charge.** Short clicks for close-range checks. Save charged pings for planning a route through a new room.
6. **Memorise and commit.** Pulse once, plan the route, then walk it in darkness.
7. **Save one distraction for the finale.** A radio dropped near the exit buys you seconds during the lockdown.

---

## 8. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** | Type safety across a 3–4 person team. |
| Engine | **Phaser 3** (latest 3.x) | Mature 2D framework with tilemaps, input, scenes and post-FX glow. Runs in the browser, which makes it easy to demo and share. |
| Build | **Vite** | Instant hot reload and a simple static build. |
| Maps | **Tiled** (exported as JSON) | Phaser loads it natively, so the designer can work independently. |
| Audio | **Web Audio API** (a small `AudioManager` wrapper) | `StereoPannerNode`, `GainNode` and `BiquadFilterNode` for panning, falloff and muffling. |
| Pathfinding | A* on the tile grid, written ourselves (~100 LOC) | The grid is small, and keeping it in-house makes it easy to test with no dependencies. |
| Tests | **Vitest** | Unit tests for geometry, noise and the AI. |
| Quality | ESLint + Prettier, GitHub Actions (build + test) | Keeps `main` green. |
| Deploy | GitHub Pages or itch.io (HTML5) | Anyone can open a link and play. |

> If the team strongly prefers an engine, **Godot 4** maps onto the same architecture one-to-one (scenes for the entities, `RayCast2D` for sonar, `AudioStreamPlayer2D` for spatial audio).

---

## 9. Project structure

```
echo-chamber/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── public/
│   └── assets/
│       ├── maps/facility.json          # Tiled export
│       ├── audio/{sfx,ambience,music}/
│       └── sprites/                    # minimal: icons, UI
├── src/
│   ├── main.ts                         # Phaser game config
│   ├── config.ts                       # ALL tuning constants (see §12)
│   ├── scenes/
│   │   ├── BootScene.ts                # preload, "wear headphones" + click-to-start (unlocks AudioContext)
│   │   ├── MenuScene.ts
│   │   ├── GameScene.ts                # world, systems wiring
│   │   ├── HudScene.ts                 # wrist scanner, captions (runs in parallel)
│   │   ├── DeathReplayScene.ts
│   │   └── WinScene.ts                 # run card
│   ├── systems/
│   │   ├── SonarSystem.ts              # pulse, ring, echo buffer, rendering
│   │   ├── NoiseSystem.ts              # event bus + BFS propagation
│   │   ├── AudioManager.ts             # spatial audio, heartbeat, ambience
│   │   ├── PassiveEmitters.ts          # drips, sparks, vents
│   │   ├── CheckpointSystem.ts
│   │   └── RunStats.ts
│   ├── entities/
│   │   ├── Player.ts
│   │   ├── Creature.ts
│   │   ├── Throwable.ts
│   │   ├── Radio.ts
│   │   ├── Keycard.ts
│   │   ├── HideSpot.ts
│   │   └── ExitDoor.ts
│   ├── ai/
│   │   ├── CreatureBrain.ts            # FSM
│   │   ├── Director.ts
│   │   └── AStar.ts
│   ├── level/
│   │   ├── LevelLoader.ts              # Tiled → grid, entities, zones, waypoints
│   │   └── KeycardSpawner.ts           # random pick from candidate spots
│   ├── debug/DebugOverlay.ts           # toggle with ` : full map, AI state, noise radii, paths
│   └── utils/
│       ├── raycast.ts                  # DDA grid raycast
│       ├── grid.ts                     # BFS, neighbours
│       └── events.ts                   # typed event bus
├── tests/
│   ├── raycast.test.ts
│   ├── noise.test.ts
│   ├── astar.test.ts
│   └── creatureBrain.test.ts
├── CREDITS.md                          # audio/asset licences
└── project.md
```

---

## 10. Key algorithms

### 10.1 Sonar raycast

1. When a pulse fires, cast **N rays** (tap: 120, charged: 360) evenly around the player.
2. Each ray uses **DDA grid traversal** through the wall layer until it hits a solid tile or reaches the pulse range. It returns the exact hit point and the side of the tile it hit.
3. Each ray is also tested against nearby **entity shapes** (circles/rects) within range. The nearest hit wins and is tagged with that entity's type, which decides its colour.
4. Each hit is pushed into a pooled **echo buffer** (max ~4,000 entries) as `{x, y, type, revealAt = now + dist/ringSpeed, fadeEnd = revealAt + 3.5 s}`.
5. **Render** with one `Phaser.GameObjects.Graphics` that is redrawn every frame:
   - Neighbouring rays that hit the same surface within ~1 tile are joined into **line segments**, so walls appear as outlines rather than dots.
   - Additive blending plus Phaser's `postFX.addGlow()` give the neon look.
   - A grain/scanline overlay sits on top.

### 10.2 Noise propagation

```ts
// Pseudocode
onNoise(e: NoiseEvent) {
  const d = bfsPathDistance(grid, tileOf(e.pos), tileOf(creature.pos), e.radius * hearingMult);
  if (d === Infinity) return;                 // too far or blocked
  creature.brain.hear({ pos: e.pos, intensity: e.radius - d, t: now });
}
```

BFS stops early once it passes `radius × hearingMult` tiles, so each event costs far less than a full-grid search. To show the noise meter and captions, run the same BFS outward from the player.

### 10.3 Creature brain

- An explicit FSM class: `enter / update / exit` per state, and `hear(stimulus)` as the only input. This makes it testable without Phaser.
- The current target is replaced when a new stimulus arrives with higher intensity, or with similar intensity but more recently.
- Paths are recomputed only when the target tile changes, or every 0.5 s while chasing.

---

## 11. Implementation plan

The estimates assume **3 weeks** with a 3–4 person team. For a **48-hour jam**, ship M0–M4 at reduced scope: one wing per keycard, no Director, no death replay.

| Milestone | Days | Deliverables | Done when… |
|---|---|---|---|
| **M0: Foundation** | 1 | Vite + TS + Phaser scaffold, lint/format, CI, deploy pipeline, a lit **greybox** map from Tiled, player movement, debug overlay | The player walks around a visible greybox map at a public URL. |
| **M1: Sonar** | 2–4 | Darkness, DDA raycast, expanding ring, echo buffer with fade, colour tagging, tap vs. charged pulse, cooldowns, player glow | In total darkness, a pulse reveals walls and objects as a wave, and they fade out. |
| **M2: Noise and creature** | 4–8 | Noise event bus, BFS propagation, A*, creature FSM, footstep echoes, growl telegraph, kill and restart, unit tests | The creature reliably investigates pulses, chases a running player, and loses a silent one. |
| **M3: Survival toolkit** | 8–10 | Sneak/walk/run noise, throwables with aim arc, radios, lockers and desks, breath bar, masking/splash zones | A playtester can lure the creature away and survive a pass-by while hidden. |
| **M4: Objectives and level** | 10–12 | The three-wing map, keycards with randomised spawn pools, exit door, lockdown finale, checkpoints, Director, escalation per keycard | A complete run from start to escape is possible in 15–25 min. |
| **M5: Audio and UX polish** | 12–14 | Spatial audio and muffling, heartbeat, wing ambiences, passive emitters, menus, settings (volume, mouse sensitivity, accessibility), wrist-scanner HUD, death replay, run card | New players understand the controls without a verbal explanation. |
| **M6: Playtest and ship** | 14–15 | 5+ external playtests, tuning pass, bug bash, final build, GIF/trailer, README | No blocker bugs. The median first-run time is in the target range. |

### Work breakdown by area

- **Sonar and rendering:** DDA raycast → echo buffer → ring timing → line joining → glow/grain FX → entity tagging → performance pass (pooling, ray count).
- **AI:** grid from Tiled → BFS → A* → FSM states → hearing and priority → footsteps and growl → Director → escalation → debug visualisation.
- **Level and audio:** greybox → three wings → hide spots and items → candidate keycard spots → masking/splash zones → passive emitters → wing ambience → final art pass (lines and lighting only).
- **UI/UX:** boot/menu → HUD → captions → settings → death replay → run card → accessibility options.

---

## 12. Team roles (suggested)

| Role | Owns | Also helps with |
|---|---|---|
| **Gameplay and Sonar Lead** | Player, SonarSystem, rendering/FX | Throwables and radios |
| **AI Engineer** | NoiseSystem, CreatureBrain, Director, A*, tests | Finale chase |
| **Level and Audio Designer** | Tiled map, zones, AudioManager, sound design and mix | Playtest sessions |
| **UI/UX and Producer** | Scenes, HUD, settings, accessibility, CI/deploy, playtest logistics, this doc | Death replay, run card |

With **3 people**, merge UI/UX into Level and Audio. The AI Engineer takes over CI/deploy.

---

## 13. Tuning constants (`src/config.ts`)

All of these are adjustable live from the debug overlay during playtests.

```ts
export const TILE = 32;
export const PLAYER  = { sneak: 60, walk: 120, run: 200, glowRadius: 24 };
export const NOISE   = { sneak: 0, walk: 2, run: 6, tap: 5, pingMin: 8, pingMax: 14,
                         throwImpact: 10, radio: 9, alarm: 20, hide: 3, pickup: 4, gasp: 4,
                         maskingDelta: -3, splashDelta: +3 };
export const SONAR   = { tapRange: 160, pingRange: 480, chargeTime: 1.2, tapCooldown: 1.0,
                         pingCooldown: 2.5, ringSpeed: 600, fade: 3.5, raysTap: 120, raysPing: 360 };
export const CREATURE = { patrol: 80, investigate: 140, search: 90, chase: 190,
                          chaseTriggerTiles: 5, loseTrackSec: 3, searchSec: [6, 10],
                          hearingMult: 1.0, perKeycardHearing: 0.10, perKeycardSpeed: 0.05 };
export const DIRECTOR = { tickSec: 10, farTiles: 25, farSec: 45, cooldownSec: 20 };
export const HIDE    = { breathSec: 6, breathRefillSec: 4, deskSafeTiles: 1 };
export const RADIO   = { durationSec: 12, charges: 3 };
export const FINALE  = { overrideSec: 90 };
```

---

## 14. Testing and playtest plan

- **Unit tests (Vitest):** DDA hit points on known grids, BFS distances around corners, A* paths and unreachable targets, FSM transitions (hear → investigate → search → patrol, chase → lose track).
- **Debug overlay:** full map, creature state label, noise radii drawn as rings, the current A* path, Director decisions logged on screen.
- **Playtest script:** a 5-minute silent observation, then a short survey:
  - Did you understand what the pulse costs?
  - Did any death feel unfair?
  - Which strategy from §7 did you discover yourself?
- **Metrics to log per run:** time per wing, pulses (tap vs. charged), detections, deaths and their causes, distractions used. Use these to tune §13.
- **Target feel:** about 1–2 close calls per wing, and a first-run death rate of roughly 1–3 deaths.

---

## 15. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Darkness makes the game unreadable or frustrating | High | Playtest in **M1**, not M5. Passive emitters, player glow, and memorable wing audio. |
| The creature feels unfair or random | High | Every kill is preceded by a growl or footsteps. Death replay shows why. Director cool-down. |
| Sonar performance drops on low-end laptops | Medium | Pooled echo buffer, a cap on the ray count, and a single Graphics redraw per frame. Glow can be turned off in settings. |
| The browser blocks audio autoplay | Medium | A click-to-start screen in BootScene resumes the `AudioContext`. |
| Scope creep (co-op, procedural maps) | High | Stretch goals stay in §16 until M4 is done. |
| Audio asset licensing | Low | Only CC0 / CC-BY sources (freesound.org, filtered by licence), jsfxr for UI blips, and our own recordings. Track everything in `CREDITS.md`. |
| Merge conflicts on the map file | Medium | One owner for `facility.json`. Other people propose changes via screenshots or issues. |

---

## 16. Stretch goals (after M4 only)

1. **Mic mode:** `getUserMedia` + `AnalyserNode` RMS. Speaking or shouting triggers a pulse sized to your volume, and also makes that much noise. Opt-in only.
2. **Daily seed:** a seeded RNG for keycard spawns and item placement, plus a shared leaderboard.
3. **A second creature type:** a sighted "Crawler" that is drawn to the *glow* of your pulse instead of its sound, which flips the strategy.
4. **Audio logs:** found tapes that tell the lab's story. Playing one is itself a noise source.
5. **Gamepad support and haptics:** rumble on pulses and on the heartbeat.
6. **Two-player co-op** with proximity voice. This is the biggest one; only attempt it with real slack in the schedule.

---

## 17. Definition of done (mapped to the problem statement)

| Required challenge | Feature that satisfies it | Acceptance test |
|---|---|---|
| Use sonar pulses to reveal a temporary outline of nearby rooms and objects | §6.2 sonar (tap/charged, ring, 3.5 s fade, colour tags) | In full darkness, a pulse outlines walls and objects, which fade within 3.5 s. |
| Find three keycards in different parts of the facility | §6.7 three wings with randomised keycard spawns | Each keycard is in a different wing, and positions change between runs. |
| Use distractions such as thrown objects or radios to lure the creature away | §6.5 throwables, radios, alarm panels, plus noise priority (§6.3) | A thrown bottle or a radio pulls an investigating creature away from the player. |
| Hide, move quietly, and choose when to use another sonar pulse | §6.1 sneak/walk/run noise, §6.6 lockers and breath, pulse cooldowns and costs | A sneaking player is never heard. A hidden, silent player survives a pass-by. |
| Reach the exit after collecting all keycards while avoiding capture | §6.8 exit lock and lockdown finale, §6.9 capture and checkpoints | The exit opens only with 3/3 keycards. Capture triggers a checkpoint respawn. Surviving the override wins the game. |
