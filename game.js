// ============================================================
//  DUNGEON CRAWLER — game.js
//  Core loop — room-by-room structure with fade transitions
// ============================================================

const Game = (() => {

  const canvas = document.getElementById('dungeon-canvas');

  // ── Transition state ─────────────────────────────────────
  const TRANSITION_FRAMES = 18;  // ~300ms at 60fps
  let transitioning  = false;
  let transitionDir  = null;     // which door was used
  let transitionNext = null;     // { roomId, fromDir }
  let transAlpha     = 0;        // 0 = clear, 1 = black
  let transPhase     = 'out';    // 'out' | 'in'
  let transFrame     = 0;

  // ── Player position ──────────────────────────────────────
  // Grid-based for now; free movement comes next
  let playerPos = { x: 0, y: 0 };

  // ── Canvas resize ────────────────────────────────────────
  function resizeCanvas() {
    const main    = document.getElementById('game-main');
    canvas.width  = main.clientWidth;
    canvas.height = main.clientHeight;
  }

  // ── HUD ──────────────────────────────────────────────────
  function updateHUD() {
    const s = Player.getState();
    document.getElementById('player-name').textContent  = s.name;
    document.getElementById('player-level').textContent = `Level ${s.level}`;
    document.getElementById('player-hp').textContent    = `HP: ${s.hp}/${s.maxHp}`;
    document.getElementById('dungeon-depth').textContent = `Depth: ${Dungeon.depth}`;
  }

  // ── Message log ──────────────────────────────────────────
  function log(msg, type = '') {
    const el       = document.createElement('div');
    el.className   = 'log-entry' + (type ? ` ${type}` : '');
    el.textContent = msg;
    document.getElementById('message-log').prepend(el);
  }

  // ── Render ───────────────────────────────────────────────
  function render() {
    Dungeon.render(canvas, playerPos);

    // Draw transition overlay
    if (transitioning && transAlpha > 0) {
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = `rgba(0,0,0,${transAlpha})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  // ── Transition loop ──────────────────────────────────────
  function stepTransition() {
    if (!transitioning) return;

    transFrame++;
    const progress = transFrame / TRANSITION_FRAMES;

    if (transPhase === 'out') {
      transAlpha = progress;
      if (transFrame >= TRANSITION_FRAMES) {
        // Screen is black — switch room
        const { room, spawnPos } = Dungeon.enterRoom(
          transitionNext.roomId,
          transitionNext.fromDir
        );
        playerPos = { ...spawnPos };
        Player.init(spawnPos.x, spawnPos.y);
        updateHUD();
        log(`You enter a new chamber.`);

        transPhase = 'in';
        transFrame = 0;
      }
    } else {
      transAlpha = 1 - progress;
      if (transFrame >= TRANSITION_FRAMES) {
        transitioning = false;
        transAlpha    = 0;
      }
    }

    render();
    if (transitioning) requestAnimationFrame(stepTransition);
  }

  function startTransition(roomId, fromDir) {
    if (transitioning) return;
    transitioning      = true;
    transPhase         = 'out';
    transFrame         = 0;
    transAlpha         = 0;
    transitionNext     = { roomId, fromDir };
    requestAnimationFrame(stepTransition);
  }

  // ── Movement & door check ─────────────────────────────────
  function tryMove(dx, dy) {
    if (transitioning) return;

    const nx = playerPos.x + dx;
    const ny = playerPos.y + dy;

    // Check for door
    const doorDir = Dungeon.checkDoor(nx, ny);
    if (doorDir) {
      const room      = Dungeon.currentRoom;
      const nextRoomId = room.doors[doorDir];
      if (nextRoomId) {
        startTransition(nextRoomId, Dungeon.OPPOSITE[doorDir]);
        return;
      }
    }

    // Normal movement
    if (Dungeon.isWalkable(nx, ny)) {
      playerPos.x = nx;
      playerPos.y = ny;

      // Check stair
      const t = Dungeon.getCurrentTile(nx, ny);
      if (t === Dungeon.TILE.STAIR_DOWN) {
        log('You descend to the next floor...', 'loot');
        newFloor();
        return;
      }

      render();
      updateHUD();
    }
  }

  // ── Input ────────────────────────────────────────────────
  const KEYS = {
    ArrowUp:    { dx:  0, dy: -1 },
    ArrowDown:  { dx:  0, dy:  1 },
    ArrowLeft:  { dx: -1, dy:  0 },
    ArrowRight: { dx:  1, dy:  0 },
    w: { dx:  0, dy: -1 },
    s: { dx:  0, dy:  1 },
    a: { dx: -1, dy:  0 },
    d: { dx:  1, dy:  0 },
  };

  function handleKey(e) {
    const dir = KEYS[e.key];
    if (!dir) return;
    e.preventDefault();
    tryMove(dir.dx, dir.dy);
  }

  // ── New floor ────────────────────────────────────────────
  function newFloor() {
    const data = Dungeon.generate();
    const start = data.currentRoom;
    playerPos = {
      x: Math.floor(start.grid[0].length / 2),
      y: Math.floor(start.grid.length / 2),
    };
    Player.init(playerPos.x, playerPos.y);
    render();
    updateHUD();
  }

  // ── Init ─────────────────────────────────────────────────
  function init() {
    resizeCanvas();
    window.addEventListener('resize', () => { resizeCanvas(); render(); });
    window.addEventListener('keydown', handleKey);

    const data  = Dungeon.generate();
    const start = data.currentRoom;
    playerPos = {
      x: Math.floor(start.grid[0].length / 2),
      y: Math.floor(start.grid.length / 2),
    };
    Player.init(playerPos.x, playerPos.y);

    log('You descend into the dungeon. The torches flicker.');
    render();
    updateHUD();
  }

  return { init, log };

})();

window.addEventListener('DOMContentLoaded', Game.init);
