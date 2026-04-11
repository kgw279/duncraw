// ============================================================
//  DUNGEON CRAWLER — dungeon.js
//  Phase 1: Abstract graph generation (topology)
//  Phase 2: Spatial layout (organic 2D positioning)
//  Phase 3: Screen generation (tile grids per node)
//  Phase 4: Secret layer (hidden connections)
// ============================================================

const Dungeon = (() => {

  // ══════════════════════════════════════════════════════════
  //  CONSTANTS
  // ══════════════════════════════════════════════════════════

  const TILE = {
    VOID:         0,
    FLOOR:        1,
    WALL:         2,
    FLOOR_SECRET: 3,  // secret passage floor (looks like wall until discovered)
    STAIR_DOWN:   4,
    STAIR_UP:     5,
  };

  // Exit types — what the opening looks like
  const EXIT_TYPE = {
    OPEN:         'open',         // open archway
    DOOR_WOOD:    'door_wood',    // simple wooden door
    DOOR_STRONG:  'door_strong',  // reinforced wooden door
    DOOR_METAL:   'door_metal',   // metal door
    PORTCULLIS:   'portcullis',   // mechanism gate
    CREVICE:      'crevice',      // secret crack in wall
    BRICKED:      'bricked',      // sealed (special key/action)
  };

  // Lock symbols
  const LOCK = {
    NONE:  null,
    SKULL: 'skull',
    STAR:  'star',
  };

  // Room identities — what the room originally was
  const ROOM_IDENTITY = [
    'grand_hall', 'barracks', 'bedchamber', 'worship_room',
    'burial_chamber', 'treasury', 'library', 'kitchen',
    'guardroom', 'prison', 'antechamber', 'armory',
  ];

  // Corridor identities
  const CORRIDOR_IDENTITY = [
    'service_passage', 'secret_passage', 'grand_corridor',
    'rough_tunnel', 'carved_hallway', 'natural_cave_passage',
  ];

  // Build quality
  const BUILD_QUALITY = ['crude', 'rough', 'standard', 'fine', 'ornate'];

  // Node types
  const NODE_TYPE = { ROOM: 'room', CORRIDOR: 'corridor', SECRET: 'secret' };

  // Tile display
  const TILE_SIZE = 36;

  // ══════════════════════════════════════════════════════════
  //  STATE
  // ══════════════════════════════════════════════════════════

  let nodes       = {};   // id -> node
  let edges       = [];   // { fromId, toId, fromExit, toExit }
  let currentNode = null;
  let startNodeId = null;
  let depth       = 1;
  let debugOpen   = false;

  // ══════════════════════════════════════════════════════════
  //  RNG UTILITIES
  // ══════════════════════════════════════════════════════════

  function rnd(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function chance(pct) {
    return Math.random() < pct;
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
  //  GRID UTILITIES
  // ══════════════════════════════════════════════════════════

  function makeGrid(cols, rows, fill = TILE.VOID) {
    return Array.from({ length: rows }, () => new Array(cols).fill(fill));
  }

  function setTile(grid, x, y, type) {
    if (y >= 0 && y < grid.length && x >= 0 && x < grid[0].length)
      grid[y][x] = type;
  }

  function getTile(grid, x, y) {
    if (!grid || y < 0 || y >= grid.length || x < 0 || x >= grid[0].length)
      return TILE.VOID;
    return grid[y][x];
  }

  function getCurrentTile(x, y) {
    if (!currentNode) return TILE.VOID;
    return getTile(currentNode.grid, x, y);
  }

  // ══════════════════════════════════════════════════════════
  //  PHASE 1 — ABSTRACT GRAPH GENERATION
  // ══════════════════════════════════════════════════════════

  function makeNodeId() {
    return `n_${Math.random().toString(36).slice(2, 8)}`;
  }

  function makeNode(type, sx, sy) {
    const id       = makeNodeId();
    const identity = type === NODE_TYPE.ROOM
      ? pick(ROOM_IDENTITY)
      : type === NODE_TYPE.SECRET
        ? 'secret_chamber'
        : pick(CORRIDOR_IDENTITY);

    const quality  = pick(BUILD_QUALITY);
    const repurposed = type === NODE_TYPE.ROOM && chance(0.35);

    // Room dimensions based on identity
    const dims = getRoomDims(type, identity);

    return {
      id,
      type,
      identity,
      quality,
      repurposed,
      repurposedAs: repurposed ? pick(ROOM_IDENTITY.filter(r => r !== identity)) : null,
      // Spatial position on the abstract map (grid units)
      sx, sy,
      // Tile grid (generated in Phase 3)
      grid: null,
      cols: dims.cols,
      rows: dims.rows,
      // Exits: array of exit objects { id, wall, offset, exitType, lock, connectedNodeId, connectedExitId, secret, discovered }
      exits: [],
      // Flags
      isStart:  false,
      isEnd:    false,
      visited:  false,
      // Debug info accumulated during generation
      debugLog: [],
    };
  }

  function getRoomDims(type, identity) {
    if (type === NODE_TYPE.CORRIDOR) {
      const horiz = identity === 'grand_corridor' || identity === 'carved_hallway' || identity === 'service_passage';
      if (identity === 'grand_corridor') return chance(0.5)
        ? { cols: 25, rows: 7 } : { cols: 7, rows: 25 };
      if (identity === 'rough_tunnel' || identity === 'natural_cave_passage')
        return chance(0.5) ? { cols: 19, rows: 5 } : { cols: 5, rows: 19 };
      return chance(0.5) ? { cols: 21, rows: 5 } : { cols: 5, rows: 21 };
    }
    if (type === NODE_TYPE.SECRET) return { cols: 13, rows: 11 };

    // Room identity drives size
    const sizes = {
      grand_hall:      { cols: 27, rows: 21 },
      barracks:        { cols: 21, rows: 15 },
      bedchamber:      { cols: 15, rows: 13 },
      worship_room:    { cols: 19, rows: 17 },
      burial_chamber:  { cols: 17, rows: 15 },
      treasury:        { cols: 13, rows: 11 },
      library:         { cols: 17, rows: 13 },
      kitchen:         { cols: 15, rows: 13 },
      guardroom:       { cols: 13, rows: 11 },
      prison:          { cols: 19, rows: 15 },
      antechamber:     { cols: 13, rows: 11 },
      armory:          { cols: 17, rows: 13 },
    };
    return sizes[identity] || { cols: 15, rows: 13 };
  }

  // ── Generate the abstract graph ──────────────────────────
  function generateGraph(targetRooms = 14) {
    nodes = {};
    edges = [];

    // Place start node
    const startNode  = makeNode(NODE_TYPE.ROOM, 0, 0);
    startNode.isStart = true;
    startNode.debugLog.push('Start room — always a room node.');
    nodes[startNode.id] = startNode;
    startNodeId = startNode.id;

    // BFS-style expansion
    const frontier = [startNode.id];
    const placed   = { '0,0': startNode.id };
    let roomCount  = 1;
    let attempts   = 0;

    while (roomCount < targetRooms && attempts < targetRooms * 30) {
      attempts++;
      if (frontier.length === 0) break;

      const parentId = frontier[Math.floor(Math.random() * Math.min(frontier.length, 4))];
      const parent   = nodes[parentId];

      // Pick a direction offset — not limited to cardinal
      // Use a wider set of offsets to create organic branching
      const offsets = shuffle([
        [1,0],[-1,0],[0,1],[0,-1],
        [2,0],[-2,0],[0,2],[0,-2],
        [1,1],[1,-1],[-1,1],[-1,-1],
      ]);

      let placed_this = false;
      for (const [dx, dy] of offsets) {
        const nx  = parent.sx + dx;
        const ny  = parent.sy + dy;
        const key = `${nx},${ny}`;
        if (placed[key]) continue;

        // Decide if we insert a corridor node between parent and new room
        const useCorridor = chance(0.55) && roomCount > 1;
        let prevId = parentId;

        if (useCorridor) {
          const corrNode = makeNode(NODE_TYPE.CORRIDOR, parent.sx + dx * 0.5, parent.sy + dy * 0.5);
          corrNode.debugLog.push(`Corridor connecting rooms. Identity: ${corrNode.identity}`);
          nodes[corrNode.id] = corrNode;
          // Connect parent -> corridor
          connectNodes(parentId, corrNode.id, false);
          prevId = corrNode.id;
        }

        // Decide new node type
        const newType = chance(0.15) && roomCount > 3 ? NODE_TYPE.CORRIDOR : NODE_TYPE.ROOM;
        const newNode = makeNode(newType, nx, ny);
        newNode.debugLog.push(`Generated as: ${newNode.type} — ${newNode.identity}`);
        newNode.debugLog.push(`Build quality: ${newNode.quality}`);
        if (newNode.repurposed) {
          newNode.debugLog.push(`Repurposed: originally ${newNode.identity}, now used as ${newNode.repurposedAs}`);
        }

        nodes[newNode.id] = newNode;
        placed[key]       = newNode.id;
        frontier.push(newNode.id);
        connectNodes(prevId, newNode.id, false);

        if (newType === NODE_TYPE.ROOM) roomCount++;
        placed_this = true;
        break;
      }
    }

    // Mark end node (deepest from start)
    const endId = findDeepestNode(startNodeId);
    nodes[endId].isEnd = true;
    nodes[endId].debugLog.push('End room — staircase down is here.');

    // Phase 4: secret layer
    addSecretConnections();
  }

  function findDeepestNode(startId) {
    // BFS to find the node farthest from start
    const visited = new Set([startId]);
    let queue     = [startId];
    let last      = startId;
    while (queue.length) {
      const next = [];
      for (const id of queue) {
        last = id;
        for (const e of edges) {
          const neighbor = e.fromId === id ? e.toId : e.toId === id ? e.fromId : null;
          if (neighbor && !visited.has(neighbor)) {
            visited.add(neighbor);
            next.push(neighbor);
          }
        }
      }
      queue = next;
    }
    return last;
  }

  // ══════════════════════════════════════════════════════════
  //  PHASE 4 — SECRET LAYER
  // ══════════════════════════════════════════════════════════

  function addSecretConnections() {
    const nodeList = Object.values(nodes);

    // Try to add 2-4 secret connections between non-adjacent nodes
    const secretCount = rnd(2, 4);
    let added = 0;
    let attempts = 0;

    while (added < secretCount && attempts < 50) {
      attempts++;
      const a = pick(nodeList);
      const b = pick(nodeList);
      if (a.id === b.id) continue;

      // Check they aren't already connected
      const alreadyConnected = edges.some(
        e => (e.fromId === a.id && e.toId === b.id) ||
             (e.fromId === b.id && e.toId === a.id)
      );
      if (alreadyConnected) continue;

      // Spatial proximity check — secret passages only between nearby nodes
      const dist = Math.abs(a.sx - b.sx) + Math.abs(a.sy - b.sy);
      if (dist > 3) continue;

      connectNodes(a.id, b.id, true);
      a.debugLog.push(`Secret passage to: ${b.identity} (${b.id})`);
      b.debugLog.push(`Secret passage from: ${a.identity} (${a.id})`);
      added++;
    }

    // Occasionally add a secret room hanging off an existing node
    for (const node of nodeList) {
      if (chance(0.12)) {
        const secretNode = makeNode(NODE_TYPE.SECRET, node.sx + 0.3, node.sy + 0.3);
        secretNode.debugLog.push('Secret chamber — hidden from normal navigation.');
        nodes[secretNode.id] = secretNode;
        connectNodes(node.id, secretNode.id, true);
        node.debugLog.push(`Has secret chamber: ${secretNode.id}`);
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  //  EXIT / CONNECTION SYSTEM
  // ══════════════════════════════════════════════════════════

  function makeExit(wall, offset, exitType, lock, secret) {
    return {
      id:              makeNodeId(),
      wall,            // 'N' | 'S' | 'E' | 'W'
      offset,          // 0.0–1.0 position along the wall
      exitType,
      lock,
      connectedNodeId: null,
      connectedExitId: null,
      secret,
      discovered:      !secret,  // secret exits start undiscovered
    };
  }

  function pickExitType(secret) {
    if (secret) return pick([EXIT_TYPE.CREVICE, EXIT_TYPE.BRICKED]);
    const roll = Math.random();
    if (roll < 0.25) return EXIT_TYPE.OPEN;
    if (roll < 0.50) return EXIT_TYPE.DOOR_WOOD;
    if (roll < 0.68) return EXIT_TYPE.DOOR_STRONG;
    if (roll < 0.80) return EXIT_TYPE.DOOR_METAL;
    if (roll < 0.90) return EXIT_TYPE.PORTCULLIS;
    return EXIT_TYPE.BRICKED;
  }

  function pickLock(exitType, secret) {
    if (secret) return LOCK.NONE;
    if (exitType === EXIT_TYPE.DOOR_METAL || exitType === EXIT_TYPE.PORTCULLIS) {
      if (chance(0.3)) return pick([LOCK.SKULL, LOCK.STAR]);
    }
    if (exitType === EXIT_TYPE.DOOR_STRONG && chance(0.15)) {
      return pick([LOCK.SKULL, LOCK.STAR]);
    }
    return LOCK.NONE;
  }

  // Determine which wall and offset an exit should use between two spatially positioned nodes
  function exitWallAndOffset(fromNode, toNode) {
    const dx = toNode.sx - fromNode.sx;
    const dy = toNode.sy - fromNode.sy;

    // Primary wall based on dominant direction
    let wall;
    if (Math.abs(dx) >= Math.abs(dy)) {
      wall = dx > 0 ? 'E' : 'W';
    } else {
      wall = dy > 0 ? 'S' : 'N';
    }

    // Offset varies based on secondary axis — this puts exits off-center
    let offset;
    if (wall === 'E' || wall === 'W') {
      // Offset along vertical — influenced by dy
      offset = 0.5 + (dy / 4) * 0.3;
    } else {
      // Offset along horizontal — influenced by dx
      offset = 0.5 + (dx / 4) * 0.3;
    }

    // Clamp and add small random variation
    offset = Math.max(0.2, Math.min(0.8, offset + (Math.random() - 0.5) * 0.15));
    return { wall, offset };
  }

  function oppositeWall(wall) {
    return { N: 'S', S: 'N', E: 'W', W: 'E' }[wall];
  }

  function connectNodes(fromId, toId, secret) {
    const from = nodes[fromId];
    const to   = nodes[toId];
    if (!from || !to) return;

    const exitType = pickExitType(secret);
    const lock     = pickLock(exitType, secret);

    const { wall: wallA, offset: offA } = exitWallAndOffset(from, to);
    const wallB  = oppositeWall(wallA);
    const offB   = 1 - offA;

    const exitA = makeExit(wallA, offA, exitType, lock, secret);
    const exitB = makeExit(wallB, offB, exitType, lock, secret);

    exitA.connectedNodeId = toId;
    exitA.connectedExitId = exitB.id;
    exitB.connectedNodeId = fromId;
    exitB.connectedExitId = exitA.id;

    from.exits.push(exitA);
    to.exits.push(exitB);

    edges.push({ fromId, toId, fromExitId: exitA.id, toExitId: exitB.id, secret });

    if (!secret) {
      from.debugLog.push(`Exit ${wallA} (offset ${offA.toFixed(2)}): ${exitType}${lock ? ' [locked: '+lock+']' : ''} → ${to.identity}`);
      to.debugLog.push(`Exit ${wallB} (offset ${offB.toFixed(2)}): ${exitType}${lock ? ' [locked: '+lock+']' : ''} → ${from.identity}`);
    }
  }

  // ══════════════════════════════════════════════════════════
  //  PHASE 3 — SCREEN / TILE GRID GENERATION
  // ══════════════════════════════════════════════════════════

  function buildAllScreens() {
    for (const node of Object.values(nodes)) {
      node.grid = buildScreen(node);
    }
  }

  function buildScreen(node) {
    const { cols, rows, type, identity, quality } = node;

    let grid;
    if (type === NODE_TYPE.CORRIDOR) {
      grid = buildCorridorScreen(cols, rows, identity);
    } else if (type === NODE_TYPE.SECRET) {
      grid = buildSecretScreen(cols, rows);
    } else {
      grid = buildRoomScreen(cols, rows, identity, quality);
    }

    // Carve exits into the grid
    for (const exit of node.exits) {
      if (!exit.discovered && exit.exitType === EXIT_TYPE.CREVICE) continue; // hidden
      carveExit(grid, exit, cols, rows);
    }

    return grid;
  }

  // ── Room screen ──────────────────────────────────────────
  function buildRoomScreen(cols, rows, identity, quality) {
    const grid = makeGrid(cols, rows, TILE.WALL);

    // Base floor shape
    if (quality === 'crude' || quality === 'rough') {
      // Irregular edges
      for (let y = 1; y < rows - 1; y++) {
        for (let x = 1; x < cols - 1; x++) {
          const edge = (x === 1 || x === cols-2 || y === 1 || y === rows-2);
          if (edge && chance(0.15)) continue; // leave some wall nubs
          grid[y][x] = TILE.FLOOR;
        }
      }
    } else {
      // Clean rectangular floor
      for (let y = 1; y < rows - 1; y++)
        for (let x = 1; x < cols - 1; x++)
          grid[y][x] = TILE.FLOOR;
    }

    // Add structural features based on identity
    addRoomFeatures(grid, cols, rows, identity, quality);

    return grid;
  }

  function addRoomFeatures(grid, cols, rows, identity, quality) {
    const cx = Math.floor(cols / 2);
    const cy = Math.floor(rows / 2);

    switch (identity) {
      case 'grand_hall':
        // Rows of pillars
        addPillarRows(grid, cols, rows, quality);
        break;

      case 'worship_room':
        // Central altar block
        addBlock(grid, cx - 1, cy - 2, 3, 4);
        if (quality === 'ornate' || quality === 'fine') {
          addPillarRows(grid, cols, rows, quality);
        }
        break;

      case 'burial_chamber':
        // Sarcophagi arranged in rows
        addSarcophagi(grid, cols, rows);
        break;

      case 'barracks':
        // Rows of cot-sized blocks along walls
        addBarracksCots(grid, cols, rows);
        break;

      case 'prison':
        // Cell dividers
        addPrisonCells(grid, cols, rows);
        break;

      case 'library':
        // Bookshelf rows
        addShelfRows(grid, cols, rows);
        break;

      case 'treasury':
        // Scattered chest blocks
        addScatteredBlocks(grid, cols, rows, 3, 6, 1, 1);
        break;

      case 'guardroom':
        // Central table block
        addBlock(grid, cx - 1, cy - 1, 3, 2);
        break;

      case 'kitchen':
        // Counter along one wall
        addWallCounter(grid, cols, rows);
        break;

      case 'armory':
        // Rack rows
        addShelfRows(grid, cols, rows);
        break;

      default:
        break;
    }
  }

  // ── Feature helpers ──────────────────────────────────────

  function addBlock(grid, x, y, w, h) {
    for (let dy = 0; dy < h; dy++)
      for (let dx = 0; dx < w; dx++)
        setTile(grid, x + dx, y + dy, TILE.WALL);
  }

  function addPillarRows(grid, cols, rows, quality) {
    const spacingX = quality === 'ornate' ? 4 : 5;
    const spacingY = quality === 'ornate' ? 4 : 5;
    for (let y = 2; y < rows - 2; y += spacingY) {
      for (let x = 2; x < cols - 2; x += spacingX) {
        setTile(grid, x, y, TILE.WALL);
      }
    }
  }

  function addSarcophagi(grid, cols, rows) {
    const startX = 3;
    const startY = 3;
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < Math.floor((cols - 4) / 4); col++) {
        const x = startX + col * 4;
        const y = startY + row * (rows - 8);
        addBlock(grid, x, y, 2, 1);
      }
    }
  }

  function addBarracksCots(grid, cols, rows) {
    // Cots along N and S walls
    for (let x = 2; x < cols - 2; x += 3) {
      setTile(grid, x, 2, TILE.WALL);
      setTile(grid, x, rows - 3, TILE.WALL);
    }
  }

  function addPrisonCells(grid, cols, rows) {
    // Vertical dividers creating cells
    const cellW = 4;
    for (let x = cellW; x < cols - 1; x += cellW) {
      for (let y = 1; y < rows - 2; y++)
        setTile(grid, x, y, TILE.WALL);
      // Leave a gap for the cell door
      setTile(grid, x, Math.floor((rows - 1) / 2), TILE.FLOOR);
    }
  }

  function addShelfRows(grid, cols, rows) {
    for (let y = 2; y < rows - 2; y += 3) {
      for (let x = 2; x < cols - 2; x++) {
        if (x % 6 < 4) setTile(grid, x, y, TILE.WALL);
      }
    }
  }

  function addScatteredBlocks(grid, cols, rows, minN, maxN, w, h) {
    const count = rnd(minN, maxN);
    for (let i = 0; i < count; i++) {
      const x = rnd(2, cols - 3 - w);
      const y = rnd(2, rows - 3 - h);
      addBlock(grid, x, y, w, h);
    }
  }

  function addWallCounter(grid, cols, rows) {
    // Counter along east wall
    for (let y = 2; y < rows - 2; y++)
      setTile(grid, cols - 3, y, TILE.WALL);
  }

  // ── Corridor screen ──────────────────────────────────────
  function buildCorridorScreen(cols, rows, identity) {
    const grid = makeGrid(cols, rows, TILE.WALL);
    const isHoriz = cols > rows;

    if (identity === 'natural_cave_passage' || identity === 'rough_tunnel') {
      // Organic passage
      if (isHoriz) {
        const mid = Math.floor(rows / 2);
        for (let x = 1; x < cols - 1; x++) {
          const wobble = Math.round((Math.random() - 0.5) * 1.5);
          const hw = 1 + (chance(0.3) ? 1 : 0);
          for (let dy = -hw; dy <= hw; dy++)
            setTile(grid, x, mid + wobble + dy, TILE.FLOOR);
        }
      } else {
        const mid = Math.floor(cols / 2);
        for (let y = 1; y < rows - 1; y++) {
          const wobble = Math.round((Math.random() - 0.5) * 1.5);
          const hw = 1 + (chance(0.3) ? 1 : 0);
          for (let dx = -hw; dx <= hw; dx++)
            setTile(grid, mid + wobble + dx, y, TILE.FLOOR);
        }
      }
    } else {
      // Clean corridor
      if (isHoriz) {
        for (let y = 1; y < rows - 1; y++)
          for (let x = 1; x < cols - 1; x++)
            grid[y][x] = TILE.FLOOR;
      } else {
        for (let y = 1; y < rows - 1; y++)
          for (let x = 1; x < cols - 1; x++)
            grid[y][x] = TILE.FLOOR;
      }
    }
    return grid;
  }

  // ── Secret screen ────────────────────────────────────────
  function buildSecretScreen(cols, rows) {
    const grid = makeGrid(cols, rows, TILE.WALL);
    // Small irregular chamber
    for (let y = 2; y < rows - 2; y++)
      for (let x = 2; x < cols - 2; x++)
        if (!chance(0.1)) grid[y][x] = TILE.FLOOR;
    return grid;
  }

  // ── Exit carving ─────────────────────────────────────────
  function carveExit(grid, exit, cols, rows) {
    const { wall, offset, exitType } = exit;
    // Width of opening: 1 for crevice/secret, 2 for most, 3 for open/grand
    const w = exitType === EXIT_TYPE.CREVICE ? 1
            : exitType === EXIT_TYPE.OPEN     ? 3
            : 2;

    if (wall === 'N' || wall === 'S') {
      const y   = wall === 'N' ? 0 : rows - 1;
      const cx  = Math.round(offset * (cols - 1));
      const y2  = wall === 'N' ? 1 : rows - 2;
      for (let dx = -Math.floor(w/2); dx <= Math.floor(w/2); dx++) {
        setTile(grid, cx + dx, y,  TILE.FLOOR);
        setTile(grid, cx + dx, y2, TILE.FLOOR);
      }
    } else {
      const x   = wall === 'W' ? 0 : cols - 1;
      const cy  = Math.round(offset * (rows - 1));
      const x2  = wall === 'W' ? 1 : cols - 2;
      for (let dy = -Math.floor(w/2); dy <= Math.floor(w/2); dy++) {
        setTile(grid, x,  cy + dy, TILE.FLOOR);
        setTile(grid, x2, cy + dy, TILE.FLOOR);
      }
    }
  }

  // ── Spawn position for entering from a direction ─────────
  function spawnForExit(node, exit) {
    const cols = node.cols;
    const rows = node.rows;
    const wall = exit.wall;
    const cx   = Math.round(exit.offset * (cols - 1));
    const cy   = Math.round(exit.offset * (rows - 1));

    switch (wall) {
      case 'N': return { x: cx, y: 2 };
      case 'S': return { x: cx, y: rows - 3 };
      case 'E': return { x: cols - 3, y: cy };
      case 'W': return { x: 2, y: cy };
      default:  return { x: Math.floor(cols/2), y: Math.floor(rows/2) };
    }
  }

  // ══════════════════════════════════════════════════════════
  //  WALKABILITY
  // ══════════════════════════════════════════════════════════

  function isWalkable(x, y) {
    const t = getCurrentTile(x, y);
    return t === TILE.FLOOR || t === TILE.STAIR_DOWN || t === TILE.STAIR_UP;
  }

  // Check if position is an exit tile; return the exit object or null
  function checkExit(x, y) {
    if (!currentNode) return null;
    const cols = currentNode.cols;
    const rows = currentNode.rows;

    for (const exit of currentNode.exits) {
      if (!exit.discovered) continue;
      const wall = exit.wall;
      if (wall === 'N' || wall === 'S') {
        const ey  = wall === 'N' ? 0 : rows - 1;
        const ecx = Math.round(exit.offset * (cols - 1));
        const w   = exit.exitType === EXIT_TYPE.OPEN ? 1 : 0;
        if (y === ey && Math.abs(x - ecx) <= w) return exit;
      } else {
        const ex  = wall === 'W' ? 0 : cols - 1;
        const ecy = Math.round(exit.offset * (rows - 1));
        const w   = exit.exitType === EXIT_TYPE.OPEN ? 1 : 0;
        if (x === ex && Math.abs(y - ecy) <= w) return exit;
      }
    }
    return null;
  }

  // ══════════════════════════════════════════════════════════
  //  MAIN GENERATE
  // ══════════════════════════════════════════════════════════

  function generate(targetRooms = 14) {
    depth = 1;
    generateGraph(targetRooms);
    buildAllScreens();

    // Place stair in end node
    const endNode = Object.values(nodes).find(n => n.isEnd);
    if (endNode && endNode.grid) {
      const cx = Math.floor(endNode.cols / 2);
      const cy = Math.floor(endNode.rows / 2);
      setTile(endNode.grid, cx, cy, TILE.STAIR_DOWN);
    }

    currentNode = nodes[startNodeId];
    currentNode.visited = true;

    return { nodes, startNodeId, currentNode, depth, TILE };
  }

  // ══════════════════════════════════════════════════════════
  //  TRANSITION
  // ══════════════════════════════════════════════════════════

  function enterNode(nodeId, fromExitId) {
    currentNode = nodes[nodeId];
    currentNode.visited = true;

    // Find the matching exit in the new node
    const entryExit = currentNode.exits.find(e => e.id === fromExitId);
    const spawnPos  = entryExit
      ? spawnForExit(currentNode, entryExit)
      : { x: Math.floor(currentNode.cols / 2), y: Math.floor(currentNode.rows / 2) };

    return { node: currentNode, spawnPos };
  }

  // ══════════════════════════════════════════════════════════
  //  RENDERING
  // ══════════════════════════════════════════════════════════

  const COLOR = {
    void:        '#0a0a0f',
    floor:       '#2a2535',
    floorAlt:    '#252030',
    wall:        '#1a1520',
    wallTop:     '#3d3550',
    wallFace:    '#141018',
    gridLine:    '#1e1a28',
    exitOpen:    '#3a3020',
    exitWood:    '#4a3218',
    exitStrong:  '#3a2810',
    exitMetal:   '#282838',
    exitPort:    '#1e1e30',
    exitCrevice: '#181418',
    exitBricked: '#1e1820',
    exitFrame:   '#c8a96e',
    lockSkull:   '#c04040',
    lockStar:    '#c8a96e',
    stairDown:   '#2a4a2a',
    stairIcon:   '#c8a96e',
    player:      '#c8a96e',
    playerOut:   '#0a0a0f',
    secret:      '#1a0a1a',
  };

  // Wall bitmask for seamless walls
  function wallMask(grid, x, y) {
    let mask = 0;
    const isOpaque = (tx, ty) => {
      const t = getTile(grid, tx, ty);
      return t === TILE.WALL || t === TILE.VOID;
    };
    if (isOpaque(x, y-1)) mask |= 1;  // N
    if (isOpaque(x-1, y)) mask |= 2;  // W
    if (isOpaque(x+1, y)) mask |= 4;  // E
    if (isOpaque(x, y+1)) mask |= 8;  // S
    return mask;
  }

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
        ctx.fillStyle = COLOR.wall;
        ctx.fillRect(px, py, s, s);
        if (!(mask & 8)) {
          ctx.fillStyle = COLOR.wallTop;
          ctx.fillRect(px, py, s, 5);
          ctx.fillStyle = COLOR.wallFace;
          ctx.fillRect(px, py + 5, s, 8);
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
        ctx.moveTo(px+s*0.25, py+s*0.3);
        ctx.lineTo(px+s*0.5,  py+s*0.55);
        ctx.lineTo(px+s*0.75, py+s*0.3);
        ctx.moveTo(px+s*0.25, py+s*0.5);
        ctx.lineTo(px+s*0.5,  py+s*0.75);
        ctx.lineTo(px+s*0.75, py+s*0.5);
        ctx.stroke();
        break;
      }
    }
  }

  function drawExits(ctx, node, originX, originY) {
    if (!node || !node.exits) return;
    const cols = node.cols;
    const rows = node.rows;
    const s    = TILE_SIZE;

    for (const exit of node.exits) {
      if (!exit.discovered) continue;

      const wall = exit.wall;
      let px, py;

      if (wall === 'N' || wall === 'S') {
        const ecx = Math.round(exit.offset * (cols - 1));
        px = originX + ecx * s;
        py = originY + (wall === 'N' ? 0 : (rows - 1) * s);
      } else {
        const ecy = Math.round(exit.offset * (rows - 1));
        px = originX + (wall === 'W' ? 0 : (cols - 1) * s);
        py = originY + ecy * s;
      }

      // Exit color by type
      const exitColors = {
        [EXIT_TYPE.OPEN]:        COLOR.exitOpen,
        [EXIT_TYPE.DOOR_WOOD]:   COLOR.exitWood,
        [EXIT_TYPE.DOOR_STRONG]: COLOR.exitStrong,
        [EXIT_TYPE.DOOR_METAL]:  COLOR.exitMetal,
        [EXIT_TYPE.PORTCULLIS]:  COLOR.exitPort,
        [EXIT_TYPE.CREVICE]:     COLOR.exitCrevice,
        [EXIT_TYPE.BRICKED]:     COLOR.exitBricked,
      };
      ctx.fillStyle = exitColors[exit.exitType] || COLOR.exitWood;
      ctx.fillRect(px, py, s, s);

      // Frame
      ctx.strokeStyle = COLOR.exitFrame;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(px + 2, py + 2, s - 4, s - 4);

      // Lock symbol
      if (exit.lock === LOCK.SKULL) {
        ctx.fillStyle = COLOR.lockSkull;
        ctx.font = `${Math.floor(s * 0.45)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('☠', px + s/2, py + s/2);
      } else if (exit.lock === LOCK.STAR) {
        ctx.fillStyle = COLOR.lockStar;
        ctx.font = `${Math.floor(s * 0.45)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('★', px + s/2, py + s/2);
      }
    }
  }

  function drawPlayer(ctx, px, py) {
    const s  = TILE_SIZE;
    const cx = px + s / 2;
    const cy = py + s / 2;
    const r  = s * 0.28;

    ctx.beginPath();
    ctx.ellipse(cx, cy + r*0.8, r*0.7, r*0.25, 0, 0, Math.PI*2);
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
    ctx.arc(cx, cy + r*0.35, r*0.22, 0, Math.PI*2);
    ctx.fillStyle = COLOR.playerOut;
    ctx.fill();
  }

  function render(canvas, playerPos) {
    if (!currentNode || !currentNode.grid) return;
    const ctx  = canvas.getContext('2d');
    const W    = canvas.width;
    const H    = canvas.height;
    const grid = currentNode.grid;
    const rows = currentNode.rows;
    const cols = currentNode.cols;
    const s    = TILE_SIZE;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = COLOR.void;
    ctx.fillRect(0, 0, W, H);

    const originX = Math.floor((W - cols * s) / 2);
    const originY = Math.floor((H - rows * s) / 2);

    // Draw tiles
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const tileType = getTile(grid, col, row);
        drawTile(ctx, grid, tileType, originX + col*s, originY + row*s, col, row);
      }
    }

    // Draw exits on top
    drawExits(ctx, currentNode, originX, originY);

    // Draw player
    drawPlayer(ctx, originX + playerPos.x * s, originY + playerPos.y * s);

    // Vignette
    const vignette = ctx.createRadialGradient(W/2, H/2, H*0.25, W/2, H/2, H*0.8);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }

  // ══════════════════════════════════════════════════════════
  //  MINIMAP
  // ══════════════════════════════════════════════════════════

  const MINI = {
    roomW:   24, roomH: 18, gapX: 20, gapY: 16, padding: 24,
    bg:       'rgba(0,0,0,0.88)',
    visited:  '#3a3050', unvisited: '#1a1828',
    current:  '#c8a96e', start: '#2a4a2a', end: '#4a2020',
    secret:   '#3a1a3a', corridor: '#252035',
    connector:'#3a3455', secretLine: '#5a2a5a',
    border:   '#2a2a3a', text: '#c8a96e',
  };

  function renderMinimap(canvas) {
    if (!currentNode) return;
    const ctx      = canvas.getContext('2d');
    const W        = canvas.width;
    const H        = canvas.height;
    const nodeList = Object.values(nodes);

    // Find bounds
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodeList) {
      if (n.sx < minX) minX = n.sx; if (n.sx > maxX) maxX = n.sx;
      if (n.sy < minY) minY = n.sy; if (n.sy > maxY) maxY = n.sy;
    }

    const scaleX = MINI.roomW + MINI.gapX;
    const scaleY = MINI.roomH + MINI.gapY;
    const mapW   = (maxX - minX + 1) * scaleX + MINI.padding * 2;
    const mapH   = (maxY - minY + 1) * scaleY + MINI.padding * 2;
    const ox     = Math.floor((W - mapW) / 2);
    const oy     = Math.floor((H - mapH) / 2);

    ctx.fillStyle = MINI.bg;
    ctx.beginPath();
    ctx.roundRect(ox, oy, mapW, mapH, 10);
    ctx.fill();
    ctx.strokeStyle = MINI.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    function nodeScreen(n) {
      return {
        sx: ox + MINI.padding + (n.sx - minX) * scaleX + MINI.roomW / 2,
        sy: oy + MINI.padding + (n.sy - minY) * scaleY + MINI.roomH / 2,
      };
    }

    // Draw edges
    for (const e of edges) {
      const a = nodes[e.fromId], b = nodes[e.toId];
      if (!a || !b) continue;
      const { sx: ax, sy: ay } = nodeScreen(a);
      const { sx: bx, sy: by } = nodeScreen(b);
      ctx.strokeStyle = e.secret ? MINI.secretLine : MINI.connector;
      ctx.lineWidth   = e.secret ? 1 : 1.5;
      ctx.setLineDash(e.secret ? [3, 3] : []);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Draw nodes
    for (const n of nodeList) {
      const { sx, sy } = nodeScreen(n);
      const rx = sx - MINI.roomW / 2;
      const ry = sy - MINI.roomH / 2;
      const rw = n.type === NODE_TYPE.CORRIDOR ? MINI.roomW * 0.6 : MINI.roomW;
      const rh = n.type === NODE_TYPE.CORRIDOR ? MINI.roomH * 0.6 : MINI.roomH;

      if      (n.id === currentNode.id) ctx.fillStyle = MINI.current;
      else if (n.type === NODE_TYPE.SECRET) ctx.fillStyle = MINI.secret;
      else if (n.isStart)               ctx.fillStyle = MINI.start;
      else if (n.isEnd)                 ctx.fillStyle = MINI.end;
      else if (n.type === NODE_TYPE.CORRIDOR) ctx.fillStyle = MINI.corridor;
      else if (n.visited)               ctx.fillStyle = MINI.visited;
      else                              ctx.fillStyle = MINI.unvisited;

      ctx.beginPath();
      ctx.roundRect(rx, ry, rw, rh, 2);
      ctx.fill();
      ctx.strokeStyle = MINI.border;
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    ctx.fillStyle    = MINI.text;
    ctx.font         = '11px monospace';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('MAP  [M]', ox + mapW / 2, oy + mapH - 6);
  }

  // ══════════════════════════════════════════════════════════
  //  DEBUG OVERLAY
  // ══════════════════════════════════════════════════════════

  function renderDebug(canvas) {
    if (!currentNode) return;
    const ctx  = canvas.getContext('2d');
    const W    = canvas.width;
    const n    = currentNode;

    const lines = [
      `NODE: ${n.id}`,
      `TYPE: ${n.type}`,
      `IDENTITY: ${n.identity}`,
      `QUALITY: ${n.quality}`,
      n.repurposed ? `REPURPOSED AS: ${n.repurposedAs}` : null,
      `SIZE: ${n.cols} × ${n.rows}`,
      `EXITS: ${n.exits.length}`,
      `VISITED: ${n.visited}`,
      n.isStart ? '★ START ROOM' : null,
      n.isEnd   ? '▼ END ROOM (stair down)' : null,
      '─────────────────────',
      ...n.debugLog,
    ].filter(Boolean);

    const pad  = 14;
    const lh   = 18;
    const panW = 340;
    const panH = pad * 2 + lines.length * lh;
    const px   = W - panW - 16;
    const py   = 16;

    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.beginPath();
    ctx.roundRect(px, py, panW, panH, 6);
    ctx.fill();
    ctx.strokeStyle = '#c8a96e44';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font         = '12px monospace';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';

    lines.forEach((line, i) => {
      if (line.startsWith('NODE') || line.startsWith('─')) {
        ctx.fillStyle = '#c8a96e';
      } else if (line.startsWith('★') || line.startsWith('▼')) {
        ctx.fillStyle = '#90e090';
      } else if (line.includes('secret') || line.includes('Secret')) {
        ctx.fillStyle = '#c090e0';
      } else {
        ctx.fillStyle = '#c4c0ba';
      }
      ctx.fillText(line, px + pad, py + pad + i * lh);
    });

    // D key hint
    ctx.fillStyle    = '#6e6a60';
    ctx.font         = '10px monospace';
    ctx.textAlign    = 'right';
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
    enterNode,
    render,
    renderMinimap,
    renderDebug,
    getCurrentTile,
    isWalkable,
    checkExit,
    get currentNode()  { return currentNode; },
    get nodes()        { return nodes; },
    get startNodeId()  { return startNodeId; },
    get depth()        { return depth; },
    get debugOpen()    { return debugOpen; },
    set debugOpen(v)   { debugOpen = v; },
  };

})();
