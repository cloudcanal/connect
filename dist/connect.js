(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
    typeof define === 'function' && define.amd ? define(['exports'], factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.cc = {}));
})(this, (function (exports) { 'use strict';

    const subscribers = new Map();
    const memoryStore = new Map();
    const STORAGE_PREFIX = 'cc:';
    function getStorage(persistence) {
        switch (persistence) {
            case 'session':
                return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
            case 'local':
                return typeof localStorage !== 'undefined' ? localStorage : null;
            default:
                return null; // window/memory
        }
    }
    function isExpired(store) {
        return store.expiry !== undefined && Date.now() > store.expiry;
    }
    const state = {
        /**
         * Get a value from state
         */
        get(key) {
            // Check memory first
            const mem = memoryStore.get(key);
            if (mem) {
                if (isExpired(mem)) {
                    this.delete(key);
                    return undefined;
                }
                return mem.value;
            }
            // Check persistent stores (session first, then local)
            for (const storageType of ['session', 'local']) {
                const storage = getStorage(storageType);
                if (!storage)
                    continue;
                const raw = storage.getItem(`${STORAGE_PREFIX}${key}`);
                if (raw) {
                    try {
                        const parsed = JSON.parse(raw);
                        if (isExpired(parsed)) {
                            storage.removeItem(`${STORAGE_PREFIX}${key}`);
                            continue;
                        }
                        return parsed.value;
                    }
                    catch {
                        // Invalid JSON, remove it
                        storage.removeItem(`${STORAGE_PREFIX}${key}`);
                    }
                }
            }
            return undefined;
        },
        /**
         * Set a value in state
         */
        set(key, value, options = {}) {
            const { persistence = 'window', expiry } = options;
            const oldValue = this.get(key);
            const store = {
                value,
                persistence,
                expiry: expiry ? Date.now() + expiry : undefined
            };
            const storage = getStorage(persistence);
            if (storage) {
                storage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(store));
            }
            else {
                memoryStore.set(key, store);
            }
            // Notify subscribers
            const subs = subscribers.get(key);
            if (subs) {
                subs.forEach(cb => {
                    try {
                        cb(value, oldValue);
                    }
                    catch (e) {
                        console.error(`Error in state subscriber for "${key}":`, e);
                    }
                });
            }
        },
        /**
         * Check if a key exists in state
         */
        has(key) {
            return this.get(key) !== undefined;
        },
        /**
         * Delete a key from state
         */
        delete(key) {
            const oldValue = this.get(key);
            // Remove from all stores
            memoryStore.delete(key);
            const session = getStorage('session');
            const local = getStorage('local');
            session?.removeItem(`${STORAGE_PREFIX}${key}`);
            local?.removeItem(`${STORAGE_PREFIX}${key}`);
            // Notify subscribers of deletion
            const subs = subscribers.get(key);
            if (subs && oldValue !== undefined) {
                subs.forEach(cb => {
                    try {
                        cb(undefined, oldValue);
                    }
                    catch (e) {
                        console.error(`Error in state subscriber for "${key}":`, e);
                    }
                });
            }
        },
        /**
         * Subscribe to changes on a key
         */
        subscribe(key, callback) {
            if (!subscribers.has(key)) {
                subscribers.set(key, new Set());
            }
            subscribers.get(key).add(callback);
        },
        /**
         * Unsubscribe from changes on a key
         */
        unsubscribe(key, callback) {
            subscribers.get(key)?.delete(callback);
        },
        /**
         * Clear all state (useful for testing or logout)
         */
        clear() {
            // Clear memory
            memoryStore.clear();
            // Clear persistent storage with our prefix
            for (const storageType of ['session', 'local']) {
                const storage = getStorage(storageType);
                if (!storage)
                    continue;
                const keysToRemove = [];
                for (let i = 0; i < storage.length; i++) {
                    const key = storage.key(i);
                    if (key?.startsWith(STORAGE_PREFIX)) {
                        keysToRemove.push(key);
                    }
                }
                keysToRemove.forEach(k => storage.removeItem(k));
            }
            // Clear subscribers
            subscribers.clear();
        }
    };

    const handlers = new Map();
    const events = {
        /**
         * Emit an event with optional payload
         */
        emit(eventName, payload) {
            const eventHandlers = handlers.get(eventName);
            if (!eventHandlers)
                return;
            eventHandlers.forEach(handler => {
                try {
                    handler(payload);
                }
                catch (e) {
                    console.error(`Error in event handler for "${eventName}":`, e);
                }
            });
        },
        /**
         * Subscribe to an event
         */
        on(eventName, handler) {
            if (!handlers.has(eventName)) {
                handlers.set(eventName, new Set());
            }
            handlers.get(eventName).add(handler);
        },
        /**
         * Unsubscribe from an event
         */
        off(eventName, handler) {
            handlers.get(eventName)?.delete(handler);
        },
        /**
         * Subscribe to an event once (auto-unsubscribes after first call)
         */
        once(eventName, handler) {
            const wrapper = (payload) => {
                this.off(eventName, wrapper);
                handler(payload);
            };
            this.on(eventName, wrapper);
        },
        /**
         * Clear all handlers for an event, or all events if no name provided
         */
        clear(eventName) {
            if (eventName) {
                handlers.delete(eventName);
            }
            else {
                handlers.clear();
            }
        }
    };

    let metaData = {
        env: 'production',
        page: {},
        site: {},
        features: {}
    };
    /**
     * Get a nested value from an object using dot notation
     */
    function getNestedValue(obj, path) {
        return path.split('.').reduce((current, key) => {
            if (current && typeof current === 'object' && key in current) {
                return current[key];
            }
            return undefined;
        }, obj);
    }
    const meta = {
        /**
         * Initialize meta data (typically called once at app startup)
         */
        init(data) {
            metaData = { ...metaData, ...data };
        },
        /**
         * Get meta value by key (supports dot notation for nested values)
         * @example meta.get('env') // 'production'
         * @example meta.get('page.title') // 'Home'
         * @example meta.get('features.beta') // true
         */
        get(key) {
            // Check for top-level key first
            if (key in metaData && !key.includes('.')) {
                return metaData[key];
            }
            // Support dot notation
            return getNestedValue(metaData, key);
        },
        /**
         * Check if a meta key exists and is truthy
         * Useful for feature flags: meta.has('features.beta')
         */
        has(key) {
            const value = this.get(key);
            return value !== undefined && value !== null && value !== false;
        },
        /**
         * Set a meta value at runtime
         */
        set(key, value) {
            if (!key.includes('.')) {
                metaData[key] = value;
                return;
            }
            // Handle nested keys
            const parts = key.split('.');
            const lastKey = parts.pop();
            let current = metaData;
            for (const part of parts) {
                if (!(part in current) || typeof current[part] !== 'object') {
                    current[part] = {};
                }
                current = current[part];
            }
            current[lastKey] = value;
        },
        /**
         * Get all meta data (for debugging)
         */
        getAll() {
            return { ...metaData };
        }
    };

    const actions = {
        /**
         * Make an API request
         */
        async api(url, method = 'GET', options = {}) {
            const { body, timeout = 30000, headers = {}, ...restOptions } = options;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            try {
                const fetchOptions = {
                    method,
                    headers: {
                        'Content-Type': 'application/json',
                        ...headers
                    },
                    signal: controller.signal,
                    ...restOptions
                };
                if (body !== undefined && method !== 'GET') {
                    fetchOptions.body = JSON.stringify(body);
                }
                const response = await fetch(url, fetchOptions);
                clearTimeout(timeoutId);
                let data;
                const contentType = response.headers.get('content-type');
                if (contentType?.includes('application/json')) {
                    data = await response.json();
                }
                else {
                    data = await response.text();
                }
                return {
                    data,
                    status: response.status,
                    ok: response.ok
                };
            }
            catch (error) {
                clearTimeout(timeoutId);
                if (error instanceof Error && error.name === 'AbortError') {
                    throw new Error(`Request timeout after ${timeout}ms`);
                }
                throw error;
            }
        },
        /**
         * Focus an element by selector
         */
        focus(selector) {
            const el = document.querySelector(selector);
            if (el) {
                el.focus();
                return true;
            }
            return false;
        },
        /**
         * Scroll an element into view
         */
        scroll(selector, options) {
            const el = document.querySelector(selector);
            if (el) {
                el.scrollIntoView(options ?? { behavior: 'smooth' });
                return true;
            }
            return false;
        },
        /**
         * Delay execution for a specified time
         */
        delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        },
        /**
         * Copy text to clipboard
         */
        async copyToClipboard(text) {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            }
            catch {
                // Fallback for older browsers
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                try {
                    document.execCommand('copy');
                    return true;
                }
                catch {
                    return false;
                }
                finally {
                    document.body.removeChild(textarea);
                }
            }
        },
        /**
         * Read from clipboard
         */
        async readClipboard() {
            try {
                return await navigator.clipboard.readText();
            }
            catch {
                return null;
            }
        },
        /**
         * Dispatch a custom DOM event on an element
         */
        dispatchEvent(selector, eventName, detail) {
            const el = document.querySelector(selector);
            if (el) {
                el.dispatchEvent(new CustomEvent(eventName, {
                    detail,
                    bubbles: true,
                    composed: true
                }));
                return true;
            }
            return false;
        }
    };

    const cc = {
        state,
        events,
        meta,
        actions
    };
    // Auto-attach to window in browser environments
    if (typeof window !== 'undefined') {
        window.cc = cc;
    }

    exports.actions = actions;
    exports.cc = cc;
    exports.default = cc;
    exports.events = events;
    exports.meta = meta;
    exports.state = state;

    Object.defineProperty(exports, '__esModule', { value: true });

}));
//# sourceMappingURL=connect.js.map
