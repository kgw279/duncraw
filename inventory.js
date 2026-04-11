// ============================================================
//  DUNGEON CRAWLER — inventory.js
//  Item and inventory management
//  (stub — to be expanded)
// ============================================================

const Inventory = (() => {

  let items = [];

  function add(item) {
    items.push(item);
    return true;
  }

  function remove(index) {
    if (index < 0 || index >= items.length) return null;
    return items.splice(index, 1)[0];
  }

  function getAll() { return [...items]; }

  return { add, remove, getAll };

})();
