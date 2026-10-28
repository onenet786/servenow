// Wraps an async schema-check helper (e.g. ensureXxxTable(db)) so its DDL runs
// once per process instead of on every request. ALTER/CREATE statements take
// metadata locks and implicitly commit open transactions, so they must not run
// on hot paths. A failed run is retried on the next call.
function runOncePerProcess(fn) {
  let pending = null;
  return function (...args) {
    if (!pending) {
      pending = Promise.resolve()
        .then(() => fn.apply(this, args))
        .catch((err) => {
          pending = null;
          throw err;
        });
    }
    return pending;
  };
}

module.exports = { runOncePerProcess };
