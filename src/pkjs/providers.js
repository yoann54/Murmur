/*
 * providers.js — the provider registry. This is the heart of Murmur.
 *
 * PebbleAI broke every time a vendor deprecated a model, because model IDs were
 * hardcoded (claude-sonnet-4-20250514, gemini-2.0-flash, deepseek-chat...).
 * Murmur's rule: a provider is plain data plus two pure functions. The MODEL is
 * never hardcoded — it is a free-text field per provider, passed through
 * verbatim. defaultModel below is only a first-run suggestion the user can edit.
 *
 * Parameters a model might reject (temperature, max tokens) are sent ONLY when
 * explicitly defined in config. That way a default chat never trips e.g. GPT-5's
 * temperature=1 constraint (PebbleAI bug #2). And the system prompt is wired into
 * every provider's request shape (PebbleAI bug #3 dropped it for Claude/Gemini).
 *
 * Normalized request passed to buildRequest():
 *   { apiKey, model, baseUrl?, system?, messages: [{role,content}],
 *     temperature?, maxTokens? }
 *   roles are 'user' | 'assistant'.
 *
 * buildRequest() returns { url, method, headers, body } (body is a string).
 * parseResponse(status, json) returns { text } or { error }.
 */

function trimSlashes(url) {
  return (url || '').replace(/\/+$/, '');
}

/* OpenAI Chat Completions shape, shared by OpenAI / DeepSeek / Grok / custom. */
function openAICompatible(spec) {
  return {
    id: spec.id,
    label: spec.label,
    defaultModel: spec.defaultModel,
    defaultBaseUrl: spec.defaultBaseUrl,
    needsBaseUrl: !!spec.needsBaseUrl,

    buildRequest: function (req) {
      var base = trimSlashes(req.baseUrl || spec.defaultBaseUrl);
      var messages = [];
      if (req.system) {
        messages.push({ role: 'system', content: req.system });
      }
      req.messages.forEach(function (m) {
        messages.push({ role: m.role, content: m.content });
      });

      var body = { model: req.model, messages: messages };
      if (req.temperature !== undefined) { body.temperature = req.temperature; }
      if (req.maxTokens !== undefined) { body.max_tokens = req.maxTokens; }

      return {
        url: base + '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + req.apiKey
        },
        body: JSON.stringify(body)
      };
    },

    parseResponse: function (status, json) {
      if (json && json.error) {
        return { error: json.error.message || JSON.stringify(json.error) };
      }
      var choice = json && json.choices && json.choices[0];
      var text = choice && choice.message && choice.message.content;
      if (typeof text !== 'string') {
        return { error: 'Unexpected response (HTTP ' + status + ')' };
      }
      return { text: text };
    },

    /* Fetch a live model list so the config page can offer a current dropdown
     * instead of a hardcoded one. Free-text entry stays the fallback. */
    listModels: function (req) {
      var base = trimSlashes(req.baseUrl || spec.defaultBaseUrl);
      return {
        url: base + '/v1/models',
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + req.apiKey }
      };
    },

    parseModels: function (json) {
      var data = json && json.data;
      if (!Array.isArray(data)) { return []; }
      return data.map(function (m) { return m && m.id; }).filter(Boolean);
    }
  };
}

/* Anthropic Messages API. Note: max_tokens is REQUIRED, so we default it. */
function anthropic() {
  return {
    id: 'anthropic',
    label: 'Claude (Anthropic)',
    defaultModel: 'claude-sonnet-4-20250514',
    defaultBaseUrl: 'https://api.anthropic.com',
    needsBaseUrl: false,

    buildRequest: function (req) {
      var base = trimSlashes(req.baseUrl || 'https://api.anthropic.com');
      var body = {
        model: req.model,
        max_tokens: req.maxTokens !== undefined ? req.maxTokens : 1024,
        messages: req.messages.map(function (m) {
          return { role: m.role, content: m.content };
        })
      };
      if (req.system) { body.system = req.system; }
      if (req.temperature !== undefined) { body.temperature = req.temperature; }

      return {
        url: base + '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': req.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(body)
      };
    },

    parseResponse: function (status, json) {
      if (json && json.error) {
        return { error: json.error.message || JSON.stringify(json.error) };
      }
      var content = json && json.content;
      if (Array.isArray(content)) {
        var text = content
          .filter(function (b) { return b && b.type === 'text'; })
          .map(function (b) { return b.text || ''; })
          .join('');
        if (text) { return { text: text }; }
      }
      return { error: 'Unexpected response (HTTP ' + status + ')' };
    },

    listModels: function (req) {
      var base = trimSlashes(req.baseUrl || 'https://api.anthropic.com');
      return {
        url: base + '/v1/models',
        method: 'GET',
        headers: {
          'x-api-key': req.apiKey,
          'anthropic-version': '2023-06-01'
        }
      };
    },

    parseModels: function (json) {
      var data = json && json.data;
      if (!Array.isArray(data)) { return []; }
      return data.map(function (m) { return m && m.id; }).filter(Boolean);
    }
  };
}

/* Google Gemini generateContent. Model lives in the URL; key is a query param. */
function gemini() {
  return {
    id: 'gemini',
    label: 'Gemini (Google)',
    defaultModel: 'gemini-2.0-flash',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    needsBaseUrl: false,

    buildRequest: function (req) {
      var base = trimSlashes(req.baseUrl || 'https://generativelanguage.googleapis.com');
      var contents = req.messages.map(function (m) {
        return {
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        };
      });

      var body = { contents: contents };
      if (req.system) {
        body.systemInstruction = { parts: [{ text: req.system }] };
      }
      var gen = {};
      if (req.temperature !== undefined) { gen.temperature = req.temperature; }
      if (req.maxTokens !== undefined) { gen.maxOutputTokens = req.maxTokens; }
      if (Object.keys(gen).length) { body.generationConfig = gen; }

      var url = base + '/v1beta/models/' + encodeURIComponent(req.model) +
                ':generateContent?key=' + encodeURIComponent(req.apiKey);
      return {
        url: url,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      };
    },

    parseResponse: function (status, json) {
      if (json && json.error) {
        return { error: json.error.message || JSON.stringify(json.error) };
      }
      var cand = json && json.candidates && json.candidates[0];
      var parts = cand && cand.content && cand.content.parts;
      if (Array.isArray(parts)) {
        var text = parts.map(function (p) { return p.text || ''; }).join('');
        if (text) { return { text: text }; }
      }
      return { error: 'Unexpected response (HTTP ' + status + ')' };
    },

    listModels: function (req) {
      var base = trimSlashes(req.baseUrl || 'https://generativelanguage.googleapis.com');
      return {
        url: base + '/v1beta/models?key=' + encodeURIComponent(req.apiKey),
        method: 'GET',
        headers: {}
      };
    },

    parseModels: function (json) {
      var models = json && json.models;
      if (!Array.isArray(models)) { return []; }
      return models
        .filter(function (m) {
          // Keep only models that can actually answer a chat request.
          var methods = m && m.supportedGenerationMethods;
          return !Array.isArray(methods) || methods.indexOf('generateContent') !== -1;
        })
        .map(function (m) { return (m && m.name || '').replace(/^models\//, ''); })
        .filter(Boolean);
    }
  };
}

var registry = {};

function register(provider) {
  registry[provider.id] = provider;
}

register(anthropic());
register(gemini());
register(openAICompatible({
  id: 'openai', label: 'OpenAI',
  defaultBaseUrl: 'https://api.openai.com', defaultModel: 'gpt-4o-mini'
}));
register(openAICompatible({
  id: 'deepseek', label: 'DeepSeek',
  defaultBaseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-chat'
}));
register(openAICompatible({
  id: 'grok', label: 'Grok (xAI)',
  defaultBaseUrl: 'https://api.x.ai', defaultModel: 'grok-2-latest'
}));
register(openAICompatible({
  id: 'mistral', label: 'Mistral AI',
  defaultBaseUrl: 'https://api.mistral.ai', defaultModel: 'mistral-large-latest'
}));
register(openAICompatible({
  id: 'openai_compatible', label: 'OpenAI-compatible (custom)',
  defaultBaseUrl: '', defaultModel: '', needsBaseUrl: true
}));

module.exports = {
  get: function (id) { return registry[id] || null; },
  ids: function () { return Object.keys(registry); },
  list: function () {
    return Object.keys(registry).map(function (id) {
      var p = registry[id];
      return {
        id: id,
        label: p.label,
        defaultModel: p.defaultModel,
        defaultBaseUrl: p.defaultBaseUrl,
        needsBaseUrl: p.needsBaseUrl
      };
    });
  }
};
