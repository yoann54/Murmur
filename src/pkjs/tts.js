/*
 * tts.js — text-to-speech provider registry (independent of the chat provider,
 * since Mistral/Claude/DeepSeek/Grok have no TTS).
 *
 * Each provider:
 *   buildRequest({apiKey, model, voice, text, baseUrl}) -> {url, method, headers,
 *       body, responseType}  (responseType 'arraybuffer' for raw-PCM responses)
 *   extractPcm(status, res) -> {samples:[int16], srcRate} | {error}
 *       res = { status, body (text), bytes ([0..255] when responseType set) }
 *
 * The model and voice are free-text fields (same anti-deprecation rule as chat).
 */

var audio = require('./audio');

function trimSlashes(u) { return (u || '').replace(/\/+$/, ''); }

function openai() {
  return {
    id: 'openai_tts',
    label: 'OpenAI TTS',
    defaultModel: 'tts-1',
    defaultVoice: 'alloy',
    defaultBaseUrl: 'https://api.openai.com',
    buildRequest: function (req) {
      var base = trimSlashes(req.baseUrl || 'https://api.openai.com');
      return {
        url: base + '/v1/audio/speech',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + req.apiKey
        },
        body: JSON.stringify({
          model: req.model || 'tts-1',
          voice: req.voice || 'alloy',
          input: req.text,
          response_format: 'pcm'   // raw 24 kHz 16-bit mono LE
        }),
        responseType: 'arraybuffer'
      };
    },
    extractPcm: function (status, res) {
      if (status !== 200 || !res.bytes) {
        return { error: ttsError(res, status) };
      }
      return { samples: audio.bytesToInt16(res.bytes, 0), srcRate: 24000 };
    }
  };
}

function gemini() {
  return {
    id: 'gemini_tts',
    label: 'Gemini TTS (Google AI Studio)',
    defaultModel: 'gemini-2.5-flash-preview-tts',
    defaultVoice: 'Kore',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    buildRequest: function (req) {
      var base = trimSlashes(req.baseUrl || 'https://generativelanguage.googleapis.com');
      return {
        url: base + '/v1beta/models/' + encodeURIComponent(req.model || 'gemini-2.5-flash-preview-tts') +
             ':generateContent?key=' + encodeURIComponent(req.apiKey),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: req.text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: req.voice || 'Kore' } }
            }
          }
        })
      };
    },
    extractPcm: function (status, res) {
      var json;
      try { json = JSON.parse(res.body); } catch (e) { return { error: 'Bad TTS response (HTTP ' + status + ')' }; }
      if (json && json.error) { return { error: json.error.message || 'TTS error' }; }
      var parts = json && json.candidates && json.candidates[0] &&
                  json.candidates[0].content && json.candidates[0].content.parts;
      var inline = parts && parts[0] && parts[0].inlineData;
      if (!inline || !inline.data) { return { error: 'No audio in TTS response (HTTP ' + status + ')' }; }
      var rate = 24000;
      var m = /rate=(\d+)/.exec(inline.mimeType || '');
      if (m) { rate = parseInt(m[1], 10); }
      return { samples: audio.bytesToInt16(audio.base64ToBytes(inline.data), 0), srcRate: rate };
    }
  };
}

function googleCloud() {
  return {
    id: 'google_tts',
    label: 'Google Cloud TTS',
    defaultModel: '',  // not used; voice carries the model
    defaultVoice: 'fr-FR-Standard-A',
    defaultBaseUrl: 'https://texttospeech.googleapis.com',
    buildRequest: function (req) {
      var base = trimSlashes(req.baseUrl || 'https://texttospeech.googleapis.com');
      var voice = req.voice || 'fr-FR-Standard-A';
      var lang = /^[a-z]{2}-[A-Z]{2}/.test(voice) ? voice.slice(0, 5) : 'en-US';
      return {
        url: base + '/v1/text:synthesize?key=' + encodeURIComponent(req.apiKey),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text: req.text },
          voice: { languageCode: lang, name: voice },
          audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 8000 }
        })
      };
    },
    extractPcm: function (status, res) {
      var json;
      try { json = JSON.parse(res.body); } catch (e) { return { error: 'Bad TTS response (HTTP ' + status + ')' }; }
      if (json && json.error) { return { error: json.error.message || 'TTS error' }; }
      if (!json.audioContent) { return { error: 'No audio in TTS response (HTTP ' + status + ')' }; }
      var bytes = audio.base64ToBytes(json.audioContent);
      // LINEAR16 comes back as a WAV; skip the 44-byte header if present.
      var offset = (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) ? 44 : 0;
      return { samples: audio.bytesToInt16(bytes, offset), srcRate: 8000 };
    }
  };
}

function ttsError(res, status) {
  // OpenAI errors come back as JSON even with arraybuffer; try text body.
  if (res && res.body) {
    try { var j = JSON.parse(res.body); if (j.error) { return j.error.message; } } catch (e) {}
  }
  return 'TTS error (HTTP ' + status + ')';
}

var registry = {};
function register(p) { registry[p.id] = p; }
register(openai());
register(gemini());
register(googleCloud());

module.exports = {
  get: function (id) { return registry[id] || null; },
  ids: function () { return Object.keys(registry); },
  list: function () {
    return Object.keys(registry).map(function (id) {
      var p = registry[id];
      return { id: id, label: p.label, defaultModel: p.defaultModel, defaultVoice: p.defaultVoice, defaultBaseUrl: p.defaultBaseUrl };
    });
  }
};
