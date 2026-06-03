/*
 * index.js — PebbleKit JS entry point. Glue between the watch (AppMessage) and
 * the provider registry. All the logic that rots — models, endpoints, request
 * shapes — lives in JS so it can be updated without republishing the C app.
 *
 * Protocol (AppMessage keys defined in package.json):
 *   watch -> phone:  transcript (string)   the dictated text
 *                    command   (int)        1 = reset conversation
 *   phone -> watch:  status    (int)        STATUS_* below
 *                    response  (string)     assistant reply
 *                    error     (string)     human-readable failure
 *
 * Long replies (PebbleAI bug #6) are streamed in order: the text is split into
 * UTF-8-safe chunks and sent one at a time. AppMessage requires the watch to ack
 * each message before the next can go out, so chaining sends on the success
 * callback gives us ordered, flow-controlled delivery for free. Each chunk
 * carries (response, chunkIndex, chunkTotal) so the watch can reset on index 0
 * and know when it is complete.
 */

var providers = require('./providers');
var config = require('./config');
var net = require('./net');
var Conversation = require('./chat');
var splitUtf8 = require('./chunk').splitUtf8;
var buildConfigPage = require('./config_page');

var STATUS_IDLE = 0;
var STATUS_THINKING = 1;
var STATUS_ERROR = 2;

var CMD_RESET = 1;

// Per-chunk payload budget in UTF-8 bytes; the watch's inbox is sized well above
// this (see app_message_open in the C app). Conservative on purpose.
var CHUNK_BYTES = 1000;
var MAX_SEND_RETRIES = 3;

var convo = null;

function send(dict) {
  Pebble.sendAppMessage(dict, null, function (e) {
    console.log('sendAppMessage failed: ' + (e && e.error && e.error.message));
  });
}

function sendStatus(status) {
  send({ status: status });
}

function sendError(message) {
  console.log('error: ' + message);
  send({ error: String(message), status: STATUS_ERROR });
}

function sendResponse(text) {
  var chunks = splitUtf8(String(text), CHUNK_BYTES);
  var total = chunks.length;

  function sendChunk(index, attempt) {
    if (index >= total) {
      sendStatus(STATUS_IDLE);
      return;
    }
    Pebble.sendAppMessage(
      { response: chunks[index], chunkIndex: index, chunkTotal: total },
      function () { sendChunk(index + 1, 0); },
      function (e) {
        if (attempt < MAX_SEND_RETRIES) {
          sendChunk(index, attempt + 1);
        } else {
          console.log('chunk ' + index + ' failed: ' + (e && e.error && e.error.message));
          sendError('Lost connection while sending reply.');
        }
      }
    );
  }

  sendChunk(0, 0);
}

function handleTranscript(text) {
  var cfg = config.load();

  var provider = providers.get(cfg.activeProvider);
  if (!provider) {
    return sendError('No provider selected.');
  }

  var pcfg = config.providerConfig(cfg, cfg.activeProvider, provider);
  if (!pcfg.apiKey) {
    return sendError('API key not set for ' + provider.label + '.');
  }
  if (!pcfg.model) {
    return sendError('Model not set for ' + provider.label + '.');
  }
  if (provider.needsBaseUrl && !pcfg.baseUrl) {
    return sendError('Base URL not set for ' + provider.label + '.');
  }

  if (!convo) {
    convo = new Conversation(cfg.historyTurns);
  }
  convo.maxTurns = cfg.historyTurns;
  convo.addUser(text);

  sendStatus(STATUS_THINKING);

  var reqDesc = provider.buildRequest({
    apiKey: pcfg.apiKey,
    model: pcfg.model,
    baseUrl: pcfg.baseUrl,
    system: cfg.system,
    messages: convo.snapshot(),
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens
  });

  net.request({
    url: reqDesc.url,
    method: reqDesc.method,
    headers: reqDesc.headers,
    body: reqDesc.body,
    timeoutMs: cfg.timeoutMs
  }, function (err, res) {
    if (err) {
      convo.dropLast();   // roll back the unanswered user turn
      return sendError(err.message);
    }
    var json;
    try {
      json = JSON.parse(res.body);
    } catch (e) {
      convo.dropLast();
      return sendError('Bad response (HTTP ' + res.status + ').');
    }
    var parsed = provider.parseResponse(res.status, json);
    if (parsed.error) {
      convo.dropLast();
      return sendError(parsed.error);
    }
    convo.addAssistant(parsed.text);   // record the pair (PebbleAI bug #4)
    sendResponse(parsed.text);
  });
}

function handleCommand(command) {
  if (command === CMD_RESET) {
    if (convo) { convo.reset(); }
    sendStatus(STATUS_IDLE);
  }
}

// ---- Config page -----------------------------------------------------------
//
// We serve our own compact config page as a data: URI (Clay's 90 KB page would
// not render in the new Core mobile app's webview). The page returns the chosen
// settings via pebblejs://close#<json>, which lands in webviewclosed below.
// API keys live only in the page/phone config — never sent to the watch.

// Blank or non-numeric -> undefined, so the value is omitted from the request.
function optionalNumber(v) {
  if (v === undefined || v === null || String(v).trim() === '') { return undefined; }
  var n = Number(v);
  return isNaN(n) ? undefined : n;
}

function applyConfigPage(s) {
  var cfg = config.load();
  cfg.activeProvider = s.activeProvider || cfg.activeProvider;
  if (s.providers && typeof s.providers === 'object') {
    cfg.providers = s.providers;
  }
  cfg.system = s.system || '';
  cfg.temperature = optionalNumber(s.temperature);
  cfg.maxTokens = optionalNumber(s.maxTokens);
  var turns = parseInt(s.historyTurns, 10);
  cfg.historyTurns = isNaN(turns) ? 6 : turns;
  var secs = parseInt(s.timeoutSeconds, 10);
  cfg.timeoutMs = (isNaN(secs) ? 30 : secs) * 1000;

  config.save(cfg);
  if (convo) { convo.maxTurns = cfg.historyTurns; }
}

function openConfig(cfg, models) {
  try {
    var html = buildConfigPage(cfg, models);
    var url = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
    console.log('Murmur: opening config, url length=' + url.length + ', models=' + models.length);
    Pebble.openURL(url);
  } catch (e) {
    console.log('Murmur: config open FAILED: ' + (e && e.message));
  }
}

Pebble.addEventListener('showConfiguration', function () {
  console.log('Murmur: showConfiguration fired');
  var cfg = config.load();
  var provider = providers.get(cfg.activeProvider);
  var pcfg = provider ? config.providerConfig(cfg, cfg.activeProvider, provider) : null;

  // pkjs (not the webview) fetches the model list, so it isn't CORS-blocked.
  // Needs a saved API key; otherwise we open with free-text entry only.
  if (provider && provider.listModels && pcfg && pcfg.apiKey) {
    var rq = provider.listModels({ apiKey: pcfg.apiKey, baseUrl: pcfg.baseUrl });
    net.request({ url: rq.url, method: rq.method, headers: rq.headers, timeoutMs: 10000 }, function (err, res) {
      var models = [];
      if (!err && res) {
        try { models = provider.parseModels(JSON.parse(res.body)) || []; } catch (e) { models = []; }
      }
      console.log('Murmur: prefetched ' + models.length + ' models for ' + cfg.activeProvider);
      openConfig(cfg, models);
    });
  } else {
    openConfig(cfg, []);
  }
});

Pebble.addEventListener('webviewclosed', function (e) {
  console.log('Murmur: webviewclosed, response present=' + !!(e && e.response));
  if (!e || !e.response) { return; }  // user cancelled
  var raw = e.response;
  var settings = null;
  try { settings = JSON.parse(decodeURIComponent(raw)); }
  catch (e1) { try { settings = JSON.parse(raw); } catch (e2) { settings = null; } }
  if (!settings) {
    console.log('Murmur: could not parse config response');
    return;
  }
  try {
    applyConfigPage(settings);
    console.log('Murmur: settings saved, provider=' + settings.activeProvider);
  } catch (err) {
    console.log('Murmur: applying settings FAILED: ' + (err && err.message));
  }
});

Pebble.addEventListener('ready', function () {
  // Touch config once so a first-run / migrated blob is persisted.
  config.save(config.load());
  sendStatus(STATUS_IDLE);
  console.log('Murmur JS ready');
});

Pebble.addEventListener('appmessage', function (e) {
  var d = e.payload || {};
  if (d.transcript !== undefined) {
    handleTranscript(d.transcript);
  } else if (d.command !== undefined) {
    handleCommand(d.command);
  }
});
