// ============================================================
//  DUNGEON CRAWLER — dungeon.js
//  Procedural dungeon generation + axonometric tile renderer
// ============================================================

const Dungeon = (() => {

  // ── Tile types ──────────────────────────────────────────
  const TILE = {
    VOID:  0,
    FLOOR: 1,
    WALL:  2,
    DOOR:  3,
    STAIR_DOWN: 4,
    STAIR_UP:   5,
  };

  // ── Generation config ────────────────────────────────────
  const DEFAULT_CONFIG = {
    cols:       40,
    rows:       30,
    minRooms:   6,
    maxRooms:   12,
    minRoomW:   4,
    maxRoomW:   10,
    minRoomH:   4,
    maxRoomH:   8,
  };

  // ── Internal state ───────────────────────────────────────
  let grid   = [];   // 2D array of TILE values
  let rooms  = [];   // { x, y, w, h }
  let cols   = 0;
  let rows   = 0;
  let startPos = { x: 0, y: 0 };
  let stairPos = { x: 0, y: 0 };

  // ── Helpers ──────────────────────────────────────────────
  function rnd(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function setTile(x, y, type) {
    if (x >= 0 && x < cols && y >= 0 && y < rows) grid[y][x] = type;
  }

  function getTile(x, y) {
    if (x < 0 || x >= cols || y < 0 || y >= rows) return TILE.VOID;
    return grid[y][x];
  }

  function isWalkable(x, y) {
    const t = getTile(x, y);
    return t === TILE.FLOOR || t === TILE.DOOR ||
           t === TILE.STAIR_DOWN || t === TILE.STAIR_UP;
  }

  // ── Room carving ─────────────────────────────────────────
  function carveRoom(room) {
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        setTile(x, y, TILE.FLOOR);
      }
    }
  }

  function roomsOverlap(a, b, padding = 1) {
    return !(a.x + a.w + padding <= b.x ||
             b.x + b.w + padding <= a.x ||
             a.y + a.h + padding <= b.y ||
             b.y + b.h + padding <= a.y);
  }

  function roomCenter(room) {
    return {
      x: Math.floor(room.x + room.w / 2),
      y: Math.floor(room.y + room.h / 2),
    };
  }

  // ── Corridor carving ─────────────────────────────────────
  function carveCorridor(ax, ay, bx, by) {
    // L-shaped corridor: horizontal then vertical (or vice versa)
    if (Math.random() < 0.5) {
      carveHorizontal(ax, bx, ay);
      carveVertical(ay, by, bx);
    } else {
      carveVertical(ay, by, ax);
      carveHorizontal(ax, bx, by);
    }
  }

  function carveHorizontal(x1, x2, y) {
    const [start, end] = x1 < x2 ? [x1, x2] : [x2, x1];
    for (let x = start; x <= end; x++) {
      if (getTile(x, y) === TILE.VOID || getTile(x, y) === TILE.WALL) {
        setTile(x, y, TILE.FLOOR);
      }
    }
  }

  function carveVertical(y1, y2, x) {
    const [start, end] = y1 < y2 ? [y1, y2] : [y2, y1];
    for (let y = start; y <= end; y++) {
      if (getTile(x, y) === TILE.VOID || getTile(x, y) === TILE.WALL) {
        setTile(x, y, TILE.FLOOR);
      }
    }
  }

  // ── Wall pass ────────────────────────────────────────────
  // Surround every floor tile that borders VOID with WALL
  function buildWalls() {
    const directions = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (getTile(x, y) !== TILE.VOID) continue;
        for (const [dx, dy] of directions) {
          if (getTile(x + dx, y + dy) === TILE.FLOOR) {
            setTile(x, y, TILE.WALL);
            break;
          }
        }
      }
    }
  }

  // ── Main generation ──────────────────────────────────────
  function generate(config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    cols = cfg.cols;
    rows = cfg.rows;

    // Init grid with VOID
    grid = Array.from({ length: rows }, () => new Array(cols).fill(TILE.VOID));
    rooms = [];

    const numRooms = rnd(cfg.minRooms, cfg.maxRooms);

    for (let attempt = 0; attempt < numRooms * 10 && rooms.length < numRooms; attempt++) {
      const w = rnd(cfg.minRoomW, cfg.maxRoomW);
      const h = rnd(cfg.minRoomH, cfg.maxRoomH);
      const x = rnd(1, cols - w - 2);
      const y = rnd(1, rows - h - 2);
      const room = { x, y, w, h };

      if (rooms.some(r => roomsOverlap(r, room))) continue;

      carveRoom(room);

      if (rooms.length > 0) {
        const prev = roomCenter(rooms[rooms.length - 1]);
        const curr = roomCenter(room);
        carveCorridor(prev.x, prev.y, curr.x, curr.y);
      }

      rooms.push(room);
    }

    buildWalls();

    // Place player start in center of first room
    const firstCenter = roomCenter(rooms[0]);
    startPos = { x: firstCenter.x, y: firstCenter.y };

    // Place stair down in last room
    const lastCenter = roomCenter(rooms[rooms.length - 1]);
    stairPos = { x: lastCenter.x, y: lastCenter.y };
    setTile(stairPos.x, stairPos.y, TILE.STAIR_DOWN);

    return { grid, rooms, startPos, stairPos, cols, rows, TILE };
  }

  // ── Axonometric renderer ─────────────────────────────────
  //
  //  Axonometric projection:
  //    screen_x = (col - row) * (TILE_W / 2)
  //    screen_y = (col + row) * (TILE_H / 2)
  //
  //  Each tile is drawn as a flat top face (parallelogram).
  //  Walls additionally get a left and right side face for depth.

  const TILE_W     = 48;
  const TILE_H     = 24;
  const WALL_DEPTH = 20;

  // Color palette (mirrors CSS variables for canvas)
  const COLOR = {
    floorTop:   '#1e1e2e',
    floorLeft:  '#16161f',
    floorRight: '#1a1a28',
    floorEdge:  '#2a2a40',

    wallTop:    '#3a3050',
    wallLeft:   '#2a2040',
    wallRight:  '#221830',
    wallEdge:   '#4a3a60',

    stairTop:   '#2a3a2a',
    stairLeft:  '#1a2a1a',
    stairRight: '#1e2e1e',

    voidFill:   '#0a0a0f',

    playerFill: '#c8a96e',
    playerRing: '#ffffff',
  };

  function tileToScreen(col, row, offsetX, offsetY) {
    return {
      sx: offsetX + (col - row) * (TILE_W / 2),
      sy: offsetY + (col + row) * (TILE_H / 2),
    };
  }

  // Draw a diamond top face
  function drawTop(ctx, sx, sy, fillColor, strokeColor) {
    ctx.beginPath();
    ctx.moveTo(sx,                sy - TILE_H / 2);  // top
    ctx.lineTo(sx + TILE_W / 2,  sy);                // right
    ctx.lineTo(sx,                sy + TILE_H / 2);  // bottom
    ctx.lineTo(sx - TILE_W / 2,  sy);                // left
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
    if (strokeColor) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
  }

  // Draw left side face of a wall block
  function drawWallLeft(ctx, sx, sy, fillColor) {
    ctx.beginPath();
    ctx.moveTo(sx - TILE_W / 2, sy);                     // top-left of diamond
    ctx.lineTo(sx,               sy + TILE_H / 2);        // bottom of diamond
    ctx.lineTo(sx,               sy + TILE_H / 2 + WALL_DEPTH); // bottom-bottom
    ctx.lineTo(sx - TILE_W / 2, sy + WALL_DEPTH);         // left bottom
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
  }

  // Draw right side face of a wall block
  function drawWallRight(ctx, sx, sy, fillColor) {
    ctx.beginPath();
    ctx.moveTo(sx + TILE_W / 2, sy);                     // top-right of diamond
    ctx.lineTo(sx,               sy + TILE_H / 2);        // bottom of diamond
    ctx.lineTo(sx,               sy + TILE_H / 2 + WALL_DEPTH);
    ctx.lineTo(sx + TILE_W / 2, sy + WALL_DEPTH);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
  }

  function drawTile(ctx, col, row, tileType, offsetX, offsetY) {
    const { sx, sy } = tileToScreen(col, row, offsetX, offsetY);

    if (tileType === TILE.VOID) return;

    if (tileType === TILE.WALL) {
      // Draw side faces first (painter's algorithm — back to front)
      drawWallLeft(ctx,  sx, sy - WALL_DEPTH, COLOR.wallLeft);
      drawWallRight(ctx, sx, sy - WALL_DEPTH, COLOR.wallRight);
      drawTop(ctx, sx, sy - WALL_DEPTH, COLOR.wallTop, COLOR.wallEdge);
    } else if (tileType === TILE.STAIR_DOWN || tileType === TILE.STAIR_UP) {
      drawWallLeft(ctx,  sx, sy - WALL_DEPTH / 2, COLOR.stairLeft);
      drawWallRight(ctx, sx, sy - WALL_DEPTH / 2, COLOR.stairRight);
      drawTop(ctx, sx, sy - WALL_DEPTH / 2, COLOR.stairTop, COLOR.floorEdge);
    } else {
      drawTop(ctx, sx, sy, COLOR.floorTop, COLOR.floorEdge);
    }
  }

  function drawPlayer(ctx, col, row, offsetX, offsetY) {
    const { sx, sy } = tileToScreen(col, row, offsetX, offsetY);
    // Draw a small diamond marker above the floor tile
    const py = sy - 14;
    ctx.beginPath();
    ctx.arc(sx, py, 8, 0, Math.PI * 2);
    ctx.fillStyle = COLOR.playerFill;
    ctx.fill();
    ctx.strokeStyle = COLOR.playerRing;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function render(canvas, playerPos) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = COLOR.voidFill;
    ctx.fillRect(0, 0, W, H);

    // Center the map on screen
    const mapPixelW = (cols + rows) * (TILE_W / 2);
    const mapPixelH = (cols + rows) * (TILE_H / 2);
    const offsetX = W / 2;
    const offsetY = (H - mapPixelH) / 2 + TILE_H;

    // Painter's algorithm: render row by row, top to bottom
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        drawTile(ctx, col, row, getTile(col, row), offsetX, offsetY);
      }
    }

    if (playerPos) {
      drawPlayer(ctx, playerPos.x, playerPos.y, offsetX, offsetY);
    }
  }

  // ── Public API ───────────────────────────────────────────
  return {
    TILE,
    generate,
    render,
    getTile,
    isWalkable,
    tileToScreen,
    get cols() { return cols; },
    get rows() { return rows; },
    get startPos() { return { ...startPos }; },
    get stairPos() { return { ...stairPos }; },
    get rooms() { return rooms.map(r => ({ ...r })); },
  };

})();
