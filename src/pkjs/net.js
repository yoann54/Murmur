/*
 * net.js — minimal HTTP client with a hard timeout.
 *
 * PebbleKit JS exposes XMLHttpRequest (there is no fetch), and PebbleAI's
 * original sin #7 was having no network timeout: a stalled request left the
 * watch stuck on "awaiting response..." forever. So every request here is
 * wrapped in a manual timer in addition to xhr.timeout, because the built-in
 * timeout is unreliable on some PebbleKit JS runtimes.
 */

var DEFAULT_TIMEOUT_MS = 30000;

/*
 * request(opts, callback)
 *   opts: { url, method, headers, body, timeoutMs }
 *   callback(err, res) where res = { status, body }
 *
 * callback is invoked exactly once.
 */
function request(opts, callback) {
  var done = false;
  var timer = null;

  function finish(err, res) {
    if (done) { return; }
    done = true;
    if (timer !== null) { clearTimeout(timer); timer = null; }
    callback(err, res);
  }

  var timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  timer = setTimeout(function () {
    finish(new Error('Network timeout'));
  }, timeoutMs);

  var xhr = new XMLHttpRequest();
  try {
    xhr.open(opts.method || 'POST', opts.url, true);
  } catch (e) {
    return finish(new Error('Invalid request: ' + e.message));
  }

  var headers = opts.headers || {};
  Object.keys(headers).forEach(function (name) {
    xhr.setRequestHeader(name, headers[name]);
  });

  if (opts.responseType) {
    try { xhr.responseType = opts.responseType; } catch (e) {}
  }

  xhr.timeout = timeoutMs;
  xhr.ontimeout = function () { finish(new Error('Network timeout')); };
  xhr.onerror = function () { finish(new Error('Network error')); };
  xhr.onload = function () {
    var res = { status: xhr.status };
    if (opts.responseType === 'arraybuffer' && xhr.response) {
      var u8 = new Uint8Array(xhr.response);
      var arr = new Array(u8.length);
      for (var i = 0; i < u8.length; i++) { arr[i] = u8[i]; }
      res.bytes = arr;
    } else {
      res.body = xhr.responseText;
    }
    finish(null, res);
  };

  try {
    xhr.send(opts.body || null);
  } catch (e) {
    finish(new Error('Network error: ' + e.message));
  }
}

module.exports = {
  request: request,
  DEFAULT_TIMEOUT_MS: DEFAULT_TIMEOUT_MS
};
