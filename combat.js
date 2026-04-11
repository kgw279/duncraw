// ============================================================
//  DUNGEON CRAWLER — combat.js
//  Combat resolution
//  (stub — to be expanded)
// ============================================================

const Combat = (() => {

  function resolveTurn(attacker, defender) {
    // Placeholder — real logic coming
    const dmg = Math.max(1, attacker.stats.strength - defender.stats.constitution);
    defender.hp -= dmg;
    return { dmg, defeated: defender.hp <= 0 };
  }

  return { resolveTurn };

})();
