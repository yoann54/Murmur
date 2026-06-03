/*
 * markdown.js — turn Markdown into light, watch-friendly plain text.
 *
 * LLMs answer in Markdown (**bold**, # headings, `code`, - bullets). The watch
 * renders plain text in a SINGLE font, so we can't do real bold/italic. Instead
 * of dumping the raw markers, we keep a little structure that reads well on a
 * small screen:
 *   - headings  ->  UPPERCASE (they stand out without a second font)
 *   - bullets   ->  a real "• " bullet
 *   - bold/italic/code/links  ->  unwrapped to plain text
 *
 * The original Markdown text stays in the conversation history (formatting
 * context preserved); this only affects what is shown on the watch. Kept light
 * so it doesn't mangle prose (snake_case, "5 * 3", etc.).
 */

function formatForWatch(text) {
  var t = String(text);

  // Fenced code blocks ```lang ... ``` -> keep the inner text.
  t = t.replace(/```[a-zA-Z0-9]*\r?\n?/g, '').replace(/```/g, '');
  // Inline code `x` -> x
  t = t.replace(/`([^`]+)`/g, '$1');
  // Images ![alt](url) -> alt ; links [text](url) -> text
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // Bold / italic markers (single font, so just unwrap)
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
  t = t.replace(/__([^_]+)__/g, '$1');
  t = t.replace(/\*([^*\n]+)\*/g, '$1');
  // Italics with underscores, only when "_" wraps a word (not snake_case).
  t = t.replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?])/g, '$1$2');

  var lines = t.split('\n').map(function (line) {
    // Headings -> UPPERCASE so titles stand out in a single font.
    var h = line.match(/^\s{0,3}#{1,6}\s+(.*)$/);
    if (h) { return h[1].toUpperCase(); }
    var m = line;
    m = m.replace(/^\s*>\s?/, '');                        // > blockquotes
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(m)) { return ''; }  // --- *** ___ rules
    m = m.replace(/^(\s*)[-*+]\s+/, '$1• ');         // bullets -> "• "
    return m;
  });

  return lines.join('\n');
}

module.exports = { formatForWatch: formatForWatch };
