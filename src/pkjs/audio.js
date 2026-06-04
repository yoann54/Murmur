/*
 * audio.js — turn TTS audio into watch-ready PCM.
 *
 * The watch Speaker API plays mono signed PCM at 8/16 kHz, 8/16-bit. TTS
 * services give us 16-bit PCM at 24 kHz (OpenAI/Gemini) or a rate we ask for
 * (Google). To minimise Bluetooth traffic (the bottleneck) we target the
 * lowest sane format: 8 kHz, 8-bit signed. Decimation is by an integer factor
 * (24000/3=8000, 16000/2=8000) so no interpolation is needed.
 *
 * Pure functions, no globals -> unit-testable under Node.
 */

var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// base64 string -> array of byte values (0-255). Implemented by hand because
// PebbleKit JS doesn't reliably expose atob/Buffer.
function base64ToBytes(b64) {
  var s = String(b64).replace(/[^A-Za-z0-9+/]/g, '');
  var bytes = [];
  for (var i = 0; i < s.length; i += 4) {
    var c0 = B64.indexOf(s.charAt(i));
    var c1 = B64.indexOf(s.charAt(i + 1));
    var c2 = (i + 2 < s.length) ? B64.indexOf(s.charAt(i + 2)) : -1;
    var c3 = (i + 3 < s.length) ? B64.indexOf(s.charAt(i + 3)) : -1;
    if (c0 < 0 || c1 < 0) { break; }
    bytes.push((c0 << 2) | (c1 >> 4));
    if (c2 >= 0) { bytes.push(((c1 & 15) << 4) | (c2 >> 2)); }
    if (c3 >= 0) { bytes.push(((c2 & 3) << 6) | c3); }
  }
  return bytes;
}

// little-endian 16-bit signed bytes -> array of signed samples
function bytesToInt16(bytes, offset) {
  var start = offset || 0;
  var n = Math.floor((bytes.length - start) / 2);
  var out = new Array(n);
  for (var i = 0; i < n; i++) {
    var lo = bytes[start + 2 * i];
    var hi = bytes[start + 2 * i + 1];
    var v = ((hi << 8) | lo) & 0xFFFF;
    out[i] = v >= 0x8000 ? v - 0x10000 : v;
  }
  return out;
}

// keep every Nth sample (integer downsample)
function decimate(samples, factor) {
  if (!factor || factor <= 1) { return samples.slice(); }
  var out = [];
  for (var i = 0; i < samples.length; i += factor) { out.push(samples[i]); }
  return out;
}

/*
 * Produce the bytes to ship to the watch: 8 kHz, 8-bit signed PCM, returned as
 * unsigned byte values (two's complement) ready for an AppMessage data field.
 *   int16samples : signed samples from the TTS audio
 *   srcRate      : their sample rate (e.g. 24000)
 * Returns { bytes:[0..255], rate:8000, bits:8 }.
 */
function toWatchPcm(int16samples, srcRate) {
  var factor = Math.max(1, Math.round((srcRate || 8000) / 8000));
  var d = decimate(int16samples, factor);
  var bytes = new Array(d.length);
  for (var i = 0; i < d.length; i++) {
    bytes[i] = (d[i] >> 8) & 0xFF;   // high byte = signed 8-bit, as a 0..255 byte
  }
  return { bytes: bytes, rate: 8000, bits: 8 };
}

module.exports = {
  base64ToBytes: base64ToBytes,
  bytesToInt16: bytesToInt16,
  decimate: decimate,
  toWatchPcm: toWatchPcm
};
