function key(resourceType, storeId = "*") { return `gerpgo:${resourceType}:${storeId}`; }
function createCursorStore(db) {
  return {
    get(resourceType, storeId = "*", fallback = null) {
      return db.get(`sync:${key(resourceType, storeId)}`, fallback);
    },
    set(resourceType, storeId = "*", cursor = null) {
      db.set(`sync:${key(resourceType, storeId)}`, cursor);
    },
  };
}
module.exports = { key, createCursorStore };
