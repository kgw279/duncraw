// ============================================================
//  DUNGEON CRAWLER — dungeon.js
//
//  One large tile grid is generated (the "real" dungeon map).
//  Rooms, corridors, and secrets are carved into it.
//  The player experiences it screen-by-screen: each room or
//  corridor segment is its own viewport into the shared grid.
// ============================================================

const Dungeon = (() => {

  // ══════════════════════════════════════════════════════════
  //  TILE TYPES
  // ══════════════════════════════════════════════════════════

  const TILE = {
    VOID:         0,
    FLOOR:        1,
    WALL:         2,
    DOOR:         3,   // generic walkable door tile
    STAIR_DOWN:   4,
    STAIR_UP:     5,
    SECRET_WALL:  6,   // looks like wall, is actually passable once discovered
    CORRIDOR:     7,   // corridor floor (distinct from room floor visually)
  };

  // ══════════════════════════════════════════════════════════
  //  DOOR / EXIT TYPES
  // ══════════════════════════════════════════════════════════

  const EXIT_TYPE = {
    OPEN:        'open',
    DOOR_WOOD:   'door_wood',
    DOOR_STRONG: 'door_strong',
    DOOR_METAL:  'door_metal',
    PORTCULLIS:  'portcullis',
    CREVICE:     'crevice',       // secret
    BRICKED:     'bricked',       // sealed
  };

  const LOCK = { NONE: null, SKULL: 'skull', STAR: 'star' };

  // ══════════════════════════════════════════════════════════
  //  ROOM IDENTITIES
  // ══════════════════════════════════════════════════════════

  const ROOM_IDENTITY = [
    'grand_hall', 'barracks', 'bedchamber', 'worship_room',
    'burial_chamber', 'treasury', 'library', 'kitchen',
    'guardroom', 'prison', 'antechamber', 'armory', 'secret_chamber',
  ];

  const BUILD_QUALITY = ['crude', 'rough', 'standard', 'fine', 'ornate'];

  // ══════════════════════════════════════════════════════════
  //  CONSTANTS
  // ══════════════════════════════════════════════════════════

  const MAP_COLS   = 120;
  const MAP_ROWS   = 90;
  const TILE_SIZE  = 36;

  // ══════════════════════════════════════════════════════════
  //  STATE
  // ══════════════════════════════════════════════════════════

  let mapGrid      = [];   // the full dungeon grid [row][col]
  let rooms        = [];   // array of room objects
  let connections  = [];   // { fromRoom, toRoom, door } pairs
  let currentRoom  = null;
  let startRoom    = null;
  let depth        = 1;

  // ══════════════════════════════════════════════════════════
  //  RNG
  // ══════════════════════════════════════════════════════════

  function rnd(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function chance(p) {
    return Math.random() < p;
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ══════════════════════════════════════════════════════════
  //  GRID HELPERS
  // ══════════════════════════════════════════════════════════

  function initGrid() {
    mapGrid = Array.from({ length: MAP_ROWS }, () => new Array(MAP_COLS).fill(TILE.VOID));
  }

  function setTile(x, y, type) {
    if (x >= 0 && x < MAP_COLS && y >= 0 && y < MAP_ROWS)
      mapGrid[y][x] = type;
  }

  function getTile(x, y) {
    if (x < 0 || x >= MAP_COLS || y < 0 || y >= MAP_ROWS) return TILE.VOID;
    return mapGrid[y][x];
  }

  function isVoid(x, y) { return getTile(x, y) === TILE.VOID; }

  // ══════════════════════════════════════════════════════════
  //  ROOM DEFINITIONS
  // ══════════════════════════════════════════════════════════

  function roomSizeForIdentity(identity) {
    const sizes = {
      grand_hall:     { minW: 18, maxW: 26, minH: 14, maxH: 20 },
      barracks:       { minW: 12, maxW: 18, minH: 8,  maxH: 14 },
      bedchamber:     { minW: 8,  maxW: 12, minH: 6,  maxH: 10 },
      worship_room:   { minW: 12, maxW: 18, minH: 10, maxH: 16 },
      burial_chamber: { minW: 10, maxW: 16, minH: 8,  maxH: 14 },
      treasury:       { minW: 7,  maxW: 11, minH: 6,  maxH: 9  },
      library:        { minW: 10, maxW: 16, minH: 8,  maxH: 12 },
      kitchen:        { minW: 8,  maxW: 12, minH: 7,  maxH: 11 },
      guardroom:      { minW: 7,  maxW: 11, minH: 6,  maxH: 9  },
      prison:         { minW: 12, maxW: 18, minH: 10, maxH: 16 },
      antechamber:    { minW: 7,  maxW: 11, minH: 6,  maxH: 9  },
      armory:         { minW: 9,  maxW: 14, minH: 7,  maxH: 12 },
      secret_chamber: { minW: 6,  maxW: 9,  minH: 5,  maxH: 8  },
    };
    const s = sizes[identity] || { minW: 8, maxW: 14, minH: 6, maxH: 10 };
    return {
      w: rnd(s.minW, s.maxW),
      h: rnd(s.minH, s.maxH),
    };
  }

  function makeRoom(x, y, w, h, identity, quality) {
    return {
      id:         rooms.length,
      x, y, w, h,
      identity,
      quality,
      repurposed: chance(0.3) && identity !== 'secret_chamber',
      repurposedAs: null,
      cx: Math.floor(x + w / 2),
      cy: Math.floor(y + h / 2),
      doors: [],       // door objects placed on this room's walls
      visited: false,
      isStart: false,
      isEnd:   false,
      debugLog: [],
    };
  }

  // ══════════════════════════════════════════════════════════
  //  PHASE 1 — ROOM PLACEMENT
  // ══════════════════════════════════════════════════════════

  function roomsOverlap(a, b, pad = 3) {
    return !(a.x + a.w + pad < b.x || b.x + b.w + pad < a.x ||
             a.y + a.h + pad < b.y || b.y + b.h + pad < a.y);
  }

  function placeRooms(count = 18) {
    rooms = [];
    let attempts = 0;

    while (rooms.length < count && attempts < count * 40) {
      attempts++;
      const identity = pick(ROOM_IDENTITY.filter(i => i !== 'secret_chamber'));
      const quality  = pick(BUILD_QUALITY);
      const { w, h } = roomSizeForIdentity(identity);
      const x = rnd(2, MAP_COLS - w - 3);
      const y = rnd(2, MAP_ROWS - h - 3);
      const room = makeRoom(x, y, w, h, identity, quality);

      if (rooms.some(r => roomsOverlap(r, room))) continue;

      if (room.repurposed) {
        room.repurposedAs = pick(ROOM_IDENTITY.filter(i => i !== identity && i !== 'secret_chamber'));
        room.debugLog.push(`Repurposed: was ${identity}, now used as ${room.repurposedAs}`);
      }

      room.debugLog.push(`Identity: ${identity} | Quality: ${quality} | Size: ${w}×${h}`);
      rooms.push(room);
    }

    // Mark start and end
    rooms[0].isStart = true;
    rooms[0].debugLog.push('Start room.');
    rooms[rooms.length - 1].isEnd = true;
    rooms[rooms.length - 1].debugLog.push('End room — staircase down.');
  }

  // ══════════════════════════════════════════════════════════
  //  PHASE 2 — CARVE ROOMS INTO GRID
  // ══════════════════════════════════════════════════════════

  function carveRoom(room) {
    const { x, y, w, h, identity, quality } = room;

    // Floor
    for (let ry = y; ry < y + h; ry++)
      for (let rx = x; rx < x + w; rx++)
        setTile(rx, ry, TILE.FLOOR);

    // Wall border
    for (let rx = x - 1; rx <= x + w; rx++) {
      maybeWall(rx, y - 1);
      maybeWall(rx, y + h);
    }
    for (let ry = y - 1; ry <= y + h; ry++) {
      maybeWall(x - 1, ry);
      maybeWall(x + w, ry);
    }
  }

  function maybeWall(x, y) {
    if (getTile(x, y) === TILE.VOID) setTile(x, y, TILE.WALL);
  }

  function carveAllRooms() {
    for (const room of rooms) carveRoom(room);
  }

  // ══════════════════════════════════════════════════════════
  //  PHASE 3 — CORRIDOR GENERATION (MST + extras)
  // ══════════════════════════════════════════════════════════

  function dist(a, b) {
    return Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);
  }

  // Minimum spanning tree (Prim's) to connect all rooms
  function buildMST() {
    const connected = new Set([0]);
    const edges = [];

    while (connected.size < rooms.length) {
      let bestDist = Infinity;
      let bestA = -1, bestB = -1;

      for (const ai of connected) {
        for (let bi = 0; bi < rooms.length; bi++) {
          if (connected.has(bi)) continue;
          const d = dist(rooms[ai], rooms[bi]);
          if (d < bestDist) { bestDist = d; bestA = ai; bestB = bi; }
        }
      }

      if (bestA === -1) break;
      connected.add(bestB);
      edges.push([bestA, bestB]);
    }

    return edges;
  }

  function carveCorridors() {
    const mstEdges = buildMST();

    // Add ~30% extra connections for loops
    const extraCount = Math.floor(rooms.length * 0.3);
    const extraEdges = [];
    for (let i = 0; i < extraCount * 10 && extraEdges.length < extraCount; i++) {
      const ai = rnd(0, rooms.length - 1);
      const bi = rnd(0, rooms.length - 1);
      if (ai === bi) continue;
      if (mstEdges.some(e => (e[0]===ai&&e[1]===bi)||(e[0]===bi&&e[1]===ai))) continue;
      if (extraEdges.some(e => (e[0]===ai&&e[1]===bi)||(e[0]===bi&&e[1]===ai))) continue;
      extraEdges.push([ai, bi]);
    }

    const allEdges = [...mstEdges, ...extraEdges];

    for (const [ai, bi] of allEdges) {
      const a = rooms[ai];
      const b = rooms[bi];
      const width = corridorWidth(a, b);
      carveCorridor(a, b, width, false);
      connections.push({ fromRoom: ai, toRoom: bi, secret: false });
    }
  }

  function corridorWidth(a, b) {
    // Grand halls get wider corridors
    if (a.identity === 'grand_hall' || b.identity === 'grand_hall') return 3;
    if (a.quality === 'ornate' || b.quality === 'ornate') return 2;
    return chance(0.3) ? 2 : 1;
  }

  function carveCorridor(a, b, width = 1, secret = false) {
    const tileType = secret ? TILE.SECRET_WALL : TILE.CORRIDOR;
    const floorType = secret ? TILE.SECRET_WALL : TILE.CORRIDOR;

    // L-shaped corridor: horizontal then vertical (or vice versa)
    // Connect from a point on a's wall toward b
    const ax = a.cx;
    const ay = a.cy;
    const bx = b.cx;
    const by = b.cy;

    if (chance(0.5)) {
      carveHLine(ax, bx, ay, width, floorType, secret);
      carveVLine(ay, by, bx, width, floorType, secret);
    } else {
      carveVLine(ay, by, ax, width, floorType, secret);
      carveHLine(ax, bx, by, width, floorType, secret);
    }

    // Place doors where corridor meets room walls
    placeDoorBetween(a, b, secret);
  }

  function carveHLine(x1, x2, y, width, tileType, secret) {
    const [sx, ex] = x1 < x2 ? [x1, x2] : [x2, x1];
    const hw = Math.floor(width / 2);
    for (let x = sx; x <= ex; x++) {
      for (let dy = -hw; dy <= hw; dy++) {
        const cur = getTile(x, y + dy);
        if (cur === TILE.VOID || cur === TILE.WALL) {
          setTile(x, y + dy, secret ? TILE.SECRET_WALL : TILE.CORRIDOR);
        }
      }
      // Wall the edges
      if (!secret) {
        maybeWall(x, y - hw - 1);
        maybeWall(x, y + hw + 1);
      }
    }
  }

  function carveVLine(y1, y2, x, width, tileType, secret) {
    const [sy, ey] = y1 < y2 ? [y1, y2] : [y2, y1];
    const hw = Math.floor(width / 2);
    for (let y = sy; y <= ey; y++) {
      for (let dx = -hw; dx <= hw; dx++) {
        const cur = getTile(x + dx, y);
        if (cur === TILE.VOID || cur === TILE.WALL) {
          setTile(x + dx, y, secret ? TILE.SECRET_WALL : TILE.CORRIDOR);
        }
      }
      if (!secret) {
        maybeWall(x - hw - 1, y);
        maybeWall(x + hw + 1, y);
      }
    }
  }

  // ── Door placement where corridor meets room ─────────────
  function placeDoorBetween(a, b, secret) {
    const exitType = pickExitType(secret);
    const lock     = pickLock(exitType, secret);

    const door = {
      id:        `d_${a.id}_${b.id}`,
      fromRoom:  a.id,
      toRoom:    b.id,
      exitType,
      lock,
      secret,
      discovered: !secret,
      // Map tile position — placed at junction point (set during corridor carve)
      x: null,
      y: null,
    };

    a.doors.push({ ...door, toRoom: b.id });
    b.doors.push({ ...door, toRoom: a.id });

    a.debugLog.push(`Door to ${b.identity}: ${exitType}${lock ? ' ['+lock+']' : ''}${secret ? ' (secret)' : ''}`);
  }

  function pickExitType(secret) {
    if (secret) return pick([EXIT_TYPE.CREVICE, EXIT_TYPE.BRICKED]);
    const r = Math.random();
    if (r < 0.22) return EXIT_TYPE.OPEN;
    if (r < 0.45) return EXIT_TYPE.DOOR_WOOD;
    if (r < 0.63) return EXIT_TYPE.DOOR_STRONG;
    if (r < 0.78) return EXIT_TYPE.DOOR_METAL;
    if (r < 0.90) return EXIT_TYPE.PORTCULLIS;
    return EXIT_TYPE.BRICKED;
  }

  function pickLock(exitType, secret) {
    if (secret) return LOCK.NONE;
    if ((exitType === EXIT_TYPE.DOOR_METAL || exitType === EXIT_TYPE.PORTCULLIS) && chance(0.35))
      return pick([LOCK.SKULL, LOCK.STAR]);
    if (exitType === EXIT_TYPE.DOOR_STRONG && chance(0.15))
      return pick([LOCK.SKULL, LOCK.STAR]);
    return LOCK.NONE;
  }

  // ══════════════════════════════════════════════════════════
  //  PHASE 4 — SECRET PASSAGES
  // ══════════════════════════════════════════════════════════

  function addSecretPassages() {
    const count = rnd(2, 5);
    let added   = 0;
    let attempts = 0;

    while (added < count && attempts < 60) {
      attempts++;
      const ai = rnd(0, rooms.length - 1);
      const bi = rnd(0, rooms.length - 1);
      if (ai === bi) continue;
      if (connections.some(c =>
        (c.fromRoom === ai && c.toRoom === bi) ||
        (c.fromRoom === bi && c.toRoom === ai)
      )) continue;

      const a = rooms[ai];
      const b = rooms[bi];
      const d = dist(a, b);
      if (d > 35) continue; // too far

      carveCorridor(a, b, 1, true);
      connections.push({ fromRoom: ai, toRoom: bi, secret: true });
      a.debugLog.push(`Secret passage to: ${b.identity}`);
      b.debugLog.push(`Secret passage from: ${a.identity}`);
      added++;
    }

    // Optionally add small secret chambers
    for (const room of rooms) {
      if (chance(0.15)) {
        const identity = 'secret_chamber';
        const { w, h } = roomSizeForIdentity(identity);
        const x = room.x + room.w + 2;
        const y = room.cy - Math.floor(h / 2);
        if (x + w + 2 >= MAP_COLS || y < 2 || y + h + 2 >= MAP_ROWS) continue;

        const secretRoom = makeRoom(x, y, w, h, identity, 'crude');
        secretRoom.debugLog.push(`Secret chamber adjacent to: ${room.identity}`);
        rooms.push(secretRoom);
        carveRoom(secretRoom);
        carveCorridor(room, secretRoom, 1, true);
        connections.push({ fromRoom: room.id, toRoom: secretRoom.id, secret: true });
        room.debugLog.push('Has adjacent secret chamber.');
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  //  PHASE 5 — ROOM DETAIL PASS
  // ══════════════════════════════════════════════════════════

  function addRoomDetails() {
    for (const room of rooms) addDetails(room);
  }

  function addBlock(x, y, w, h) {
    for (let dy = 0; dy < h; dy++)
      for (let dx = 0; dx < w; dx++)
        setTile(x + dx, y + dy, TILE.WALL);
  }

  function addDetails(room) {
    const { x, y, w, h, identity, quality, cx, cy } = room;

    switch (identity) {
      case 'grand_hall': {
        // Rows of pillars
        const spacingX = quality === 'ornate' ? 4 : 5;
        const spacingY = quality === 'ornate' ? 4 : 5;
        for (let py = y + 2; py < y + h - 2; py += spacingY)
          for (let px = x + 2; px < x + w - 2; px += spacingX)
            setTile(px, py, TILE.WALL);
        break;
      }
      case 'worship_room': {
        // Central altar
        addBlock(cx - 1, cy - 2, 3, 4);
        if (quality === 'ornate' || quality === 'fine') {
          for (let px = x + 2; px < x + w - 2; px += 5)
            setTile(px, y + 2, TILE.WALL);
        }
        break;
      }
      case 'burial_chamber': {
        // Sarcophagi in rows
        const cols = Math.floor((w - 4) / 4);
        for (let c = 0; c < cols; c++) {
          addBlock(x + 2 + c * 4, y + 2, 2, 1);
          addBlock(x + 2 + c * 4, y + h - 3, 2, 1);
        }
        break;
      }
      case 'barracks': {
        // Cots along walls
        for (let px = x + 2; px < x + w - 2; px += 3) {
          setTile(px, y + 2, TILE.WALL);
          setTile(px, y + h - 3, TILE.WALL);
        }
        break;
      }
      case 'prison': {
        // Cell dividers
        const cellW = 4;
        for (let px = x + cellW; px < x + w - 1; px += cellW) {
          for (let py = y + 1; py < y + h - 2; py++)
            setTile(px, py, TILE.WALL);
          setTile(px, y + Math.floor(h / 2), TILE.FLOOR); // cell gap
        }
        break;
      }
      case 'library': {
        // Bookshelf rows
        for (let py = y + 2; py < y + h - 2; py += 3)
          for (let px = x + 2; px < x + w - 2; px++)
            if ((px - x) % 6 < 4) setTile(px, py, TILE.WALL);
        break;
      }
      case 'treasury': {
        // Scattered chest blocks
        const count = rnd(3, 7);
        for (let i = 0; i < count; i++)
          setTile(rnd(x + 2, x + w - 3), rnd(y + 2, y + h - 3), TILE.WALL);
        break;
      }
      case 'guardroom': {
        addBlock(cx - 1, cy - 1, 3, 2);
        break;
      }
      case 'kitchen': {
        // Counter along east wall
        for (let py = y + 2; py < y + h - 2; py++)
          setTile(x + w - 3, py, TILE.WALL);
        break;
      }
      case 'armory': {
        for (let py = y + 2; py < y + h - 2; py += 3)
          for (let px = x + 2; px < x + w - 2; px++)
            if ((px - x) % 5 < 3) setTile(px, py, TILE.WALL);
        break;
      }
    }

    // Place stair in end room
    if (room.isEnd) setTile(cx, cy, TILE.STAIR_DOWN);
  }

  // ══════════════════════════════════════════════════════════
  //  WALL PASS — ensure all non-void non-floor gets a wall
  // ══════════════════════════════════════════════════════════

  function buildWalls() {
    const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
    for (let y = 0; y < MAP_ROWS; y++) {
      for (let x = 0; x < MAP_COLS; x++) {
        if (getTile(x, y) !== TILE.VOID) continue;
        for (const [dx, dy] of dirs) {
          const t = getTile(x+dx, y+dy);
          if (t === TILE.FLOOR || t === TILE.CORRIDOR) {
            setTile(x, y, TILE.WALL);
            break;
          }
        }
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  //  MAIN GENERATE
  // ══════════════════════════════════════════════════════════

  function generate(targetRooms = 18) {
    connections = [];
    depth       = 1;

    initGrid();
    placeRooms(targetRooms);
    carveAllRooms();
    carveCorridors();
    addSecretPassages();
    addRoomDetails();
    buildWalls();

    startRoom    = rooms[0];
    currentRoom  = startRoom;
    currentRoom.visited = true;

    return { rooms, currentRoom, startRoom, depth, TILE };
  }

  // ══════════════════════════════════════════════════════════
  //  SCREEN VIEWPORT
  //  The "current screen" is the bounding box of currentRoom
  //  plus its wall border, rendered as a full-screen view.
  // ══════════════════════════════════════════════════════════

  function enterRoom(roomId, fromRoomId) {
    currentRoom = rooms.find(r => r.id === roomId);
    if (!currentRoom) return null;
    currentRoom.visited = true;

    // Spawn player near the door connecting fromRoom -> currentRoom
    const spawnPos = spawnPosition(fromRoomId);
    return { room: currentRoom, spawnPos };
  }

  function spawnPosition(fromRoomId) {
    if (fromRoomId === null || fromRoomId === undefined) {
      return { x: currentRoom.cx, y: currentRoom.cy };
    }

    const fromRoom = rooms.find(r => r.id === fromRoomId);
    if (!fromRoom) return { x: currentRoom.cx, y: currentRoom.cy };

    // Spawn near the wall edge closest to fromRoom
    const dx = fromRoom.cx - currentRoom.cx;
    const dy = fromRoom.cy - currentRoom.cy;

    if (Math.abs(dx) >= Math.abs(dy)) {
      // Came from east or west
      const spawnX = dx > 0
        ? currentRoom.x + currentRoom.w - 2
        : currentRoom.x + 1;
      return { x: spawnX, y: currentRoom.cy };
    } else {
      // Came from north or south
      const spawnY = dy > 0
        ? currentRoom.y + currentRoom.h - 2
        : currentRoom.y + 1;
      return { x: currentRoom.cx, y: spawnY };
    }
  }

  // ══════════════════════════════════════════════════════════
  //  WALKABILITY / ROOM DETECTION
  // ══════════════════════════════════════════════════════════

  function isWalkable(x, y) {
    const t = getTile(x, y);
    return t === TILE.FLOOR || t === TILE.CORRIDOR ||
           t === TILE.STAIR_DOWN || t === TILE.STAIR_UP;
  }

  // Return a room to transition to, or null.
  // Fires when player enters another room's bounds directly,
  // OR when player steps out of current room onto a corridor tile.
  function checkRoomTransition(x, y) {
    if (!currentRoom) return null;

    // Direct room entry
    for (const room of rooms) {
      if (room.id === currentRoom.id) continue;
      if (x >= room.x && x < room.x + room.w &&
          y >= room.y && y < room.y + room.h) {
        return room;
      }
    }

    // Left current room bounds onto a corridor
    const inCurrentRoom = (
      x >= currentRoom.x && x < currentRoom.x + currentRoom.w &&
      y >= currentRoom.y && y < currentRoom.y + currentRoom.h
    );

    if (!inCurrentRoom && getTile(x, y) === TILE.CORRIDOR) {
      const connected = connections.filter(
        c => c.fromRoom === currentRoom.id || c.toRoom === currentRoom.id
      );
      let best = null, bestDist = Infinity;
      for (const conn of connected) {
        const otherId = conn.fromRoom === currentRoom.id ? conn.toRoom : conn.fromRoom;
        const other   = rooms.find(r => r.id === otherId);
        if (!other) continue;
        const d = Math.abs(other.cx - x) + Math.abs(other.cy - y);
        if (d < bestDist) { bestDist = d; best = other; }
      }
      return best;
    }

    return null;
  }

  function getCurrentTile(x, y) {
    return getTile(x, y);
  }

  // ══════════════════════════════════════════════════════════
  //  RENDERING
  // ══════════════════════════════════════════════════════════

  const COLOR = {
    void:        '#0a0a0f',
    floor:       '#2a2535',
    floorAlt:    '#252030',
    corridor:    '#1e1c2a',
    corridorAlt: '#1a1828',
    wall:        '#1a1520',
    wallTop:     '#3d3550',
    wallFace:    '#141018',
    gridLine:    '#1e1a28',
    corrLine:    '#161420',
    secretWall:  '#1a1520',  // looks like wall
    stairDown:   '#2a4a2a',
    stairIcon:   '#c8a96e',
    player:      '#c8a96e',
    playerOut:   '#0a0a0f',
    door: {
      open:        '#3a3020',
      door_wood:   '#5c3d1e',
      door_strong: '#3a2810',
      door_metal:  '#2a2838',
      portcullis:  '#1e1e30',
      crevice:     '#181418',
      bricked:     '#221c20',
    },
    doorFrame:   '#c8a96e',
    lockSkull:   '#c04040',
    lockStar:    '#c8a96e',
  };

  function wallMask(x, y) {
    let mask = 0;
    const op = (tx, ty) => { const t = getTile(tx,ty); return t===TILE.WALL||t===TILE.VOID||t===TILE.SECRET_WALL; };
    if (op(x, y-1)) mask |= 1;
    if (op(x-1, y)) mask |= 2;
    if (op(x+1, y)) mask |= 4;
    if (op(x, y+1)) mask |= 8;
    return mask;
  }

  function drawTileAt(ctx, x, y, px, py) {
    const s = TILE_SIZE;
    const t = getTile(x, y);

    switch (t) {
      case TILE.VOID:
        ctx.fillStyle = COLOR.void;
        ctx.fillRect(px, py, s, s);
        break;

      case TILE.FLOOR: {
        const alt = (x + y) % 2 === 0;
        ctx.fillStyle = alt ? COLOR.floor : COLOR.floorAlt;
        ctx.fillRect(px, py, s, s);
        ctx.strokeStyle = COLOR.gridLine;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(px+.5, py+.5, s-1, s-1);
        break;
      }

      case TILE.CORRIDOR: {
        const alt = (x + y) % 2 === 0;
        ctx.fillStyle = alt ? COLOR.corridor : COLOR.corridorAlt;
        ctx.fillRect(px, py, s, s);
        ctx.strokeStyle = COLOR.corrLine;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(px+.5, py+.5, s-1, s-1);
        break;
      }

      case TILE.WALL:
      case TILE.SECRET_WALL: {
        const mask = wallMask(x, y);
        ctx.fillStyle = COLOR.wall;
        ctx.fillRect(px, py, s, s);
        if (!(mask & 8)) {
          ctx.fillStyle = COLOR.wallTop;
          ctx.fillRect(px, py, s, 5);
          ctx.fillStyle = COLOR.wallFace;
          ctx.fillRect(px, py+5, s, 8);
        }
        if (mask & 2) {
          ctx.fillStyle = 'rgba(0,0,0,0.2)';
          ctx.fillRect(px, py, 3, s);
        }
        break;
      }

      case TILE.STAIR_DOWN: {
        ctx.fillStyle = COLOR.stairDown;
        ctx.fillRect(px, py, s, s);
        ctx.strokeStyle = COLOR.stairIcon;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px+s*.25, py+s*.3);
        ctx.lineTo(px+s*.5,  py+s*.55);
        ctx.lineTo(px+s*.75, py+s*.3);
        ctx.moveTo(px+s*.25, py+s*.5);
        ctx.lineTo(px+s*.5,  py+s*.75);
        ctx.lineTo(px+s*.75, py+s*.5);
        ctx.stroke();
        break;
      }
    }
  }

  function drawDoors(ctx, room, originX, originY) {
    const s = TILE_SIZE;
    const seen = new Set();

    for (const door of room.doors) {
      if (!door.discovered) continue;
      const key = door.id;
      if (seen.has(key)) continue;
      seen.add(key);

      const toRoom = rooms.find(r => r.id === door.toRoom);
      if (!toRoom) continue;

      // Find the junction point between rooms — approximate by
      // checking along the wall edge shared with corridor direction
      const dx = toRoom.cx - room.cx;
      const dy = toRoom.cy - room.cy;

      let doorX, doorY;
      if (Math.abs(dx) >= Math.abs(dy)) {
        doorX = dx > 0 ? room.x + room.w : room.x - 1;
        doorY = room.cy;
      } else {
        doorX = room.cx;
        doorY = dy > 0 ? room.y + room.h : room.y - 1;
      }

      const px = originX + (doorX - (room.x - 1)) * s;
      const py = originY + (doorY - (room.y - 1)) * s;

      ctx.fillStyle = COLOR.door[door.exitType] || COLOR.door.door_wood;
      ctx.fillRect(px, py, s, s);
      ctx.strokeStyle = COLOR.doorFrame;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(px+2, py+2, s-4, s-4);

      if (door.lock === LOCK.SKULL) {
        ctx.fillStyle = COLOR.lockSkull;
        ctx.font = `${Math.floor(s*.45)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('☠', px+s/2, py+s/2);
      } else if (door.lock === LOCK.STAR) {
        ctx.fillStyle = COLOR.lockStar;
        ctx.font = `${Math.floor(s*.45)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('★', px+s/2, py+s/2);
      }
    }
  }

  function drawPlayer(ctx, px, py) {
    const s  = TILE_SIZE;
    const cx = px + s/2, cy = py + s/2;
    const r  = s * 0.28;
    ctx.beginPath();
    ctx.ellipse(cx, cy+r*.8, r*.7, r*.25, 0, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI*2);
    ctx.fillStyle = COLOR.player;
    ctx.fill();
    ctx.strokeStyle = COLOR.playerOut;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy+r*.35, r*.22, 0, Math.PI*2);
    ctx.fillStyle = COLOR.playerOut;
    ctx.fill();
  }

  // Render the current room — viewport shows room + 1 tile border
  function render(canvas, playerPos) {
    if (!currentRoom) return;
    const ctx  = canvas.getContext('2d');
    const W    = canvas.width;
    const H    = canvas.height;
    const s    = TILE_SIZE;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = COLOR.void;
    ctx.fillRect(0, 0, W, H);

    // Viewport: room bounds + 1 tile border on each side
    const vx     = currentRoom.x - 1;
    const vy     = currentRoom.y - 1;
    const vw     = currentRoom.w + 2;
    const vh     = currentRoom.h + 2;

    const originX = Math.floor((W - vw * s) / 2);
    const originY = Math.floor((H - vh * s) / 2);

    for (let row = 0; row < vh; row++) {
      for (let col = 0; col < vw; col++) {
        const mx = vx + col;
        const my = vy + row;
        drawTileAt(ctx, mx, my, originX + col * s, originY + row * s);
      }
    }

    drawDoors(ctx, currentRoom, originX, originY);

    // Player position is in map coords — offset to screen
    const ppx = originX + (playerPos.x - vx) * s;
    const ppy = originY + (playerPos.y - vy) * s;
    drawPlayer(ctx, ppx, ppy);

    // Vignette
    const vig = ctx.createRadialGradient(W/2, H/2, H*.25, W/2, H/2, H*.8);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);
  }

  // ══════════════════════════════════════════════════════════
  //  MINIMAP — draws the full dungeon map zoomed out
  // ══════════════════════════════════════════════════════════

  function renderMinimap(canvas) {
    const ctx = canvas.getContext('2d');
    const W   = canvas.width;
    const H   = canvas.height;

    // Scale to fit within 80% of canvas
    const maxW  = W * 0.82;
    const maxH  = H * 0.82;
    const scale = Math.min(maxW / MAP_COLS, maxH / MAP_ROWS);
    const mw    = Math.floor(MAP_COLS * scale);
    const mh    = Math.floor(MAP_ROWS * scale);
    const ox    = Math.floor((W - mw) / 2);
    const oy    = Math.floor((H - mh) / 2);

    // Panel background
    ctx.fillStyle = 'rgba(0,0,0,0.9)';
    ctx.beginPath();
    ctx.roundRect(ox - 12, oy - 12, mw + 24, mh + 24, 8);
    ctx.fill();
    ctx.strokeStyle = '#2a2a3a';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Draw each tile of the map scaled down
    for (let y = 0; y < MAP_ROWS; y++) {
      for (let x = 0; x < MAP_COLS; x++) {
        const t  = getTile(x, y);
        const px = ox + Math.floor(x * scale);
        const py = oy + Math.floor(y * scale);
        const ts = Math.max(1, Math.floor(scale));

        switch (t) {
          case TILE.FLOOR:
            ctx.fillStyle = '#2a2535'; break;
          case TILE.CORRIDOR:
            ctx.fillStyle = '#1e1c2a'; break;
          case TILE.WALL:
            ctx.fillStyle = '#3d3550'; break;
          case TILE.SECRET_WALL:
            ctx.fillStyle = '#2a1a2a'; break;
          case TILE.STAIR_DOWN:
            ctx.fillStyle = '#2a4a2a'; break;
          default:
            ctx.fillStyle = '#0a0a0f'; break;
        }
        ctx.fillRect(px, py, ts, ts);
      }
    }

    // Highlight current room
    if (currentRoom) {
      ctx.strokeStyle = '#c8a96e';
      ctx.lineWidth   = 1.5;
      ctx.strokeRect(
        ox + Math.floor(currentRoom.x * scale),
        oy + Math.floor(currentRoom.y * scale),
        Math.floor(currentRoom.w * scale),
        Math.floor(currentRoom.h * scale)
      );
    }

    // Player dot
    ctx.fillStyle = '#c8a96e';
    ctx.beginPath();
    ctx.arc(ox + playerDotX * scale, oy + playerDotY * scale, 3, 0, Math.PI*2);
    ctx.fill();

    ctx.fillStyle    = '#c8a96e';
    ctx.font         = '11px monospace';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('MAP  [M]', ox + mw/2, oy + mh + 18);
  }

  let playerDotX = 0;
  let playerDotY = 0;

  function setPlayerDot(x, y) {
    playerDotX = x;
    playerDotY = y;
  }

  // ══════════════════════════════════════════════════════════
  //  DEBUG OVERLAY
  // ══════════════════════════════════════════════════════════

  function renderDebug(canvas) {
    if (!currentRoom) return;
    const ctx = canvas.getContext('2d');
    const W   = canvas.width;
    const n   = currentRoom;

    const lines = [
      `ROOM ID: ${n.id}`,
      `IDENTITY: ${n.identity}`,
      `QUALITY: ${n.quality}`,
      n.repurposed ? `REPURPOSED AS: ${n.repurposedAs}` : null,
      `POSITION: (${n.x}, ${n.y})  SIZE: ${n.w}×${n.h}`,
      `DOORS: ${n.doors.length}`,
      `VISITED: ${n.visited}`,
      n.isStart ? '★ START ROOM' : null,
      n.isEnd   ? '▼ END ROOM' : null,
      '─────────────────────────────',
      ...n.debugLog,
    ].filter(Boolean);

    const pad  = 14;
    const lh   = 18;
    const panW = 360;
    const panH = pad * 2 + lines.length * lh;
    const px   = W - panW - 16;
    const py   = 16;

    ctx.fillStyle = 'rgba(0,0,0,0.88)';
    ctx.beginPath();
    ctx.roundRect(px, py, panW, panH, 6);
    ctx.fill();
    ctx.strokeStyle = '#c8a96e44';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    lines.forEach((line, i) => {
      if (line.startsWith('ROOM') || line.startsWith('─')) ctx.fillStyle = '#c8a96e';
      else if (line.startsWith('★') || line.startsWith('▼')) ctx.fillStyle = '#90e090';
      else if (line.toLowerCase().includes('secret')) ctx.fillStyle = '#c090e0';
      else ctx.fillStyle = '#c4c0ba';
      ctx.fillText(line, px + pad, py + pad + i * lh);
    });

    ctx.fillStyle = '#6e6a60';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('[D] debug', px + panW - 8, py + panH - 14);
  }

  // ══════════════════════════════════════════════════════════
  //  PUBLIC API
  // ══════════════════════════════════════════════════════════

  return {
    TILE,
    EXIT_TYPE,
    LOCK,
    generate,
    enterRoom,
    render,
    renderMinimap,
    renderDebug,
    setPlayerDot,
    getCurrentTile,
    isWalkable,
    checkRoomTransition,
    get currentRoom()  { return currentRoom; },
    get rooms()        { return rooms; },
    get startRoom()    { return startRoom; },
    get depth()        { return depth; },
  };

})();
