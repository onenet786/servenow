/**
 * High-performance in-memory cache with TTL support and prefix invalidation.
 * Eliminates redundant database roundtrips for read-heavy, low-churn endpoints.
 */
class MemoryCache {
  constructor(defaultTtlMs = 60000) {
    this.cache = new Map();
    this.defaultTtl = defaultTtlMs;

    // Periodic cleanup of expired entries every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000).unref();
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expires) {
      this.cache.delete(key);
      return null;
    }
    return item.data;
  }

  set(key, data, ttlMs = this.defaultTtl) {
    this.cache.set(key, {
      data,
      expires: Date.now() + ttlMs,
    });
  }

  del(key) {
    this.cache.delete(key);
  }

  clearPrefix(prefix) {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  cleanup() {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expires) {
        this.cache.delete(key);
      }
    }
  }

  clear() {
    this.cache.clear();
  }
}

module.exports = new MemoryCache();
