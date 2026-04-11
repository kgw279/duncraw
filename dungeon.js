// ============================================================
//  DUNGEON CRAWLER — dungeon.js
//  Room-by-room floor generation (Binding of Isaac style)
//  Varied room shapes: rectangle, wide, tall, hallway, L-shape, cave
// ============================================================

const Dungeon = (() => {

  // ── Tile types ──────────────────────────────────────────
  const TILE = {
    VOID:       0,
    FLOOR:      1,
    WALL:       2,
    DOOR_N:     3,
    DOOR_S:     4,
    DOOR_E:     5,
    DOOR_W:     6,
    STAIR_DOWN: 7,
    STAIR_UP:   8,
  };

  // ── Direction helpers ────────────────────────────────────
  const DIR = {
    N: 'N', S: 'S', E: 'E', W: 'W',
  };

  const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };

  const DIR_OFFSET = {
    N: { dx:  0, dy: -1 },
    S: { dx:  0, dy:  1 },
    E: { dx:  1, dy:  0 },
    W: { dx: -1, dy:  0 },
  };

  // ── Room type definitions ────────────────────────────────
  const ROOM_TYPES = ['rect', 'wide', 'tall', 'hallway_h', 'hallway_v', 'l_shape', 'cave'];

  // Room grid dimensions by type (cols x rows, interior only)
  const ROOM_DIMS = {
    rect:      { cols: 17, rows: 13 },
    wide:      { cols: 25, rows: 9  },
    tall:      { cols: 11, rows: 19 },
    hallway_h: { cols: 23, rows: 5  },
    hallway_v: { cols: 5,  rows: 23 },
    l_shape:   { cols: 19, rows: 15 },
    cave:      { cols: 19, rows: 15 },
  };

  // Which doors each room type supports
  const ROOM_DOORS = {
    rect:      [DIR.N, DIR.S, DIR.E, DIR.W],
    wide:      [DIR.N, DIR.S, DIR.E, DIR.W],
    tall:      [DIR.N, DIR.S, DIR.E, DIR.W],
    hallway_h: [DIR.E, DIR.W],
    hallway_v: [DIR.N, DIR.S],
    l_shape:   [DIR.N, DIR.S, DIR.E, DIR.W],
    cave:      [DIR.N, DIR.S, DIR.E, DIR.W],
  };

  // ── Tile display config ──────────────────────────────────
  const TILE_SIZE = 36;

  // ── Floor state ──────────────────────────────────────────
  let rooms       = {};   // id -> room object
  let currentRoom = null;
  let startRoomId = null;
  let depth       = 1;

  // ── RNG ──────────────────────────────────────────────────
  function rnd(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // ── Grid helpers ─────────────────────────────────────────
  function makeGrid(cols, rows, fill = TILE.VOID) {
    return Array.from({ length: rows }, () => new Array(cols).fill(fill));
  }

  function setTile(grid, x, y, type) {
    if (y >= 0 && y < grid.length && x >= 0 && x < grid[0].length)
      grid[y][x] = type;
  }

  function getTile(grid, x, y) {
    if (y < 0 || y >= grid.length || x < 0 || x >= grid[0].length)
      return TILE.VOID;
    return grid[y][x];
  }

  // ── Room shape generators ────────────────────────────────

  function buildRect(cols, rows) {
    const grid = makeGrid(cols, rows, TILE.WALL);
    for (let y = 1; y < rows - 1; y++)
      for (let x = 1; x < cols - 1; x++)
        grid[y][x] = TILE.FLOOR;
    return grid;
  }

  function buildLShape(cols, rows) {
    const grid = makeGrid(cols, rows, TILE.WALL);
    const splitC = Math.floor(cols * 0.55);
    const splitR = Math.floor(rows * 0.55);
    // Bottom-left block
    for (let y = 1; y < rows - 1; y++)
      for (let x = 1; x < splitC; x++)
        if (y >= splitR || x < splitC)
          grid[y][x] = TILE.FLOOR;
    // Top-right block
    for (let y = 1; y < splitR; y++)
      for (let x = splitC; x < cols - 1; x++)
        grid[y][x] = TILE.FLOOR;
    // Re-wall the outside
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++)
        if (y === 0 || y === rows - 1 || x === 0 || x === cols - 1)
          if (grid[y][x] === TILE.FLOOR) grid[y][x] = TILE.WALL;
    return grid;
  }

  function buildCave(cols, rows) {
    // Cellular automata cave generation
    let grid = makeGrid(cols, rows, TILE.VOID);

    // Seed randomly, keep border as wall
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++)
        grid[y][x] = (y === 0 || y === rows-1 || x === 0 || x === cols-1)
          ? TILE.WALL
          : (Math.random() < 0.45 ? TILE.WALL : TILE.FLOOR);

    // Cellular automata iterations
    for (let iter = 0; iter < 4; iter++) {
      const next = makeGrid(cols, rows, TILE.VOID);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          if (y === 0 || y === rows-1 || x === 0 || x === cols-1) {
            next[y][x] = TILE.WALL;
            continue;
          }
          let walls = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++)
              if (getTile(grid, x+dx, y+dy) === TILE.WALL) walls++;
          next[y][x] = walls >= 5 ? TILE.WALL : TILE.FLOOR;
        }
      }
      grid = next;
    }

    // Ensure a walkable center so player always spawns safely
    const cx = Math.floor(cols / 2);
    const cy = Math.floor(rows / 2);
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++)
        setTile(grid, cx+dx, cy+dy, TILE.FLOOR);

    // Carve guaranteed corridors from center to each edge midpoint
    // so doors placed later are never blocked by cave walls
    const midC = Math.floor(cols / 2);
    const midR = Math.floor(rows / 2);
    // North corridor
    for (let y = 1; y <= midR; y++) setTile(grid, midC, y, TILE.FLOOR);
    // South corridor
    for (let y = midR; y < rows - 1; y++) setTile(grid, midC, y, TILE.FLOOR);
    // West corridor
    for (let x = 1; x <= midC; x++) setTile(grid, x, midR, TILE.FLOOR);
    // East corridor
    for (let x = midC; x < cols - 1; x++) setTile(grid, x, midR, TILE.FLOOR);

    return grid;
  }

  function generateRoomGrid(type) {
    const { cols, rows } = ROOM_DIMS[type];
    switch (type) {
      case 'rect':
      case 'wide':
      case 'tall':
      case 'hallway_h':
      case 'hallway_v': return buildRect(cols, rows);
      case 'l_shape':   return buildLShape(cols, rows);
      case 'cave':      return buildCave(cols, rows);
      default:          return buildRect(cols, rows);
    }
  }

  // ── Door placement ───────────────────────────────────────
  // Doors are carved into the wall at the midpoint of each edge

  function doorTileForDir(dir) {
    return { N: TILE.DOOR_N, S: TILE.DOOR_S, E: TILE.DOOR_E, W: TILE.DOOR_W }[dir];
  }

  function placeDoor(grid, dir) {
    const rows = grid.length;
    const cols = grid[0].length;
    const midC = Math.floor(cols / 2);
    const midR = Math.floor(rows / 2);
    const dt   = doorTileForDir(dir);
    switch (dir) {
      case DIR.N: setTile(grid, midC, 0,      dt); break;
      case DIR.S: setTile(grid, midC, rows-1, dt); break;
      case DIR.E: setTile(grid, cols-1, midR, dt); break;
      case DIR.W: setTile(grid, 0,     midR,  dt); break;
    }
    // Also open the tile just inside the door
    switch (dir) {
      case DIR.N: setTile(grid, midC, 1,      TILE.FLOOR); break;
      case DIR.S: setTile(grid, midC, rows-2, TILE.FLOOR); break;
      case DIR.E: setTile(grid, cols-2, midR, TILE.FLOOR); break;
      case DIR.W: setTile(grid, 1,     midR,  TILE.FLOOR); break;
    }
  }

  // ── Player spawn position in a room ─────────────────────
  function spawnPosForEntry(grid, fromDir) {
    // Spawn player near the door they came from
    const rows = grid.length;
    const cols = grid[0].length;
    const midC = Math.floor(cols / 2);
    const midR = Math.floor(rows / 2);
    switch (fromDir) {
      case DIR.N: return { x: midC, y: 2 };
      case DIR.S: return { x: midC, y: rows - 3 };
      case DIR.E: return { x: cols - 3, y: midR };
      case DIR.W: return { x: 2,        y: midR };
      default:    return { x: midC,     y: midR };
    }
  }

  // ── Floor generation ─────────────────────────────────────

  function generate(numRooms = 12) {
    rooms       = {};
    currentRoom = null;

    let idCounter = 0;
    const makeId  = () => `room_${idCounter++}`;

    // Place rooms on a virtual grid to track connectivity
    // Each room has a grid position { gx, gy }
    const placed = {};  // "gx,gy" -> roomId
    const queue  = [];

    // Start room — always a rect
    const startId = makeId();
    const startType = 'rect';
    const startGrid = generateRoomGrid(startType);
    rooms[startId] = {
      id:        startId,
      type:      startType,
      grid:      startGrid,
      gx:        0,
      gy:        0,
      doors:     {},   // dir -> connectedRoomId
      isStart:   true,
      isEnd:     false,
      visited:   false,
    };
    placed['0,0'] = startId;
    queue.push(startId);
    startRoomId = startId;

    let attempts = 0;
    while (Object.keys(rooms).length < numRooms && attempts < numRooms * 20) {
      attempts++;
      if (queue.length === 0) break;

      const parentId = queue[Math.floor(Math.random() * queue.length)];
      const parent   = rooms[parentId];

      // Pick a random available direction
      const availableDirs = ROOM_DOORS[parent.type].filter(d => !parent.doors[d]);
      if (availableDirs.length === 0) continue;

      const dir    = pick(availableDirs);
      const offset = DIR_OFFSET[dir];
      const ngx    = parent.gx + offset.dx;
      const ngy    = parent.gy + offset.dy;
      const key    = `${ngx},${ngy}`;

      if (placed[key]) continue;  // slot taken

      // Pick a room type compatible with this direction
      const compatTypes = ROOM_TYPES.filter(t => ROOM_DOORS[t].includes(OPPOSITE[dir]));
      const type  = pick(compatTypes);
      const grid  = generateRoomGrid(type);
      const newId = makeId();

      // Wire doors
      placeDoor(parent.grid, dir);
      placeDoor(grid, OPPOSITE[dir]);
      parent.doors[dir] = newId;

      rooms[newId] = {
        id:      newId,
        type,
        grid,
        gx:      ngx,
        gy:      ngy,
        doors:   { [OPPOSITE[dir]]: parentId },
        isStart: false,
        isEnd:   false,
        visited: false,
      };
      placed[key] = newId;
      queue.push(newId);
    }

    // Mark the last room added as the end (has stair down)
    const roomIds  = Object.keys(rooms);
    const endId    = roomIds[roomIds.length - 1];
    const endRoom  = rooms[endId];
    endRoom.isEnd  = true;
    const eg       = endRoom.grid;
    const midC     = Math.floor(eg[0].length / 2);
    const midR     = Math.floor(eg.length / 2);
    setTile(eg, midC, midR, TILE.STAIR_DOWN);

    currentRoom = rooms[startRoomId];
    currentRoom.visited = true;

    return {
      rooms,
      startRoomId,
      currentRoom,
      depth,
      TILE,
    };
  }

  // ── Transition ───────────────────────────────────────────
  function enterRoom(roomId, fromDir) {
    currentRoom = rooms[roomId];
    currentRoom.visited = true;
    const spawnPos = fromDir
      ? spawnPosForEntry(currentRoom.grid, fromDir)
      : { x: Math.floor(currentRoom.grid[0].length / 2), y: Math.floor(currentRoom.grid.length / 2) };
    return { room: currentRoom, spawnPos };
  }

  // ── Tile query ───────────────────────────────────────────
  function getCurrentTile(x, y) {
    if (!currentRoom) return TILE.VOID;
    return getTile(currentRoom.grid, x, y);
  }

  function isWalkable(x, y) {
    const t = getCurrentTile(x, y);
    return t === TILE.FLOOR ||
           t === TILE.DOOR_N || t === TILE.DOOR_S ||
           t === TILE.DOOR_E || t === TILE.DOOR_W ||
           t === TILE.STAIR_DOWN || t === TILE.STAIR_UP;
  }

  // Check if a position is a door and return which dir, or null
  function checkDoor(x, y) {
    const t = getCurrentTile(x, y);
    if (t === TILE.DOOR_N) return DIR.N;
    if (t === TILE.DOOR_S) return DIR.S;
    if (t === TILE.DOOR_E) return DIR.E;
    if (t === TILE.DOOR_W) return DIR.W;
    return null;
  }

  // ── Color palette ────────────────────────────────────────
  const COLOR = {
    void:      '#0a0a0f',
    floor:     '#2a2535',
    floorAlt:  '#252030',
    wall:      '#1a1520',
    wallTop:   '#3d3550',
    wallFace:  '#141018',
    door:      '#4a3a20',
    doorFrame: '#c8a96e',
    stairDown: '#2a4a2a',
    stairIcon: '#c8a96e',
    player:    '#c8a96e',
    playerOut: '#0a0a0f',
    gridLine:  '#1e1a28',
  };

  // ── Wall bitmask ─────────────────────────────────────────
  // 4-bit mask: N=1 W=2 E=4 S=8 — neighbor is also a wall/void?
  function wallMask(grid, x, y) {
    let mask = 0;
    if (getTile(grid, x, y-1) === TILE.WALL || getTile(grid, x, y-1) === TILE.VOID) mask |= 1;  // N
    if (getTile(grid, x-1, y) === TILE.WALL || getTile(grid, x-1, y) === TILE.VOID) mask |= 2;  // W
    if (getTile(grid, x+1, y) === TILE.WALL || getTile(grid, x+1, y) === TILE.VOID) mask |= 4;  // E
    if (getTile(grid, x, y+1) === TILE.WALL || getTile(grid, x, y+1) === TILE.VOID) mask |= 8;  // S
    return mask;
  }

  // ── Tile renderer ────────────────────────────────────────
  function drawTile(ctx, grid, tileType, px, py, col, row) {
    const s = TILE_SIZE;

    switch (tileType) {
      case TILE.VOID:
        ctx.fillStyle = COLOR.void;
        ctx.fillRect(px, py, s, s);
        break;

      case TILE.FLOOR: {
        const alt = (col + row) % 2 === 0;
        ctx.fillStyle = alt ? COLOR.floor : COLOR.floorAlt;
        ctx.fillRect(px, py, s, s);
        ctx.strokeStyle = COLOR.gridLine;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
        break;
      }

      case TILE.WALL: {
        const mask = wallMask(grid, col, row);
        // Base wall
        ctx.fillStyle = COLOR.wall;
        ctx.fillRect(px, py, s, s);

        // If floor is to the south (mask bit 8 NOT set), draw a lit top face
        if (!(mask & 8)) {
          ctx.fillStyle = COLOR.wallTop;
          ctx.fillRect(px, py, s, 5);
          // Dark face below the top highlight
          ctx.fillStyle = COLOR.wallFace;
          ctx.fillRect(px, py + 5, s, 8);
        }

        // Left edge shadow if wall to west
        if (mask & 2) {
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          ctx.fillRect(px, py, 3, s);
        }
        break;
      }

      case TILE.DOOR_N:
      case TILE.DOOR_S:
      case TILE.DOOR_E:
      case TILE.DOOR_W: {
        ctx.fillStyle = COLOR.door;
        ctx.fillRect(px, py, s, s);
        // Door frame accent
        ctx.strokeStyle = COLOR.doorFrame;
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 3, py + 3, s - 6, s - 6);
        // Arrow hint
        ctx.fillStyle = COLOR.doorFrame;
        ctx.font = `${Math.floor(s * 0.5)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const arrows = { [TILE.DOOR_N]: '↑', [TILE.DOOR_S]: '↓', [TILE.DOOR_E]: '→', [TILE.DOOR_W]: '←' };
        ctx.fillText(arrows[tileType], px + s/2, py + s/2);
        break;
      }

      case TILE.STAIR_DOWN: {
        ctx.fillStyle = COLOR.stairDown;
        ctx.fillRect(px, py, s, s);
        ctx.strokeStyle = COLOR.stairIcon;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px + s*0.25, py + s*0.3);
        ctx.lineTo(px + s*0.5,  py + s*0.55);
        ctx.lineTo(px + s*0.75, py + s*0.3);
        ctx.moveTo(px + s*0.25, py + s*0.5);
        ctx.lineTo(px + s*0.5,  py + s*0.75);
        ctx.lineTo(px + s*0.75, py + s*0.5);
        ctx.stroke();
        break;
      }
    }
  }

  // ── Player renderer ──────────────────────────────────────
  function drawPlayer(ctx, px, py) {
    const s  = TILE_SIZE;
    const cx = px + s / 2;
    const cy = py + s / 2;
    const r  = s * 0.28;

    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.8, r * 0.7, r * 0.25, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = COLOR.player;
    ctx.fill();
    ctx.strokeStyle = COLOR.playerOut;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy + r * 0.35, r * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = COLOR.playerOut;
    ctx.fill();
  }

  // ── Main render ──────────────────────────────────────────
  function render(canvas, playerPos) {
    if (!currentRoom) return;
    const ctx  = canvas.getContext('2d');
    const W    = canvas.width;
    const H    = canvas.height;
    const grid = currentRoom.grid;
    const rows = grid.length;
    const cols = grid[0].length;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = COLOR.void;
    ctx.fillRect(0, 0, W, H);

    // Center room on canvas
    const roomPixelW = cols * TILE_SIZE;
    const roomPixelH = rows * TILE_SIZE;
    const originX    = Math.floor((W - roomPixelW) / 2);
    const originY    = Math.floor((H - roomPixelH) / 2);

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const tileType = getTile(grid, col, row);
        const px = originX + col * TILE_SIZE;
        const py = originY + row * TILE_SIZE;
        drawTile(ctx, grid, tileType, px, py, col, row);
      }
    }

    // Draw player
    const ppx = originX + playerPos.x * TILE_SIZE;
    const ppy = originY + playerPos.y * TILE_SIZE;
    drawPlayer(ctx, ppx, ppy);

    // Vignette
    const vignette = ctx.createRadialGradient(W/2, H/2, H*0.25, W/2, H/2, H*0.8);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }

  // ── Minimap renderer ─────────────────────────────────────
  // Draws an overlay showing all rooms as boxes with connection lines
  const MINI = {
    roomW:    28,
    roomH:    20,
    gapX:     18,
    gapY:     14,
    padding:  20,
    bg:       'rgba(0,0,0,0.82)',
    visited:  '#3a3050',
    unvisited:'#1a1828',
    current:  '#c8a96e',
    start:    '#2a4a2a',
    end:      '#4a2020',
    connector:'#4a4060',
    border:   '#2a2a3a',
    text:     '#c8a96e',
  };

  function renderMinimap(canvas) {
    if (!currentRoom) return;
    const ctx = canvas.getContext('2d');
    const W   = canvas.width;
    const H   = canvas.height;

    // Find bounding box of all rooms in grid space
    const roomList = Object.values(rooms);
    let minGX = Infinity, maxGX = -Infinity;
    let minGY = Infinity, maxGY = -Infinity;
    for (const r of roomList) {
      if (r.gx < minGX) minGX = r.gx;
      if (r.gx > maxGX) maxGX = r.gx;
      if (r.gy < minGY) minGY = r.gy;
      if (r.gy > maxGY) maxGY = r.gy;
    }

    const gridW = maxGX - minGX + 1;
    const gridH = maxGY - minGY + 1;
    const mapW  = gridW * (MINI.roomW + MINI.gapX) - MINI.gapX + MINI.padding * 2;
    const mapH  = gridH * (MINI.roomH + MINI.gapY) - MINI.gapY + MINI.padding * 2;

    const originX = Math.floor((W - mapW) / 2);
    const originY = Math.floor((H - mapH) / 2);

    // Background panel
    ctx.fillStyle = MINI.bg;
    ctx.beginPath();
    ctx.roundRect(originX, originY, mapW, mapH, 8);
    ctx.fill();
    ctx.strokeStyle = MINI.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Helper: grid pos to screen pos (center of room box)
    function roomScreenPos(gx, gy) {
      return {
        sx: originX + MINI.padding + (gx - minGX) * (MINI.roomW + MINI.gapX) + MINI.roomW / 2,
        sy: originY + MINI.padding + (gy - minGY) * (MINI.roomH + MINI.gapY) + MINI.roomH / 2,
      };
    }

    // Draw connectors first (behind rooms)
    ctx.strokeStyle = MINI.connector;
    ctx.lineWidth = 2;
    for (const room of roomList) {
      const { sx: ax, sy: ay } = roomScreenPos(room.gx, room.gy);
      for (const dir of Object.keys(room.doors)) {
        const connId  = room.doors[dir];
        const conn    = rooms[connId];
        if (!conn) continue;
        const { sx: bx, sy: by } = roomScreenPos(conn.gx, conn.gy);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }

    // Draw room boxes
    for (const room of roomList) {
      const { sx, sy } = roomScreenPos(room.gx, room.gy);
      const rx = sx - MINI.roomW / 2;
      const ry = sy - MINI.roomH / 2;

      if (room.id === currentRoom.id) {
        ctx.fillStyle = MINI.current;
      } else if (room.isStart) {
        ctx.fillStyle = MINI.start;
      } else if (room.isEnd) {
        ctx.fillStyle = MINI.end;
      } else if (room.visited) {
        ctx.fillStyle = MINI.visited;
      } else {
        ctx.fillStyle = MINI.unvisited;
      }

      ctx.beginPath();
      ctx.roundRect(rx, ry, MINI.roomW, MINI.roomH, 3);
      ctx.fill();
      ctx.strokeStyle = MINI.border;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Label
    ctx.fillStyle = MINI.text;
    ctx.font      = '11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('MAP  [M]', originX + mapW / 2, originY + mapH - 6);
  }

  // ── Public API ───────────────────────────────────────────
  return {
    TILE,
    DIR,
    OPPOSITE,
    generate,
    enterRoom,
    render,
    getCurrentTile,
    isWalkable,
    checkDoor,
    renderMinimap,
    get currentRoom() { return currentRoom; },
    get rooms()       { return rooms; },
    get startRoomId() { return startRoomId; },
    get depth()       { return depth; },
  };

})();
