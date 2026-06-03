/*
 * Node test harness for the JS core. Runs outside Pebble — the modules are
 * written to be require()-able without the Pebble/XMLHttpRequest globals.
 *
 *   node test/run.js
 */
'use strict';

var assert = require('assert');
var providers = require('../src/pkjs/providers');
var Conversation = require('../src/pkjs/chat');
var config = require('../src/pkjs/config');
var chunk = require('../src/pkjs/chunk');

var passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok - ' + name);
}

console.log('providers: model is free text, never hardcoded');

test('openai passes model through verbatim', function () {
  var p = providers.get('openai');
  var r = p.buildRequest({ apiKey: 'sk-x', model: 'some-future-model-9000', messages: [{ role: 'user', content: 'hi' }] });
  var body = JSON.parse(r.body);
  assert.strictEqual(body.model, 'some-future-model-9000');
  assert.strictEqual(r.headers.Authorization, 'Bearer sk-x');
  assert.ok(/\/v1\/chat\/completions$/.test(r.url));
});

test('temperature/max_tokens omitted unless set (GPT-5 safe)', function () {
  var p = providers.get('openai');
  var r = p.buildRequest({ apiKey: 'k', model: 'gpt-5', messages: [{ role: 'user', content: 'hi' }] });
  var body = JSON.parse(r.body);
  assert.ok(!('temperature' in body), 'temperature must be absent by default');
  assert.ok(!('max_tokens' in body), 'max_tokens must be absent by default');

  var r2 = p.buildRequest({ apiKey: 'k', model: 'gpt-4o', temperature: 0.5, maxTokens: 256, messages: [{ role: 'user', content: 'hi' }] });
  var body2 = JSON.parse(r2.body);
  assert.strictEqual(body2.temperature, 0.5);
  assert.strictEqual(body2.max_tokens, 256);
});

test('openai injects system prompt as a system message', function () {
  var p = providers.get('openai');
  var r = p.buildRequest({ apiKey: 'k', model: 'm', system: 'Be terse.', messages: [{ role: 'user', content: 'hi' }] });
  var body = JSON.parse(r.body);
  assert.deepStrictEqual(body.messages[0], { role: 'system', content: 'Be terse.' });
});

test('anthropic sends system + required max_tokens default + x-api-key', function () {
  var p = providers.get('anthropic');
  var r = p.buildRequest({ apiKey: 'sk-ant', model: 'claude-x', system: 'Be terse.', messages: [{ role: 'user', content: 'hi' }] });
  var body = JSON.parse(r.body);
  assert.strictEqual(body.system, 'Be terse.');           // PebbleAI dropped this
  assert.strictEqual(body.max_tokens, 1024);              // Anthropic requires it
  assert.strictEqual(r.headers['x-api-key'], 'sk-ant');
  assert.strictEqual(r.headers['anthropic-version'], '2023-06-01');
  assert.ok(/\/v1\/messages$/.test(r.url));
});

test('anthropic parses text blocks', function () {
  var p = providers.get('anthropic');
  var out = p.parseResponse(200, { content: [{ type: 'text', text: 'hello' }] });
  assert.strictEqual(out.text, 'hello');
});

test('gemini puts model in URL, key in query, system as systemInstruction', function () {
  var p = providers.get('gemini');
  var r = p.buildRequest({ apiKey: 'AIza', model: 'gemini-x', system: 'Be terse.', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }] });
  assert.ok(r.url.indexOf('/v1beta/models/gemini-x:generateContent') !== -1);
  assert.ok(r.url.indexOf('key=AIza') !== -1);
  var body = JSON.parse(r.body);
  assert.deepStrictEqual(body.systemInstruction, { parts: [{ text: 'Be terse.' }] });
  assert.strictEqual(body.contents[1].role, 'model');   // assistant -> model
});

test('error bodies surface a message', function () {
  var p = providers.get('openai');
  var out = p.parseResponse(400, { error: { message: 'bad model' } });
  assert.strictEqual(out.error, 'bad model');
});

test('openai-compatible model listing: GET /v1/models, parse data[].id', function () {
  var p = providers.get('deepseek');
  var r = p.listModels({ apiKey: 'k', baseUrl: '' });
  assert.strictEqual(r.method, 'GET');
  assert.ok(/\/v1\/models$/.test(r.url));
  assert.strictEqual(r.headers.Authorization, 'Bearer k');
  assert.deepStrictEqual(p.parseModels({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] }), ['deepseek-chat', 'deepseek-reasoner']);
});

test('anthropic model listing uses x-api-key', function () {
  var p = providers.get('anthropic');
  var r = p.listModels({ apiKey: 'sk-ant' });
  assert.ok(/\/v1\/models$/.test(r.url));
  assert.strictEqual(r.headers['x-api-key'], 'sk-ant');
  assert.deepStrictEqual(p.parseModels({ data: [{ id: 'claude-x' }] }), ['claude-x']);
});

test('gemini model listing strips models/ and filters to generateContent', function () {
  var p = providers.get('gemini');
  var r = p.listModels({ apiKey: 'AIza' });
  assert.ok(r.url.indexOf('/v1beta/models?key=AIza') !== -1);
  var out = p.parseModels({ models: [
    { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] }
  ] });
  assert.deepStrictEqual(out, ['gemini-2.0-flash']);
});

test('parseModels tolerates garbage', function () {
  assert.deepStrictEqual(providers.get('openai').parseModels({}), []);
  assert.deepStrictEqual(providers.get('gemini').parseModels(null), []);
});

test('registry lists the expected providers', function () {
  var ids = providers.ids().sort();
  assert.deepStrictEqual(ids, ['anthropic', 'deepseek', 'gemini', 'grok', 'mistral', 'openai', 'openai_compatible'].sort());
});

console.log('chat: history is bounded and recorded in pairs');

test('history keeps user+assistant pairs and bounds to maxTurns', function () {
  var c = new Conversation(2);  // 2 turns = 4 messages max
  for (var i = 0; i < 5; i++) {
    c.addUser('u' + i);
    c.addAssistant('a' + i);
  }
  var snap = c.snapshot();
  assert.strictEqual(snap.length, 4);
  assert.deepStrictEqual(snap[0], { role: 'user', content: 'u3' });
  assert.deepStrictEqual(snap[3], { role: 'assistant', content: 'a4' });
});

test('dropLast rolls back a failed user turn', function () {
  var c = new Conversation(6);
  c.addUser('hello');
  c.dropLast();
  assert.strictEqual(c.snapshot().length, 0);
});

console.log('config: versioned and migrated');

test('defaults carry the schema version and safe params', function () {
  var d = config.defaults();
  assert.strictEqual(d.version, config.SCHEMA_VERSION);
  assert.strictEqual(d.temperature, undefined);
  assert.strictEqual(d.maxTokens, undefined);
  assert.strictEqual(d.historyTurns, 6);
});

test('migrate fills missing keys without clobbering and stamps version', function () {
  var old = { activeProvider: 'openai', providers: { openai: { model: 'gpt-4o', apiKey: 'k' } } };
  var m = config.migrate(old);
  assert.strictEqual(m.version, config.SCHEMA_VERSION);
  assert.strictEqual(m.activeProvider, 'openai');         // preserved
  assert.strictEqual(m.historyTurns, 6);                  // filled
  assert.strictEqual(m.providers.openai.model, 'gpt-4o'); // preserved
});

test('migrate tolerates garbage', function () {
  assert.strictEqual(config.migrate(null).version, config.SCHEMA_VERSION);
  assert.strictEqual(config.migrate('nope').version, config.SCHEMA_VERSION);
});

test('keySet reports only whether a key exists', function () {
  var cfg = config.defaults();
  cfg.providers.openai = { apiKey: 'secret' };
  assert.strictEqual(config.keySet(cfg, 'openai'), true);
  assert.strictEqual(config.keySet(cfg, 'anthropic'), false);
});

console.log('chunk: UTF-8-safe splitting for streaming');

test('short text is a single chunk', function () {
  assert.deepStrictEqual(chunk.splitUtf8('hello', 1000), ['hello']);
});

test('empty text yields one empty chunk (so index 0 still resets the watch)', function () {
  assert.deepStrictEqual(chunk.splitUtf8('', 1000), ['']);
});

test('splits at the byte budget and reassembles exactly', function () {
  var text = '';
  for (var i = 0; i < 250; i++) { text += 'abcd'; }  // 1000 ASCII bytes
  var parts = chunk.splitUtf8(text, 100);
  assert.strictEqual(parts.length, 10);
  parts.forEach(function (p) { assert.ok(p.length <= 100); });
  assert.strictEqual(parts.join(''), text);
});

test('never splits a multi-byte code point across a boundary', function () {
  // 'é' is 2 bytes, '🙂' is 4 bytes (one code point, surrogate pair in JS).
  var text = 'aé🙂bé';
  var parts = chunk.splitUtf8(text, 3);  // tight budget forces boundaries
  assert.strictEqual(parts.join(''), text);  // lossless
  // Every emoji must live wholly within one chunk.
  parts.forEach(function (p) {
    var pairs = (p.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g) || []).length;
    var highs = (p.match(/[\uD800-\uDBFF]/g) || []).length;
    assert.strictEqual(pairs, highs, 'no lone surrogate in a chunk');
  });
});

console.log('config page: self-contained and compact');

var buildConfigPage = require('../src/pkjs/config_page');

test('builds an HTML page embedding providers and the close mechanism', function () {
  var html = buildConfigPage(config.defaults());
  assert.ok(/^<!DOCTYPE html>/.test(html), 'is an HTML document');
  assert.ok(html.indexOf('id="provider"') !== -1, 'has the provider select');
  assert.ok(html.indexOf('pebblejs://close#') !== -1, 'returns via pebblejs://close');
  // Every provider id should be embedded for the dropdown.
  providers.ids().forEach(function (id) {
    assert.ok(html.indexOf('"' + id + '"') !== -1, 'embeds provider ' + id);
  });
});

test('page is far smaller than Clay (the reason we dropped Clay)', function () {
  var html = buildConfigPage(config.defaults());
  var url = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  assert.ok(url.length < 20000, 'data URI under 20 KB, got ' + url.length);
});

test('embedded current-config JSON is valid and round-trips', function () {
  var cfg = config.defaults();
  cfg.providers.openai = { apiKey: 'k', model: 'gpt-4o', baseUrl: '' };
  var html = buildConfigPage(cfg);
  var m = html.match(/var D=(\{.*?\});<\/script>/);
  assert.ok(m, 'found embedded D object');
  var d = JSON.parse(m[1]);
  assert.strictEqual(d.providers.openai.model, 'gpt-4o');
  assert.ok(Array.isArray(d.list) && d.list.length === providers.ids().length);
});

console.log('markdown: light formatting for watch display');

var formatForWatch = require('../src/pkjs/markdown').formatForWatch;

test('headings become UPPERCASE so titles stand out', function () {
  assert.strictEqual(formatForWatch('# Title'), 'TITLE');
  assert.strictEqual(formatForWatch('### Petit titre'), 'PETIT TITRE');
});

test('bullets become a real bullet point', function () {
  assert.strictEqual(formatForWatch('* item one\n- item two'), '• item one\n• item two');
});

test('unwraps bold/italic/code/links to plain text', function () {
  assert.strictEqual(formatForWatch('**bold** and *italic*'), 'bold and italic');
  assert.strictEqual(formatForWatch('use `code` here'), 'use code here');
  assert.strictEqual(formatForWatch('see [the docs](http://x.com)'), 'see the docs');
  assert.strictEqual(formatForWatch('> quoted'), 'quoted');
});

test('drops fenced code markers but keeps the code text', function () {
  assert.strictEqual(formatForWatch('```js\nvar x = 1;\n```'), 'var x = 1;\n');
});

test('leaves ordinary prose alone (no over-stripping)', function () {
  assert.strictEqual(formatForWatch('Use 5 * 3 = 15 and snake_case names.'), 'Use 5 * 3 = 15 and snake_case names.');
  assert.strictEqual(formatForWatch('Plain answer, no markdown.'), 'Plain answer, no markdown.');
});

console.log('\nAll ' + passed + ' tests passed.');
