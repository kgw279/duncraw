// ============================================================
//  DUNGEON CRAWLER — game.js
//  Core loop — node-based dungeon, fade transitions, debug overlay
// ============================================================

const Game = (() => {

  const canvas = document.getElementById('dungeon-canvas');

  // ── Transition ───────────────────────────────────────────
  const TRANSITION_FRAMES = 16;
  let transitioning  = false;
  let transitionNext = null;   // { nodeId, fromExitId }
  let transAlpha     = 0;
  let transPhase     = 'out';
  let transFrame     = 0;

  // ── UI toggles ───────────────────────────────────────────
  let minimapOpen = false;
  let debugOpen   = false;

  // ── Player position (tile grid coords) ───────────────────
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

    if (minimapOpen) Dungeon.renderMinimap(canvas);
    if (debugOpen)   Dungeon.renderDebug(canvas);
  }

  // ── Transition ───────────────────────────────────────────
  function stepTransition() {
    if (!transitioning) return;
    transFrame++;
    const progress = transFrame / TRANSITION_FRAMES;

    if (transPhase === 'out') {
      transAlpha = progress;
      if (transFrame >= TRANSITION_FRAMES) {
        const { spawnPos } = Dungeon.enterNode(
          transitionNext.nodeId,
          transitionNext.fromExitId
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

  function startTransition(nodeId, fromExitId) {
    if (transitioning) return;
    transitioning  = true;
    transPhase     = 'out';
    transFrame     = 0;
    transAlpha     = 0;
    transitionNext = { nodeId, fromExitId };
    requestAnimationFrame(stepTransition);
  }

  // ── Movement ─────────────────────────────────────────────
  function tryMove(dx, dy) {
    if (transitioning) return;

    const nx = playerPos.x + dx;
    const ny = playerPos.y + dy;

    // Check exit
    const exit = Dungeon.checkExit(nx, ny);
    if (exit && exit.connectedNodeId) {
      if (exit.lock) {
        // Locked — do nothing for now (key system TBD)
        return;
      }
      startTransition(exit.connectedNodeId, exit.connectedExitId);
      return;
    }

    // Check stair
    if (Dungeon.getCurrentTile(nx, ny) === Dungeon.TILE.STAIR_DOWN) {
      newFloor();
      return;
    }

    // Normal move
    if (Dungeon.isWalkable(nx, ny)) {
      playerPos.x = nx;
      playerPos.y = ny;
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
    // Toggles
    if (e.key === 'm' || e.key === 'M') {
      minimapOpen = !minimapOpen;
      if (minimapOpen) debugOpen = false;
      render();
      return;
    }
    if (e.key === 'd' || e.key === 'D') {
      debugOpen   = !debugOpen;
      if (debugOpen) minimapOpen = false;
      render();
      return;
    }

    // Movement closes overlays
    const dir = MOVE_KEYS[e.key];
    if (!dir) return;
    e.preventDefault();
    minimapOpen = false;
    debugOpen   = false;
    tryMove(dir.dx, dir.dy);
  }

  // ── New floor ────────────────────────────────────────────
  function newFloor() {
    const data  = Dungeon.generate();
    const start = data.currentNode;
    playerPos   = {
      x: Math.floor(start.cols / 2),
      y: Math.floor(start.rows / 2),
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
    const start = data.currentNode;
    playerPos   = {
      x: Math.floor(start.cols / 2),
      y: Math.floor(start.rows / 2),
    };
    Player.init(playerPos.x, playerPos.y);

    render();
    updateHUD();
  }

  return { init };

})();

window.addEventListener('DOMContentLoaded', Game.init);
