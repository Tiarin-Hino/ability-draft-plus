/**
 * @file Cache management with LRU (Least Recently Used) eviction
 * Provides in-memory caching with automatic eviction of stale/unused entries
 */

const { createLogger } = require('./logger');
const {
    CACHE_MAX_SCAN_RESULTS,
    CACHE_SCAN_RESULT_TTL,
    CACHE_MAX_QUERY_RESULTS,
    CACHE_QUERY_RESULT_TTL,
    CACHE_STALE_WARNING_THRESHOLD
} = require('../constants');

const logger = createLogger('CacheManager');

/**
 * LRU Cache implementation with TTL support
 */
class LRUCache {
    /**
     * Create an LRU cache
     * @param {number} maxSize - Maximum number of entries
     * @param {number} ttl - Time-to-live in milliseconds (0 for no expiry)
     * @param {string} name - Cache name for logging
     */
    constructor(maxSize, ttl = 0, name = 'Cache') {
        this.maxSize = maxSize;
        this.ttl = ttl;
        this.name = name;
        this.cache = new Map(); // Map maintains insertion order
        this.accessOrder = new Map(); // Track last access time
        this.stats = {
            hits: 0,
            misses: 0,
            evictions: 0,
            expirations: 0,
            sets: 0
        };
    }

    /**
     * Check if entry is expired
     * @param {string} key - Cache key
     * @returns {boolean} True if expired
     */
    isExpired(key) {
        if (this.ttl === 0) return false;

        const entry = this.cache.get(key);
        if (!entry) return true;

        const age = Date.now() - entry.timestamp;
        return age > this.ttl;
    }

    /**
     * Get value from cache
     * @param {string} key - Cache key
     * @returns {*} Cached value or undefined if not found/expired
     */
    get(key) {
        // Check if entry exists
        if (!this.cache.has(key)) {
            this.stats.misses++;
            return undefined;
        }

        // Check if entry is expired
        if (this.isExpired(key)) {
            this.delete(key);
            this.stats.expirations++;
            this.stats.misses++;
            logger.debug(`Cache entry expired: ${this.name}/${key}`);
            return undefined;
        }

        // Update access time (for LRU)
        this.accessOrder.set(key, Date.now());

        // Move to end (most recently used)
        const entry = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, entry);

        this.stats.hits++;
        return entry.value;
    }

    /**
     * Set value in cache
     * @param {string} key - Cache key
     * @param {*} value - Value to cache
     */
    set(key, value) {
        // If key already exists, delete it first to update position
        if (this.cache.has(key)) {
            this.cache.delete(key);
            this.accessOrder.delete(key);
        }

        // If at max size, evict least recently used
        if (this.cache.size >= this.maxSize) {
            this.evictLRU();
        }

        // Add new entry
        this.cache.set(key, {
            value,
            timestamp: Date.now()
        });
        this.accessOrder.set(key, Date.now());

        this.stats.sets++;
        logger.debug(`Cache set: ${this.name}/${key}`, {
            size: this.cache.size,
            maxSize: this.maxSize
        });
    }

    /**
     * Evict least recently used entry
     */
    evictLRU() {
        if (this.cache.size === 0) return;

        // Find entry with oldest access time
        let oldestKey = null;
        let oldestTime = Infinity;

        for (const [key, accessTime] of this.accessOrder.entries()) {
            if (accessTime < oldestTime) {
                oldestTime = accessTime;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            this.delete(oldestKey);
            this.stats.evictions++;
            logger.debug(`Evicted LRU entry: ${this.name}/${oldestKey}`, {
                age: Date.now() - oldestTime
            });
        }
    }

    /**
     * Delete entry from cache
     * @param {string} key - Cache key
     * @returns {boolean} True if entry existed and was deleted
     */
    delete(key) {
        this.accessOrder.delete(key);
        return this.cache.delete(key);
    }

    /**
     * Check if key exists and is not expired
     * @param {string} key - Cache key
     * @returns {boolean} True if exists and not expired
     */
    has(key) {
        if (!this.cache.has(key)) return false;
        if (this.isExpired(key)) {
            this.delete(key);
            return false;
        }
        return true;
    }

    /**
     * Clear all entries
     */
    clear() {
        const size = this.cache.size;
        this.cache.clear();
        this.accessOrder.clear();
        logger.info(`Cache cleared: ${this.name}`, { entriesRemoved: size });
    }

    /**
     * Get cache size
     * @returns {number} Number of entries
     */
    size() {
        return this.cache.size;
    }

    /**
     * Get cache statistics
     * @returns {object} Stats object
     */
    getStats() {
        const hitRate =
            this.stats.hits + this.stats.misses > 0
                ? (this.stats.hits / (this.stats.hits + this.stats.misses)) * 100
                : 0;

        return {
            name: this.name,
            size: this.cache.size,
            maxSize: this.maxSize,
            ttl: this.ttl,
            hits: this.stats.hits,
            misses: this.stats.misses,
            hitRate: hitRate.toFixed(2) + '%',
            evictions: this.stats.evictions,
            expirations: this.stats.expirations,
            sets: this.stats.sets
        };
    }

    /**
     * Clean expired entries
     * @returns {number} Number of entries cleaned
     */
    cleanExpired() {
        if (this.ttl === 0) return 0;

        let cleaned = 0;
        const now = Date.now();

        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > this.ttl) {
                this.delete(key);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            this.stats.expirations += cleaned;
            logger.info(`Cleaned expired entries: ${this.name}`, {
                count: cleaned
            });
        }

        return cleaned;
    }

    /**
     * Get all keys
     * @returns {string[]} Array of cache keys
     */
    keys() {
        return Array.from(this.cache.keys());
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            hits: 0,
            misses: 0,
            evictions: 0,
            expirations: 0,
            sets: 0
        };
    }
}

/**
 * Cache Manager - manages multiple caches
 */
class CacheManager {
    constructor() {
        this.caches = new Map();
        this.cleanupInterval = null;

        // Initialize predefined caches
        this.initializeCaches();
    }

    /**
     * Initialize predefined application caches
     */
    initializeCaches() {
        // Scan results cache
        this.caches.set(
            'scanResults',
            new LRUCache(
                CACHE_MAX_SCAN_RESULTS,
                CACHE_SCAN_RESULT_TTL,
                'ScanResults'
            )
        );

        // Database query results cache
        this.caches.set(
            'queryResults',
            new LRUCache(
                CACHE_MAX_QUERY_RESULTS,
                CACHE_QUERY_RESULT_TTL,
                'QueryResults'
            )
        );

        logger.info('Cache manager initialized', {
            caches: Array.from(this.caches.keys())
        });
    }

    /**
     * Get a cache instance
     * @param {string} cacheName - Name of the cache
     * @returns {LRUCache} Cache instance or undefined
     */
    getCache(cacheName) {
        return this.caches.get(cacheName);
    }

    /**
     * Create a new cache
     * @param {string} name - Cache name
     * @param {number} maxSize - Maximum entries
     * @param {number} ttl - Time-to-live in milliseconds
     * @returns {LRUCache} Created cache instance
     */
    createCache(name, maxSize, ttl = 0) {
        if (this.caches.has(name)) {
            logger.warn(`Cache already exists: ${name}`);
            return this.caches.get(name);
        }

        const cache = new LRUCache(maxSize, ttl, name);
        this.caches.set(name, cache);

        logger.info(`Cache created: ${name}`, { maxSize, ttl });
        return cache;
    }

    /**
     * Delete a cache
     * @param {string} name - Cache name
     * @returns {boolean} True if cache existed and was deleted
     */
    deleteCache(name) {
        const existed = this.caches.delete(name);
        if (existed) {
            logger.info(`Cache deleted: ${name}`);
        }
        return existed;
    }

    /**
     * Clear all caches
     */
    clearAll() {
        for (const cache of this.caches.values()) {
            cache.clear();
        }
        logger.info('All caches cleared');
    }

    /**
     * Get statistics for all caches
     * @returns {object} Statistics for all caches
     */
    getAllStats() {
        const stats = {};
        for (const [name, cache] of this.caches.entries()) {
            stats[name] = cache.getStats();
        }
        return stats;
    }

    /**
     * Start periodic cleanup of expired entries
     * @param {number} interval - Cleanup interval in milliseconds
     */
    startPeriodicCleanup(interval = 60000) {
        // Default: 1 minute
        if (this.cleanupInterval) {
            logger.warn('Cleanup already running');
            return;
        }

        this.cleanupInterval = setInterval(() => {
            logger.debug('Running periodic cache cleanup');
            let totalCleaned = 0;

            for (const cache of this.caches.values()) {
                totalCleaned += cache.cleanExpired();
            }

            if (totalCleaned > 0) {
                logger.info('Periodic cleanup completed', {
                    entriesCleaned: totalCleaned
                });
            }
        }, interval);

        logger.info('Periodic cache cleanup started', { interval });
    }

    /**
     * Stop periodic cleanup
     */
    stopPeriodicCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
            logger.info('Periodic cache cleanup stopped');
        }
    }

    /**
     * Check cache health and log warnings
     */
    checkCacheHealth() {
        for (const [name, cache] of this.caches.entries()) {
            const stats = cache.getStats();

            // Warn if cache is nearly full
            if (cache.size() >= cache.maxSize * 0.9) {
                logger.warn(`Cache nearly full: ${name}`, {
                    size: cache.size(),
                    maxSize: cache.maxSize,
                    utilization: ((cache.size() / cache.maxSize) * 100).toFixed(1) + '%'
                });
            }

            // Warn if hit rate is low (< 50%)
            const hitRate = parseFloat(stats.hitRate);
            if (hitRate < 50 && stats.hits + stats.misses > 10) {
                logger.warn(`Low cache hit rate: ${name}`, {
                    hitRate: stats.hitRate,
                    hits: stats.hits,
                    misses: stats.misses
                });
            }

            // Check for stale data
            if (cache.ttl > 0) {
                for (const [key, entry] of cache.cache.entries()) {
                    const age = Date.now() - entry.timestamp;
                    if (
                        age > CACHE_STALE_WARNING_THRESHOLD &&
                        age < cache.ttl
                    ) {
                        logger.debug(`Stale cache entry: ${name}/${key}`, {
                            age
                        });
                    }
                }
            }
        }
    }

    /**
     * Get summary of all caches
     * @returns {string} Human-readable summary
     */
    getSummary() {
        const lines = ['Cache Manager Summary:'];

        for (const [name, cache] of this.caches.entries()) {
            const stats = cache.getStats();
            lines.push(
                `  ${name}: ${stats.size}/${stats.maxSize} entries, ${stats.hitRate} hit rate`
            );
        }

        return lines.join('\n');
    }
}

// Create singleton instance
const cacheManager = new CacheManager();

module.exports = {
    cacheManager,
    LRUCache
};
