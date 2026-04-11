// ============================================================
//  DUNGEON CRAWLER — dungeon.js
//  Procedural dungeon generation + top-down canvas renderer
//  with locked camera viewport centered on player
// ============================================================

const Dungeon = (() => {

  // ── Tile types ──────────────────────────────────────────
  const TILE = {
    VOID:       0,
    FLOOR:      1,
    WALL:       2,
    DOOR:       3,
    STAIR_DOWN: 4,
    STAIR_UP:   5,
  };

  // ── Generation config ────────────────────────────────────
  const DEFAULT_CONFIG = {
    cols:     80,
    rows:     60,
    minRooms: 10,
    maxRooms: 20,
    minRoomW: 5,
    maxRoomW: 14,
    minRoomH: 5,
    maxRoomH: 10,
  };

  // ── Camera / tile display config ─────────────────────────
  const TILE_SIZE  = 32;  // px per tile
  const VIEWPORT_W = 23;  // tiles visible horizontally (odd = centered)
  const VIEWPORT_H = 17;  // tiles visible vertically

  // ── Internal state ───────────────────────────────────────
  let grid     = [];
  let rooms    = [];
  let cols     = 0;
  let rows     = 0;
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
      if (getTile(x, y) === TILE.VOID || getTile(x, y) === TILE.WALL)
        setTile(x, y, TILE.FLOOR);
    }
  }

  function carveVertical(y1, y2, x) {
    const [start, end] = y1 < y2 ? [y1, y2] : [y2, y1];
    for (let y = start; y <= end; y++) {
      if (getTile(x, y) === TILE.VOID || getTile(x, y) === TILE.WALL)
        setTile(x, y, TILE.FLOOR);
    }
  }

  // ── Wall pass ────────────────────────────────────────────
  function buildWalls() {
    const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (getTile(x, y) !== TILE.VOID) continue;
        for (const [dx, dy] of dirs) {
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

    grid  = Array.from({ length: rows }, () => new Array(cols).fill(TILE.VOID));
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

    const firstCenter = roomCenter(rooms[0]);
    startPos = { x: firstCenter.x, y: firstCenter.y };

    const lastCenter = roomCenter(rooms[rooms.length - 1]);
    stairPos = { x: lastCenter.x, y: lastCenter.y };
    setTile(stairPos.x, stairPos.y, TILE.STAIR_DOWN);

    return { grid, rooms, startPos, stairPos, cols, rows, TILE };
  }

  // ── Color palette ────────────────────────────────────────
  const COLOR = {
    void:      '#0a0a0f',
    floor:     '#2a2535',
    floorAlt:  '#252030',
    wall:      '#1a1520',
    wallTop:   '#3d3550',
    stairDown: '#2a4a2a',
    stairUp:   '#4a2a2a',
    stairIcon: '#c8a96e',
    player:    '#c8a96e',
    playerOut: '#0a0a0f',
    gridLine:  '#1e1a28',
  };

  // ── Tile renderer ────────────────────────────────────────
  function drawTile(ctx, tileType, px, py, col, row) {
    const s = TILE_SIZE;

    switch (tileType) {
      case TILE.VOID:
        ctx.fillStyle = COLOR.void;
        ctx.fillRect(px, py, s, s);
        break;

      case TILE.FLOOR:
      case TILE.DOOR: {
        const alt = (col + row) % 2 === 0;
        ctx.fillStyle = alt ? COLOR.floor : COLOR.floorAlt;
        ctx.fillRect(px, py, s, s);
        ctx.strokeStyle = COLOR.gridLine;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
        break;
      }

      case TILE.WALL: {
        ctx.fillStyle = COLOR.wall;
        ctx.fillRect(px, py, s, s);
        // Top highlight edge
        ctx.fillStyle = COLOR.wallTop;
        ctx.fillRect(px, py, s, 4);
        // Side shadow
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(px, py + 4, 3, s - 4);
        break;
      }

      case TILE.STAIR_DOWN: {
        ctx.fillStyle = COLOR.stairDown;
        ctx.fillRect(px, py, s, s);
        ctx.strokeStyle = COLOR.stairIcon;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px + s * 0.25, py + s * 0.3);
        ctx.lineTo(px + s * 0.5,  py + s * 0.55);
        ctx.lineTo(px + s * 0.75, py + s * 0.3);
        ctx.moveTo(px + s * 0.25, py + s * 0.5);
        ctx.lineTo(px + s * 0.5,  py + s * 0.75);
        ctx.lineTo(px + s * 0.75, py + s * 0.5);
        ctx.stroke();
        break;
      }

      case TILE.STAIR_UP: {
        ctx.fillStyle = COLOR.stairUp;
        ctx.fillRect(px, py, s, s);
        ctx.strokeStyle = COLOR.stairIcon;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px + s * 0.25, py + s * 0.7);
        ctx.lineTo(px + s * 0.5,  py + s * 0.45);
        ctx.lineTo(px + s * 0.75, py + s * 0.7);
        ctx.moveTo(px + s * 0.25, py + s * 0.5);
        ctx.lineTo(px + s * 0.5,  py + s * 0.25);
        ctx.lineTo(px + s * 0.75, py + s * 0.5);
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

    // Shadow
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.8, r * 0.7, r * 0.25, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fill();

    // Body
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = COLOR.player;
    ctx.fill();
    ctx.strokeStyle = COLOR.playerOut;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Center dot
    ctx.beginPath();
    ctx.arc(cx, cy + r * 0.4, r * 0.25, 0, Math.PI * 2);
    ctx.fillStyle = COLOR.playerOut;
    ctx.fill();
  }

  // ── Main render ──────────────────────────────────────────
  function render(canvas, playerPos) {
    const ctx = canvas.getContext('2d');
    const W   = canvas.width;
    const H   = canvas.height;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = COLOR.void;
    ctx.fillRect(0, 0, W, H);

    const px = playerPos.x;
    const py = playerPos.y;

    const halfW = Math.floor(VIEWPORT_W / 2);
    const halfH = Math.floor(VIEWPORT_H / 2);

    const screenCenterX = Math.floor(W / 2);
    const screenCenterY = Math.floor(H / 2);

    for (let row = py - halfH - 1; row <= py + halfH + 1; row++) {
      for (let col = px - halfW - 1; col <= px + halfW + 1; col++) {
        const tileType = getTile(col, row);
        const screenX  = screenCenterX + (col - px) * TILE_SIZE - TILE_SIZE / 2;
        const screenY  = screenCenterY + (row - py) * TILE_SIZE - TILE_SIZE / 2;
        drawTile(ctx, tileType, screenX, screenY, col, row);
      }
    }

    // Player always drawn at screen center
    drawPlayer(
      ctx,
      screenCenterX - TILE_SIZE / 2,
      screenCenterY - TILE_SIZE / 2
    );

    // Vignette
    const vignette = ctx.createRadialGradient(
      W / 2, H / 2, H * 0.2,
      W / 2, H / 2, H * 0.75
    );
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }

  // ── Public API ───────────────────────────────────────────
  return {
    TILE,
    generate,
    render,
    getTile,
    isWalkable,
    get cols()     { return cols; },
    get rows()     { return rows; },
    get startPos() { return { ...startPos }; },
    get stairPos() { return { ...stairPos }; },
    get rooms()    { return rooms.map(r => ({ ...r })); },
  };

})();
