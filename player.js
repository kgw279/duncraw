// ============================================================
//  DUNGEON CRAWLER — player.js
//  Player state, stats, and movement
//  (stub — to be expanded)
// ============================================================

const Player = (() => {

  let state = {
    name:  'Adventurer',
    level: 1,
    x: 0,
    y: 0,
    hp:    100,
    maxHp: 100,
    stats: {
      strength:     5,
      dexterity:    5,
      constitution: 5,
      intelligence: 5,
    },
    xp:   0,
    gold: 0,
  };

  function init(startX, startY) {
    state.x = startX;
    state.y = startY;
  }

  function getPos()   { return { x: state.x, y: state.y }; }
  function getState() { return { ...state }; }

  function move(dx, dy) {
    const nx = state.x + dx;
    const ny = state.y + dy;
    if (Dungeon.isWalkable(nx, ny)) {
      state.x = nx;
      state.y = ny;
      return true;
    }
    return false;
  }

  return { init, move, getPos, getState };

})();
