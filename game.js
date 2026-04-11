// ============================================================
//  DUNGEON CRAWLER — game.js
//  Core game loop — ties all modules together
// ============================================================

const Game = (() => {

  const canvas = document.getElementById('dungeon-canvas');

  // ── Resize canvas to fill available space ────────────────
  function resizeCanvas() {
    const main = document.getElementById('game-main');
    canvas.width  = main.clientWidth;
    canvas.height = main.clientHeight;
  }

  // ── HUD update ───────────────────────────────────────────
  function updateHUD() {
    const s = Player.getState();
    document.getElementById('player-name').textContent  = s.name;
    document.getElementById('player-level').textContent = `Level ${s.level}`;
    document.getElementById('player-hp').textContent    = `HP: ${s.hp}/${s.maxHp}`;
  }

  // ── Message log ──────────────────────────────────────────
  function log(msg, type = '') {
    const el = document.createElement('div');
    el.className = 'log-entry' + (type ? ` ${type}` : '');
    el.textContent = msg;
    document.getElementById('message-log').prepend(el);
  }

  // ── Render ───────────────────────────────────────────────
  function render() {
    Dungeon.render(canvas, Player.getPos());
  }

  // ── Input ────────────────────────────────────────────────
  const KEYS = {
    ArrowUp:    { dx:  0, dy: -1 },
    ArrowDown:  { dx:  0, dy:  1 },
    ArrowLeft:  { dx: -1, dy:  0 },
    ArrowRight: { dx:  1, dy:  0 },
    w:          { dx:  0, dy: -1 },
    s:          { dx:  0, dy:  1 },
    a:          { dx: -1, dy:  0 },
    d:          { dx:  1, dy:  0 },
  };

  function handleKey(e) {
    const dir = KEYS[e.key];
    if (!dir) return;
    e.preventDefault();

    const moved = Player.move(dir.dx, dir.dy);
    if (moved) {
      render();
      updateHUD();

      // Check stair
      const pos   = Player.getPos();
      const stair = Dungeon.stairPos;
      if (pos.x === stair.x && pos.y === stair.y) {
        log('You descend deeper into the dungeon...', 'loot');
        newLevel();
      }
    }
  }

  // ── New level ────────────────────────────────────────────
  function newLevel() {
    const data = Dungeon.generate();
    Player.init(data.startPos.x, data.startPos.y);
    render();
    updateHUD();
  }

  // ── Init ─────────────────────────────────────────────────
  function init() {
    resizeCanvas();
    window.addEventListener('resize', () => { resizeCanvas(); render(); });
    window.addEventListener('keydown', handleKey);

    const data = Dungeon.generate();
    Player.init(data.startPos.x, data.startPos.y);

    log('You enter the dungeon. Good luck, adventurer.');
    render();
    updateHUD();
  }

  return { init, log };

})();

// Start
window.addEventListener('DOMContentLoaded', Game.init);
