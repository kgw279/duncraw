// ============================================================
//  DUNGEON CRAWLER — game.js
//  Core loop — room-by-room structure with fade transitions
// ============================================================

const Game = (() => {

  const canvas = document.getElementById('dungeon-canvas');

  // ── Transition state ─────────────────────────────────────
  const TRANSITION_FRAMES = 18;
  let transitioning  = false;
  let transitionNext = null;
  let transAlpha     = 0;
  let transPhase     = 'out';
  let transFrame     = 0;

  // ── Minimap toggle ───────────────────────────────────────
  let minimapOpen = false;

  // ── Player position ──────────────────────────────────────
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
    document.getElementById('player-name').textContent   = s.name;
    document.getElementById('player-level').textContent  = `Level ${s.level}`;
    document.getElementById('player-hp').textContent     = `HP: ${s.hp}/${s.maxHp}`;
    document.getElementById('dungeon-depth').textContent = `Depth: ${Dungeon.depth}`;
  }

  // ── Render ───────────────────────────────────────────────
  function render() {
    Dungeon.render(canvas, playerPos);

    if (transitioning && transAlpha > 0) {
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = `rgba(0,0,0,${transAlpha})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    if (minimapOpen) {
      Dungeon.renderMinimap(canvas);
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
        const { spawnPos } = Dungeon.enterRoom(
          transitionNext.roomId,
          transitionNext.fromDir
        );
        playerPos = { ...spawnPos };
        Player.init(spawnPos.x, spawnPos.y);
        updateHUD();
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
    transitioning  = true;
    transPhase     = 'out';
    transFrame     = 0;
    transAlpha     = 0;
    transitionNext = { roomId, fromDir };
    requestAnimationFrame(stepTransition);
  }

  // ── Movement & door check ────────────────────────────────
  function tryMove(dx, dy) {
    if (transitioning) return;

    const nx = playerPos.x + dx;
    const ny = playerPos.y + dy;

    const doorDir = Dungeon.checkDoor(nx, ny);
    if (doorDir) {
      const nextRoomId = Dungeon.currentRoom.doors[doorDir];
      if (nextRoomId) {
        startTransition(nextRoomId, Dungeon.OPPOSITE[doorDir]);
        return;
      }
    }

    if (Dungeon.isWalkable(nx, ny)) {
      playerPos.x = nx;
      playerPos.y = ny;

      if (Dungeon.getCurrentTile(nx, ny) === Dungeon.TILE.STAIR_DOWN) {
        newFloor();
        return;
      }

      render();
      updateHUD();
    }
  }

  // ── Input ────────────────────────────────────────────────
  const MOVE_KEYS = {
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
    if (e.key === 'm' || e.key === 'M') {
      minimapOpen = !minimapOpen;
      render();
      return;
    }

    // Close minimap on any movement key
    if (minimapOpen) {
      minimapOpen = false;
    }

    const dir = MOVE_KEYS[e.key];
    if (!dir) return;
    e.preventDefault();
    tryMove(dir.dx, dir.dy);
  }

  // ── New floor ────────────────────────────────────────────
  function newFloor() {
    const data  = Dungeon.generate();
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

    render();
    updateHUD();
  }

  return { init };

})();

window.addEventListener('DOMContentLoaded', Game.init);
