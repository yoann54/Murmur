/*
 * chunk.js — split a string into UTF-8-safe pieces for streaming to the watch.
 *
 * AppMessage payloads are byte-bounded, and a chunk boundary must never fall in
 * the middle of a multi-byte code point or the watch would render garbage. So
 * we measure each code point's UTF-8 length and never let a chunk exceed the
 * byte budget. Kept separate from index.js so it is require()-able under Node.
 */

function codePointBytes(cp) {
  if (cp < 0x80) { return 1; }
  if (cp < 0x800) { return 2; }
  if (cp < 0x10000) { return 3; }
  return 4;
}

function splitUtf8(text, maxBytes) {
  var chunks = [];
  var current = '';
  var currentBytes = 0;
  // Array.from iterates by code point, so surrogate pairs stay intact.
  Array.from(text).forEach(function (ch) {
    var b = codePointBytes(ch.codePointAt(0));
    if (currentBytes + b > maxBytes && current.length > 0) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += ch;
    currentBytes += b;
  });
  if (current.length > 0 || chunks.length === 0) {
    chunks.push(current);
  }
  return chunks;
}

module.exports = {
  codePointBytes: codePointBytes,
  splitUtf8: splitUtf8
};
