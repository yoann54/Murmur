/*
 * config.js — versioned settings, persisted on the phone.
 *
 * PebbleAI persisted a Settings struct with no schema version (bug #8), so
 * adding a field across an update corrupted the saved blob. Here the config
 * carries a `version` and load() runs a migration ladder before use.
 *
 * API keys live ONLY here, in phone-side storage — never sent to the watch.
 * (PebbleAI got this right and we keep it: only a "key is set" boolean ever
 * crosses to the watch.) keySet() exposes exactly that boolean.
 *
 * Storage is abstracted so the module can be required and unit-tested under
 * Node, where localStorage does not exist.
 */

var SCHEMA_VERSION = 1;
var STORE_KEY = 'murmur.config';

var memoryStore = {};
function storage() {
  if (typeof localStorage !== 'undefined' && localStorage) {
    return localStorage;
  }
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(memoryStore, k) ? memoryStore[k] : null; },
    setItem: function (k, v) { memoryStore[k] = String(v); },
    removeItem: function (k) { delete memoryStore[k]; }
  };
}

function defaults() {
  return {
    version: SCHEMA_VERSION,
    activeProvider: 'anthropic',
    // providers[id] = { model, baseUrl, apiKey }
    providers: {},
    system: '',
    temperature: undefined,
    maxTokens: undefined,
    historyTurns: 6,
    timeoutMs: 30000,
    autoScroll: false,    // auto-scroll the reply on the watch
    scrollSpeed: 2        // 1 slow / 2 medium / 3 fast
  };
}

/* Migration ladder. Each step upgrades from version N to N+1. When the schema
 * grows, add a step here rather than mutating defaults() destructively. */
function migrate(cfg) {
  if (!cfg || typeof cfg !== 'object') {
    return defaults();
  }
  // Future: while (cfg.version < SCHEMA_VERSION) { ...; cfg.version++; }
  if (typeof cfg.version !== 'number') {
    cfg.version = SCHEMA_VERSION;
  }
  // Fill any missing top-level keys from defaults without clobbering existing.
  var base = defaults();
  Object.keys(base).forEach(function (k) {
    if (cfg[k] === undefined) { cfg[k] = base[k]; }
  });
  if (!cfg.providers || typeof cfg.providers !== 'object') {
    cfg.providers = {};
  }
  cfg.version = SCHEMA_VERSION;
  return cfg;
}

function load() {
  var raw = storage().getItem(STORE_KEY);
  if (!raw) {
    return defaults();
  }
  var parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return defaults();
  }
  return migrate(parsed);
}

function save(cfg) {
  cfg.version = SCHEMA_VERSION;
  storage().setItem(STORE_KEY, JSON.stringify(cfg));
  return cfg;
}

/* Per-provider view merged with defaults so callers always get a usable shape. */
function providerConfig(cfg, providerId, providerDefaults) {
  var p = (cfg.providers && cfg.providers[providerId]) || {};
  var dflt = providerDefaults || {};
  return {
    model: p.model || dflt.defaultModel || '',
    baseUrl: p.baseUrl || dflt.defaultBaseUrl || '',
    apiKey: p.apiKey || ''
  };
}

function keySet(cfg, providerId) {
  var p = cfg.providers && cfg.providers[providerId];
  return !!(p && p.apiKey);
}

module.exports = {
  SCHEMA_VERSION: SCHEMA_VERSION,
  defaults: defaults,
  migrate: migrate,
  load: load,
  save: save,
  providerConfig: providerConfig,
  keySet: keySet
};
