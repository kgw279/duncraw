// ============================================================
//  DUNGEON CRAWLER — dungeon.js
//
//  Generation pipeline:
//  1. Recursive backtracker maze on a coarse grid
//  2. Room expansion — some cells become multi-tile rooms
//  3. Flood-fill component labeling — every tile tagged to a component
//  4. Doorway detection — single-tile openings between components
//  5. Screen rendering — current component centered, fixed tile size
// ============================================================

const Dungeon = (() => {

  // ══════════════════════════════════════════════════════════
  //  TILE TYPES
  // ══════════════════════════════════════════════════════════

  const TILE = {
    VOID:        0,
    FLOOR:       1,  // room floor
    WALL:        2,
    CORRIDOR:    3,  // corridor floor
    DOOR:        4,  // doorway between components
    STAIR_DOWN:  5,
    SECRET_WALL: 6,  // passable but looks solid until discovered
  };

  // ══════════════════════════════════════════════════════════
  //  COMPONENT TYPES
  // ══════════════════════════════════════════════════════════

  const COMP = { ROOM: 'room', CORRIDOR: 'corridor' };

  // ══════════════════════════════════════════════════════════
  //  ROOM IDENTITIES
  // ══════════════════════════════════════════════════════════

  const ROOM_IDENTITIES = [
    'grand_hall', 'barracks', 'bedchamber', 'worship_room',
    'burial_chamber', 'treasury', 'library', 'kitchen',
    'guardroom', 'prison', 'antechamber', 'armory',
  ];

  const BUILD_QUALITY = ['crude', 'rough', 'standard', 'fine', 'ornate'];

  // ══════════════════════════════════════════════════════════
  //  DOOR TYPES & LOCKS
  // ══════════════════════════════════════════════════════════

  const EXIT_TYPE = {
    OPEN:        'open',
    DOOR_WOOD:   'door_wood',
    DOOR_STRONG: 'door_strong',
    DOOR_METAL:  'door_metal',
    PORTCULLIS:  'portcullis',
    CREVICE:     'crevice',
    BRICKED:     'bricked',
  };

  const LOCK = { NONE: null, SKULL: 'skull', STAR: 'star' };

  // ══════════════════════════════════════════════════════════
  //  CONSTANTS
  // ══════════════════════════════════════════════════════════

  // Maze is carved on a coarse grid where each cell = 1 maze unit.
  // The fine grid = coarse grid * CELL (each maze unit is CELL tiles wide).
  // Walls between cells are 1 tile thick on the fine grid.

  const MAZE_COLS  = 25;   // coarse grid columns
  const MAZE_ROWS  = 19;   // coarse grid rows
  const CELL       = 4;    // fine tiles per maze cell (interior)
  const WALL_T     = 1;    // fine tiles per wall between cells

  // Fine grid dimensions
  const FINE_COLS  = MAZE_COLS * (CELL + WALL_T) + WALL_T;
  const FINE_ROWS  = MAZE_ROWS * (CELL + WALL_T) + WALL_T;

  const TILE_SIZE  = 36;   // pixels per tile (fixed)

  // Room expansion chance when the carver visits a new cell
  const ROOM_CHANCE = 0.28;

  // ══════════════════════════════════════════════════════════
  //  STATE
  // ══════════════════════════════════════════════════════════

  let fineGrid   = [];   // [row][col] = TILE type
  let compMap    = [];   // [row][col] = component id (or -1)
  let components = {};   // id -> component object
  let doorways   = [];   // { x, y, compA, compB, exitType, lock, secret, discovered }
  let currentComp = null;
  let startComp   = null;
  let depth       = 1;
  let _playerDotX = 0;
  let _playerDotY = 0;

  // ══════════════════════════════════════════════════════════
  //  RNG
  // ══════════════════════════════════════════════════════════

  function rnd(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function pick(arr)      { return arr[Math.floor(Math.random() * arr.length)]; }
  function chance(p)      { return Math.random() < p; }
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

  function initGrids() {
    fineGrid = Array.from({ length: FINE_ROWS }, () => new Array(FINE_COLS).fill(TILE.WALL));
    compMap  = Array.from({ length: FINE_ROWS }, () => new Array(FINE_COLS).fill(-1));
  }

  function setFine(x, y, type) {
    if (x >= 0 && x < FINE_COLS && y >= 0 && y < FINE_ROWS)
      fineGrid[y][x] = type;
  }

  function getFine(x, y) {
    if (x < 0 || x >= FINE_COLS || y < 0 || y >= FINE_ROWS) return TILE.WALL;
    return fineGrid[y][x];
  }

  // Convert coarse cell (cx, cy) to fine grid top-left corner
  function coarseToFine(cx, cy) {
    return {
      fx: cx * (CELL + WALL_T) + WALL_T,
      fy: cy * (CELL + WALL_T) + WALL_T,
    };
  }

  // ══════════════════════════════════════════════════════════
  //  PHASE 1 — RECURSIVE BACKTRACKER MAZE (coarse grid)
  // ══════════════════════════════════════════════════════════

  // Each coarse cell tracks which of its walls have been removed
  let mazeVisited = [];
  // Rooms carved during maze generation (coarse cell coords)
  let mazeRooms   = [];  // { cx, cy, w, h, identity, quality }

  function initMaze() {
    mazeVisited = Array.from({ length: MAZE_ROWS }, () => new Array(MAZE_COLS).fill(false));
    mazeRooms   = [];
  }

  function carveMaze(cx, cy) {
    mazeVisited[cy][cx] = true;

    // Try to expand this cell into a room
    if (chance(ROOM_CHANCE)) {
      carveRoom(cx, cy);
    } else {
      carveCell(cx, cy, TILE.CORRIDOR);
    }

    const dirs = shuffle([[0,-1],[0,1],[-1,0],[1,0]]);
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= MAZE_COLS || ny < 0 || ny >= MAZE_ROWS) continue;
      if (mazeVisited[ny][nx]) continue;

      // Remove wall between (cx,cy) and (nx,ny) on fine grid
      carvePassage(cx, cy, nx, ny);
      carveMaze(nx, ny);
    }
  }

  // Carve a single coarse cell as corridor floor on fine grid
  function carveCell(cx, cy, tileType = TILE.CORRIDOR) {
    const { fx, fy } = coarseToFine(cx, cy);
    for (let dy = 0; dy < CELL; dy++)
      for (let dx = 0; dx < CELL; dx++)
        setFine(fx + dx, fy + dy, tileType);
  }

  // Carve the wall between two adjacent coarse cells
  function carvePassage(cx, cy, nx, ny) {
    const { fx: ax, fy: ay } = coarseToFine(cx, cy);
    const { fx: bx, fy: by } = coarseToFine(nx, ny);

    // Wall tile is between the two cells
    const wx = Math.floor((ax + bx + CELL - 1) / 2);
    const wy = Math.floor((ay + by + CELL - 1) / 2);

    const isHoriz = ny === cy;
    if (isHoriz) {
      // Horizontal passage — carve column of wall tiles
      const wallX = nx > cx ? ax + CELL : ax - WALL_T;
      for (let dy = 0; dy < CELL; dy++)
        setFine(wallX, ay + dy, TILE.CORRIDOR);
    } else {
      // Vertical passage
      const wallY = ny > cy ? ay + CELL : ay - WALL_T;
      for (let dx = 0; dx < CELL; dx++)
        setFine(ax + dx, wallY, TILE.CORRIDOR);
    }
  }

  // Carve a room — expands the current cell into a multi-cell rectangle
  function carveRoom(cx, cy) {
    const identity = pick(ROOM_IDENTITIES);
    const quality  = pick(BUILD_QUALITY);

    // Room size in coarse cells
    const roomW = rnd(2, Math.min(4, MAZE_COLS - cx));
    const roomH = rnd(2, Math.min(3, MAZE_ROWS - cy));

    // Clamp to maze bounds
    const rw = Math.min(roomW, MAZE_COLS - cx);
    const rh = Math.min(roomH, MAZE_ROWS - cy);

    // Mark all coarse cells in room as visited
    for (let ry = cy; ry < cy + rh; ry++) {
      for (let rx = cx; rx < cx + rw; rx++) {
        if (rx < MAZE_COLS && ry < MAZE_ROWS)
          mazeVisited[ry][rx] = true;
      }
    }

    // Carve all fine tiles in the room (including inter-cell walls)
    const { fx, fy } = coarseToFine(cx, cy);
    const fineW = rw * (CELL + WALL_T) - WALL_T;
    const fineH = rh * (CELL + WALL_T) - WALL_T;

    for (let dy = 0; dy < fineH; dy++)
      for (let dx = 0; dx < fineW; dx++)
        setFine(fx + dx, fy + dy, TILE.FLOOR);

    mazeRooms.push({
      cx, cy, rw, rh,
      fx, fy, fineW, fineH,
      identity, quality,
      repurposed: chance(0.3),
      repurposedAs: null,
    });
  }

  // ══════════════════════════════════════════════════════════
  //  PHASE 2 — ROOM DETAIL PASS
  // ══════════════════════════════════════════════════════════

  function addRoomDetails() {
    for (const room of mazeRooms) {
      if (room.repurposed) {
        room.repurposedAs = pick(ROOM_IDENTITIES.filter(i => i !== room.identity));
      }
      placeRoomFeatures(room);
    }
  }

  function placeRoomFeatures(room) {
    const { fx, fy, fineW, fineH, identity, quality } = room;
    const cx = fx + Math.floor(fineW / 2);
    const cy = fy + Math.floor(fineH / 2);

    // Only place features if room is large enough
    if (fineW < 6 || fineH < 6) return;

    switch (identity) {
      case 'grand_hall': {
        const spacingX = quality === 'ornate' ? 3 : 4;
        const spacingY = quality === 'ornate' ? 3 : 4;
        for (let y = fy + 2; y < fy + fineH - 2; y += spacingY)
          for (let x = fx + 2; x < fx + fineW - 2; x += spacingX)
            setFine(x, y, TILE.WALL);
        break;
      }
      case 'worship_room': {
        // Central altar
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 0; dx++)
            setFine(cx + dx, cy + dy, TILE.WALL);
        break;
      }
      case 'burial_chamber': {
        const cols = Math.max(1, Math.floor((fineW - 4) / 4));
        for (let c = 0; c < cols; c++) {
          setFine(fx + 2 + c * 4, fy + 2, TILE.WALL);
          setFine(fx + 2 + c * 4, fy + fineH - 3, TILE.WALL);
        }
        break;
      }
      case 'barracks': {
        for (let x = fx + 2; x < fx + fineW - 2; x += 3) {
          setFine(x, fy + 2, TILE.WALL);
          setFine(x, fy + fineH - 3, TILE.WALL);
        }
        break;
      }
      case 'prison': {
        if (fineW >= 10) {
          const cellW = Math.max(3, Math.floor(fineW / 3));
          for (let x = fx + cellW; x < fx + fineW - 1; x += cellW) {
            for (let y = fy + 1; y < fy + fineH - 2; y++)
              setFine(x, y, TILE.WALL);
            setFine(x, fy + Math.floor(fineH / 2), TILE.FLOOR);
          }
        }
        break;
      }
      case 'library': {
        for (let y = fy + 2; y < fy + fineH - 2; y += 3)
          for (let x = fx + 2; x < fx + fineW - 2; x++)
            if ((x - fx) % 5 < 3) setFine(x, y, TILE.WALL);
        break;
      }
      case 'treasury': {
        const count = rnd(2, 5);
        for (let i = 0; i < count; i++)
          setFine(rnd(fx+2, fx+fineW-3), rnd(fy+2, fy+fineH-3), TILE.WALL);
        break;
      }
      case 'guardroom': {
        setFine(cx-1, cy, TILE.WALL);
        setFine(cx,   cy, TILE.WALL);
        setFine(cx+1, cy, TILE.WALL);
        break;
      }
      case 'kitchen': {
        for (let y = fy + 2; y < fy + fineH - 2; y++)
          setFine(fx + fineW - 3, y, TILE.WALL);
        break;
      }
      case 'armory': {
        for (let y = fy + 2; y < fy + fineH - 2; y += 3)
          for (let x = fx + 2; x < fx + fineW - 2; x++)
            if ((x - fx) % 4 < 2) setFine(x, y, TILE.WALL);
        break;
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  //  PHASE 3 — FLOOD-FILL COMPONENT LABELING
  // ══════════════════════════════════════════════════════════

  function labelComponents() {
    components = {};
    let nextId  = 0;

    for (let y = 0; y < FINE_ROWS; y++) {
      for (let x = 0; x < FINE_COLS; x++) {
        const t = getFine(x, y);
        if (compMap[y][x] !== -1) continue;
        if (t !== TILE.FLOOR && t !== TILE.CORRIDOR) continue;

        // Flood fill
        const id    = nextId++;
        const tiles = [];
        const queue = [[x, y]];
        compMap[y][x] = id;

        while (queue.length) {
          const [cx, cy] = queue.pop();
          tiles.push([cx, cy]);

          for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const nx = cx+dx, ny = cy+dy;
            if (nx<0||nx>=FINE_COLS||ny<0||ny>=FINE_ROWS) continue;
            if (compMap[ny][nx] !== -1) continue;
            const nt = getFine(nx, ny);
            if (nt !== TILE.FLOOR && nt !== TILE.CORRIDOR) continue;
            compMap[ny][nx] = id;
            queue.push([nx, ny]);
          }
        }

        // Determine component type and identity
        const hasFloor = tiles.some(([tx,ty]) => getFine(tx,ty) === TILE.FLOOR);
        const type     = hasFloor ? COMP.ROOM : COMP.CORRIDOR;

        // Find matching room definition
        let identity = 'corridor';
        let quality  = 'standard';
        let repurposed = false;
        let repurposedAs = null;

        if (type === COMP.ROOM) {
          // Match to a mazeRoom by checking tile overlap
          const firstTile = tiles[0];
          const matchedRoom = mazeRooms.find(r =>
            firstTile[0] >= r.fx && firstTile[0] < r.fx + r.fineW &&
            firstTile[1] >= r.fy && firstTile[1] < r.fy + r.fineH
          );
          if (matchedRoom) {
            identity     = matchedRoom.identity;
            quality      = matchedRoom.quality;
            repurposed   = matchedRoom.repurposed;
            repurposedAs = matchedRoom.repurposedAs;
          }
        }

        // Bounding box
        const xs    = tiles.map(t => t[0]);
        const ys    = tiles.map(t => t[1]);
        const minX  = Math.min(...xs);
        const maxX  = Math.max(...xs);
        const minY  = Math.min(...ys);
        const maxY  = Math.max(...ys);

        components[id] = {
          id,
          type,
          identity,
          quality,
          repurposed,
          repurposedAs,
          tiles,
          minX, maxX, minY, maxY,
          w: maxX - minX + 1,
          h: maxY - minY + 1,
          cx: Math.floor((minX + maxX) / 2),
          cy: Math.floor((minY + maxY) / 2),
          doors:   [],   // doorway objects
          visited: false,
          isStart: false,
          isEnd:   false,
          debugLog: [],
        };
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  //  PHASE 4 — DOORWAY DETECTION
  // ══════════════════════════════════════════════════════════

  function detectDoorways() {
    doorways = [];
    const seen = new Set();

    for (let y = 1; y < FINE_ROWS - 1; y++) {
      for (let x = 1; x < FINE_COLS - 1; x++) {
        if (getFine(x, y) !== TILE.WALL) continue;

        // A wall tile between two different walkable components = doorway candidate
        const neighbors = [
          [x-1,y], [x+1,y], [x,y-1], [x,y+1]
        ].map(([nx,ny]) => compMap[ny][nx]);

        const compIds = [...new Set(neighbors.filter(id => id !== -1))];
        if (compIds.length < 2) continue;

        // For each pair of different components this wall touches
        for (let i = 0; i < compIds.length; i++) {
          for (let j = i+1; j < compIds.length; j++) {
            const a = compIds[i], b = compIds[j];
            const key = `${Math.min(a,b)}_${Math.max(a,b)}`;
            if (seen.has(key)) continue;
            seen.add(key);

            const exitType = pickExitType();
            const lock     = pickLock(exitType);
            const dw = {
              x, y,
              compA: a, compB: b,
              exitType, lock,
              secret: false,
              discovered: true,
            };
            doorways.push(dw);
            components[a]?.doors.push(dw);
            components[b]?.doors.push(dw);

            // Mark wall tile as door on grid
            setFine(x, y, TILE.DOOR);

            const ca = components[a];
            const cb = components[b];
            if (ca && cb) {
              ca.debugLog.push(`Door to ${cb.identity||cb.type} (${cb.id}): ${exitType}${lock?' ['+lock+']':''}`);
              cb.debugLog.push(`Door to ${ca.identity||ca.type} (${ca.id}): ${exitType}${lock?' ['+lock+']':''}`);
            }
          }
        }
      }
    }
  }

  function pickExitType() {
    const r = Math.random();
    if (r < 0.20) return EXIT_TYPE.OPEN;
    if (r < 0.42) return EXIT_TYPE.DOOR_WOOD;
    if (r < 0.60) return EXIT_TYPE.DOOR_STRONG;
    if (r < 0.76) return EXIT_TYPE.DOOR_METAL;
    if (r < 0.88) return EXIT_TYPE.PORTCULLIS;
    return EXIT_TYPE.BRICKED;
  }

  function pickLock(exitType) {
    if ((exitType === EXIT_TYPE.DOOR_METAL || exitType === EXIT_TYPE.PORTCULLIS) && chance(0.3))
      return pick([LOCK.SKULL, LOCK.STAR]);
    if (exitType === EXIT_TYPE.DOOR_STRONG && chance(0.12))
      return pick([LOCK.SKULL, LOCK.STAR]);
    return LOCK.NONE;
  }

  // ══════════════════════════════════════════════════════════
  //  PHASE 5 — ASSIGN START / END, STAIR
  // ══════════════════════════════════════════════════════════

  function assignStartEnd() {
    const compList = Object.values(components);

    // Start = first room component
    const rooms = compList.filter(c => c.type === COMP.ROOM);
    if (rooms.length === 0) return;

    // Pick spatially distant start and end
    startComp        = rooms[0];
    startComp.isStart = true;
    startComp.debugLog.push('Start room.');

    let farthest = rooms[0];
    let maxDist  = 0;
    for (const r of rooms) {
      const d = Math.abs(r.cx - startComp.cx) + Math.abs(r.cy - startComp.cy);
      if (d > maxDist) { maxDist = d; farthest = r; }
    }
    farthest.isEnd = true;
    farthest.debugLog.push('End room — staircase down.');
    setFine(farthest.cx, farthest.cy, TILE.STAIR_DOWN);

    // Build debug logs
    for (const comp of compList) {
      comp.debugLog.unshift(
        `Type: ${comp.type} | Identity: ${comp.identity}`,
        comp.quality !== 'standard' ? `Quality: ${comp.quality}` : null,
        comp.repurposed ? `Repurposed as: ${comp.repurposedAs}` : null,
        `Size: ${comp.w}×${comp.h} tiles | Doors: ${comp.doors.length}`,
      ).filter(Boolean);
    }
  }

  // ══════════════════════════════════════════════════════════
  //  MAIN GENERATE
  // ══════════════════════════════════════════════════════════

  function generate() {
    depth      = 1;
    components = {};
    doorways   = [];

    initGrids();
    initMaze();

    // Start maze from a random interior cell
    const startCX = rnd(1, MAZE_COLS - 2);
    const startCY = rnd(1, MAZE_ROWS - 2);

    // Use iterative backtracker to avoid stack overflow on large mazes
    mazeVisited[startCY][startCX] = true;
    carveCell(startCX, startCY, TILE.CORRIDOR);
    const stack = [[startCX, startCY]];

    while (stack.length) {
      const [cx, cy] = stack[stack.length - 1];
      const dirs = shuffle([[0,-1],[0,1],[-1,0],[1,0]]);
      let moved = false;

      for (const [dx, dy] of dirs) {
        const nx = cx+dx, ny = cy+dy;
        if (nx<0||nx>=MAZE_COLS||ny<0||ny>=MAZE_ROWS) continue;
        if (mazeVisited[ny][nx]) continue;

        mazeVisited[ny][nx] = true;
        carvePassage(cx, cy, nx, ny);

        if (chance(ROOM_CHANCE)) {
          carveRoom(nx, ny);
        } else {
          carveCell(nx, ny, TILE.CORRIDOR);
        }

        stack.push([nx, ny]);
        moved = true;
        break;
      }

      if (!moved) stack.pop();
    }

    addRoomDetails();
    labelComponents();
    detectDoorways();
    assignStartEnd();

    currentComp = startComp;
    if (currentComp) currentComp.visited = true;

    return { components, currentComp, startComp, depth, TILE };
  }

  // ══════════════════════════════════════════════════════════
  //  NAVIGATION
  // ══════════════════════════════════════════════════════════

  function enterComp(compId, fromCompId) {
    const comp = components[compId];
    if (!comp) return null;
    currentComp = comp;
    currentComp.visited = true;

    const spawnPos = spawnForEntry(comp, fromCompId);
    return { comp, spawnPos };
  }

  function spawnForEntry(comp, fromCompId) {
    if (fromCompId === undefined || fromCompId === null) {
      return { x: comp.cx, y: comp.cy };
    }

    const fromComp = components[fromCompId];
    if (!fromComp) return { x: comp.cx, y: comp.cy };

    // Find the door connecting these two components
    const door = comp.doors.find(d =>
      (d.compA === comp.id && d.compB === fromCompId) ||
      (d.compA === fromCompId && d.compB === comp.id)
    );

    if (door) {
      // Spawn just inside the door, toward the center of the component
      const dx = Math.sign(comp.cx - door.x);
      const dy = Math.sign(comp.cy - door.y);
      const sx = door.x + dx;
      const sy = door.y + dy;
      // Validate it's walkable
      if (isWalkableAt(sx, sy)) return { x: sx, y: sy };
    }

    // Fallback: edge of component facing fromComp
    const dx = fromComp.cx - comp.cx;
    const dy = fromComp.cy - comp.cy;
    if (Math.abs(dx) >= Math.abs(dy)) {
      return { x: dx > 0 ? comp.maxX - 1 : comp.minX + 1, y: comp.cy };
    } else {
      return { x: comp.cx, y: dy > 0 ? comp.maxY - 1 : comp.minY + 1 };
    }
  }

  // ══════════════════════════════════════════════════════════
  //  WALKABILITY & TRANSITION DETECTION
  // ══════════════════════════════════════════════════════════

  function isWalkableAt(x, y) {
    const t = getFine(x, y);
    return t === TILE.FLOOR || t === TILE.CORRIDOR ||
           t === TILE.DOOR  || t === TILE.STAIR_DOWN || t === TILE.STAIR_UP;
  }

  function isWalkable(x, y) { return isWalkableAt(x, y); }

  function getCurrentTile(x, y) { return getFine(x, y); }

  // Check if stepping to (x,y) crosses into a different component
  function checkTransition(x, y) {
    if (!currentComp) return null;
    const id = compMap[y]?.[x];
    if (id === undefined || id === -1) return null;
    if (id === currentComp.id) return null;
    return components[id] || null;
  }

  // Check if (x,y) is a door tile
  function checkDoor(x, y) {
    return getFine(x, y) === TILE.DOOR;
  }

  // ══════════════════════════════════════════════════════════
  //  RENDERING
  // ══════════════════════════════════════════════════════════

  const COLOR = {
    void:        '#08080d',
    floor:       '#2a2535',
    floorAlt:    '#252030',
    corridor:    '#1e1c2a',
    corridorAlt: '#1a1828',
    wall:        '#1a1520',
    wallTop:     '#3d3550',
    wallFace:    '#141018',
    gridLine:    '#1e1a28',
    corrLine:    '#161422',
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
    stairDown:   '#2a4a2a',
    stairIcon:   '#c8a96e',
    player:      '#c8a96e',
    playerOut:   '#0a0a0f',
  };

  function wallMask(x, y) {
    let mask = 0;
    const op = (tx,ty) => { const t=getFine(tx,ty); return t===TILE.WALL||t===TILE.VOID; };
    if (op(x,y-1)) mask|=1;
    if (op(x-1,y)) mask|=2;
    if (op(x+1,y)) mask|=4;
    if (op(x,y+1)) mask|=8;
    return mask;
  }

  function drawTileAt(ctx, x, y, px, py) {
    const s = TILE_SIZE;
    const t = getFine(x, y);

    switch(t) {
      case TILE.VOID:
      default:
        ctx.fillStyle = COLOR.void;
        ctx.fillRect(px, py, s, s);
        break;

      case TILE.FLOOR: {
        const alt = (x+y)%2===0;
        ctx.fillStyle = alt ? COLOR.floor : COLOR.floorAlt;
        ctx.fillRect(px, py, s, s);
        ctx.strokeStyle = COLOR.gridLine;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(px+.5, py+.5, s-1, s-1);
        break;
      }

      case TILE.CORRIDOR: {
        const alt = (x+y)%2===0;
        ctx.fillStyle = alt ? COLOR.corridor : COLOR.corridorAlt;
        ctx.fillRect(px, py, s, s);
        ctx.strokeStyle = COLOR.corrLine;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(px+.5, py+.5, s-1, s-1);
        break;
      }

      case TILE.WALL: {
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
          ctx.fillStyle = 'rgba(0,0,0,0.18)';
          ctx.fillRect(px, py, 3, s);
        }
        break;
      }

      case TILE.DOOR: {
        // Find door object for this position to get type/lock
        const dw = doorways.find(d => d.x===x && d.y===y);
        const et = dw?.exitType || EXIT_TYPE.DOOR_WOOD;
        ctx.fillStyle = COLOR.door[et] || COLOR.door.door_wood;
        ctx.fillRect(px, py, s, s);
        ctx.strokeStyle = COLOR.doorFrame;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(px+2, py+2, s-4, s-4);
        if (dw?.lock === LOCK.SKULL) {
          ctx.fillStyle = COLOR.lockSkull;
          ctx.font = `${Math.floor(s*.45)}px monospace`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('☠', px+s/2, py+s/2);
        } else if (dw?.lock === LOCK.STAR) {
          ctx.fillStyle = COLOR.lockStar;
          ctx.font = `${Math.floor(s*.45)}px monospace`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('★', px+s/2, py+s/2);
        }
        break;
      }

      case TILE.STAIR_DOWN: {
        ctx.fillStyle = COLOR.stairDown;
        ctx.fillRect(px, py, s, s);
        ctx.strokeStyle = COLOR.stairIcon;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px+s*.25,py+s*.3); ctx.lineTo(px+s*.5,py+s*.55); ctx.lineTo(px+s*.75,py+s*.3);
        ctx.moveTo(px+s*.25,py+s*.5); ctx.lineTo(px+s*.5,py+s*.75); ctx.lineTo(px+s*.75,py+s*.5);
        ctx.stroke();
        break;
      }
    }
  }

  function drawPlayer(ctx, px, py) {
    const s=TILE_SIZE, cx=px+s/2, cy=py+s/2, r=s*0.28;
    ctx.beginPath();
    ctx.ellipse(cx,cy+r*.8,r*.7,r*.25,0,0,Math.PI*2);
    ctx.fillStyle='rgba(0,0,0,0.4)'; ctx.fill();
    ctx.beginPath();
    ctx.arc(cx,cy,r,0,Math.PI*2);
    ctx.fillStyle=COLOR.player; ctx.fill();
    ctx.strokeStyle=COLOR.playerOut; ctx.lineWidth=2; ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx,cy+r*.35,r*.22,0,Math.PI*2);
    ctx.fillStyle=COLOR.playerOut; ctx.fill();
  }

  function render(canvas, playerPos) {
    if (!currentComp) return;
    const ctx = canvas.getContext('2d');
    const W   = canvas.width;
    const H   = canvas.height;
    const s   = TILE_SIZE;

    ctx.clearRect(0,0,W,H);
    ctx.fillStyle = COLOR.void;
    ctx.fillRect(0,0,W,H);

    const comp  = currentComp;
    // Viewport: component bounds + 1 tile border
    const vx    = comp.minX - 1;
    const vy    = comp.minY - 1;
    const vw    = comp.w + 2;
    const vh    = comp.h + 2;

    const originX = Math.floor((W - vw*s) / 2);
    const originY = Math.floor((H - vh*s) / 2);

    for (let row=0; row<vh; row++) {
      for (let col=0; col<vw; col++) {
        const mx = vx+col, my = vy+row;
        drawTileAt(ctx, mx, my, originX+col*s, originY+row*s);
      }
    }

    // Player
    const ppx = originX + (playerPos.x - vx) * s;
    const ppy = originY + (playerPos.y - vy) * s;
    drawPlayer(ctx, ppx, ppy);

    // Vignette
    const vig = ctx.createRadialGradient(W/2,H/2,H*.2,W/2,H/2,H*.8);
    vig.addColorStop(0,'rgba(0,0,0,0)');
    vig.addColorStop(1,'rgba(0,0,0,0.6)');
    ctx.fillStyle=vig; ctx.fillRect(0,0,W,H);
  }

  // ══════════════════════════════════════════════════════════
  //  MINIMAP
  // ══════════════════════════════════════════════════════════

  function renderMinimap(canvas) {
    const ctx = canvas.getContext('2d');
    const W   = canvas.width;
    const H   = canvas.height;

    const maxW = W * 0.84;
    const maxH = H * 0.84;
    const scale = Math.min(maxW/FINE_COLS, maxH/FINE_ROWS);
    const mw    = Math.floor(FINE_COLS*scale);
    const mh    = Math.floor(FINE_ROWS*scale);
    const ox    = Math.floor((W-mw)/2);
    const oy    = Math.floor((H-mh)/2);

    ctx.fillStyle = 'rgba(0,0,0,0.92)';
    ctx.beginPath();
    ctx.roundRect(ox-10, oy-10, mw+20, mh+20, 8);
    ctx.fill();
    ctx.strokeStyle = '#2a2a3a';
    ctx.lineWidth = 1;
    ctx.stroke();

    const ts = Math.max(1, Math.ceil(scale));

    for (let y=0; y<FINE_ROWS; y++) {
      for (let x=0; x<FINE_COLS; x++) {
        const t  = getFine(x,y);
        const px = ox + Math.floor(x*scale);
        const py = oy + Math.floor(y*scale);

        switch(t) {
          case TILE.FLOOR:     ctx.fillStyle='#2a2535'; break;
          case TILE.CORRIDOR:  ctx.fillStyle='#1e1c2a'; break;
          case TILE.WALL:      ctx.fillStyle='#3d3550'; break;
          case TILE.DOOR:      ctx.fillStyle='#c8a96e'; break;
          case TILE.STAIR_DOWN:ctx.fillStyle='#2a4a2a'; break;
          default:             ctx.fillStyle='#0a0a0f'; break;
        }
        ctx.fillRect(px, py, ts, ts);
      }
    }

    // Current component outline
    if (currentComp) {
      ctx.strokeStyle = '#c8a96e';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        ox + Math.floor(currentComp.minX*scale),
        oy + Math.floor(currentComp.minY*scale),
        Math.floor(currentComp.w*scale),
        Math.floor(currentComp.h*scale)
      );
    }

    // Player dot
    ctx.fillStyle = '#c8a96e';
    ctx.beginPath();
    ctx.arc(ox+_playerDotX*scale, oy+_playerDotY*scale, Math.max(2,scale*1.5), 0, Math.PI*2);
    ctx.fill();

    ctx.fillStyle = '#c8a96e';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('MAP  [M]', ox+mw/2, oy+mh+16);
  }

  // ══════════════════════════════════════════════════════════
  //  DEBUG OVERLAY
  // ══════════════════════════════════════════════════════════

  function renderDebug(canvas) {
    if (!currentComp) return;
    const ctx = canvas.getContext('2d');
    const W   = canvas.width;
    const c   = currentComp;

    const lines = [
      `COMP ID: ${c.id}  TYPE: ${c.type}`,
      `IDENTITY: ${c.identity}`,
      c.quality !== 'standard' ? `QUALITY: ${c.quality}` : null,
      c.repurposed ? `REPURPOSED AS: ${c.repurposedAs}` : null,
      `SIZE: ${c.w}×${c.h} tiles`,
      `DOORS: ${c.doors.length}`,
      c.isStart ? '★ START' : null,
      c.isEnd   ? '▼ END (stair down)' : null,
      '────────────────────────────',
      ...c.debugLog,
    ].filter(Boolean);

    const pad=14, lh=18, panW=360;
    const panH = pad*2 + lines.length*lh;
    const px = W-panW-16, py = 16;

    ctx.fillStyle = 'rgba(0,0,0,0.88)';
    ctx.beginPath(); ctx.roundRect(px,py,panW,panH,6); ctx.fill();
    ctx.strokeStyle = '#c8a96e44'; ctx.lineWidth=1; ctx.stroke();

    ctx.font='12px monospace'; ctx.textAlign='left'; ctx.textBaseline='top';
    lines.forEach((line,i) => {
      if (line.startsWith('COMP')||line.startsWith('───')) ctx.fillStyle='#c8a96e';
      else if (line.startsWith('★')||line.startsWith('▼')) ctx.fillStyle='#90e090';
      else if (line.toLowerCase().includes('secret')) ctx.fillStyle='#c090e0';
      else ctx.fillStyle='#c4c0ba';
      ctx.fillText(line, px+pad, py+pad+i*lh);
    });

    ctx.fillStyle='#6e6a60'; ctx.font='10px monospace';
    ctx.textAlign='right';
    ctx.fillText('[D] debug', px+panW-8, py+panH-14);
  }

  // ══════════════════════════════════════════════════════════
  //  PUBLIC API
  // ══════════════════════════════════════════════════════════

  function setPlayerDot(x, y) { _playerDotX=x; _playerDotY=y; }

  return {
    TILE,
    EXIT_TYPE,
    LOCK,
    generate,
    enterComp,
    render,
    renderMinimap,
    renderDebug,
    setPlayerDot,
    getCurrentTile,
    isWalkable,
    checkTransition,
    checkDoor,
    get currentComp()  { return currentComp; },
    get components()   { return components; },
    get startComp()    { return startComp; },
    get depth()        { return depth; },
  };

})();
