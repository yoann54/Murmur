/*
 * config_page.js — builds Murmur's settings page as a self-contained HTML
 * string, served as a data: URI from index.js.
 *
 * Why not Clay: Clay's page is ~90 KB and does not render in the new Core mobile
 * app's webview. This page is a few KB, fully offline, on-brand, and returns the
 * chosen settings via `pebblejs://close#<json>` (the standard manual mechanism),
 * which the watch app reads in its webviewclosed handler.
 *
 * The provider <select> is filled from the registry. Each provider's credentials
 * are remembered as you switch (so configuring several providers in one sitting
 * doesn't clobber the previous one's key). The model field is free text — the
 * safety net that lets Murmur outlive model deprecations.
 */

var providers = require('./providers');
var tts = require('./tts');

// Client-side logic, injected into the page. Kept as a string so it ships inside
// the data: URI. Reads the `D` object (current config + provider list) that the
// generator embeds just above it.
var PAGE_JS = [
  '(function(){',
  'var byId=function(i){return document.getElementById(i);};',
  'var sel=byId("provider");',
  'D.list.forEach(function(p){var o=document.createElement("option");o.value=p.id;o.textContent=p.label;sel.appendChild(o);});',
  'var creds={};',
  'D.list.forEach(function(p){var s=D.providers[p.id]||{};creds[p.id]={apiKey:s.apiKey||"",model:s.model||"",baseUrl:s.baseUrl||""};});',
  'function dflt(id){var r=null;D.list.forEach(function(x){if(x.id===id)r=x;});return r||{};}',
  'var pick=byId("modelpick");',
  'function fillModels(){pick.innerHTML="";var ms=(cur===D.modelsFor)?(D.models||[]):[];if(!ms.length){pick.style.display="none";return;}pick.style.display="block";var z=document.createElement("option");z.value="";z.textContent="\\u2014 pick a model \\u2014";pick.appendChild(z);ms.forEach(function(m){var o=document.createElement("option");o.value=m;o.textContent=m;pick.appendChild(o);});}',
  'pick.addEventListener("change",function(){if(pick.value)byId("model").value=pick.value;});',
  'function load(id){var c=creds[id]||{};var d=dflt(id);byId("apiKey").value=c.apiKey||"";byId("model").value=c.model||"";byId("model").placeholder=d.defaultModel||"model id";byId("baseUrl").value=c.baseUrl||"";byId("baseUrl").placeholder=d.defaultBaseUrl||"";fillModels();}',
  'function stash(id){creds[id]={apiKey:byId("apiKey").value,model:byId("model").value,baseUrl:byId("baseUrl").value};}',
  'var cur=D.active||(D.list[0]&&D.list[0].id);',
  'sel.value=cur;load(cur);',
  'sel.addEventListener("change",function(){stash(cur);cur=sel.value;load(cur);});',
  'byId("system").value=D.system||"";',
  'byId("temperature").value=(D.temperature==null?"":D.temperature);',
  'byId("maxTokens").value=(D.maxTokens==null?"":D.maxTokens);',
  'byId("historyTurns").value=(D.historyTurns==null?6:D.historyTurns);',
  'byId("timeoutSeconds").value=(D.timeoutMs==null?30:Math.round(D.timeoutMs/1000));',
  // TTS section
  'var tsel=byId("ttsProvider");',
  'D.ttsList.forEach(function(p){var o=document.createElement("option");o.value=p.id;o.textContent=p.label;tsel.appendChild(o);});',
  'var T=D.tts||{};',
  'byId("ttsEnabled").checked=!!T.enabled;',
  'if(T.provider)tsel.value=T.provider;',
  'byId("ttsKey").value=T.key||"";',
  'byId("ttsVoice").value=T.voice||"";',
  'byId("ttsModel").value=T.model||"";',
  'function tdflt(id){var r=null;D.ttsList.forEach(function(x){if(x.id===id)r=x;});return r||{};}',
  'function tph(){var d=tdflt(tsel.value);byId("ttsVoice").placeholder=d.defaultVoice||"voice";byId("ttsModel").placeholder=d.defaultModel||"(default)";}',
  'function toggleTts(){byId("ttsBox").style.display=byId("ttsEnabled").checked?"block":"none";}',
  'byId("ttsEnabled").addEventListener("change",toggleTts);',
  'tsel.addEventListener("change",tph);',
  'tph();toggleTts();',
  'byId("save").addEventListener("click",function(){',
  'stash(cur);',
  'var out={activeProvider:cur,providers:creds,system:byId("system").value,temperature:byId("temperature").value,maxTokens:byId("maxTokens").value,historyTurns:byId("historyTurns").value,timeoutSeconds:byId("timeoutSeconds").value,',
  'tts:{enabled:byId("ttsEnabled").checked,provider:tsel.value,key:byId("ttsKey").value,voice:byId("ttsVoice").value,model:byId("ttsModel").value}};',
  'document.location="pebblejs://close#"+encodeURIComponent(JSON.stringify(out));',
  '});',
  '})();'
].join('');

var STYLE = [
  'body{margin:0;background:#000;color:#fff;font-family:-apple-system,Roboto,Helvetica,sans-serif;padding:18px}',
  'h1{color:#00aaff;font-size:24px;margin:0 0 2px}',
  '.sub{color:#888;font-size:13px;margin-bottom:18px}',
  'label{display:block;margin:16px 0 5px;font-size:13px;color:#bbb}',
  'input,select,textarea{width:100%;box-sizing:border-box;padding:11px;border-radius:9px;border:1px solid #333;background:#111;color:#fff;font-size:16px}',
  'textarea{min-height:64px;resize:vertical}',
  '.hint{color:#777;font-size:11px;margin-top:4px}',
  'button{width:100%;margin-top:24px;margin-bottom:18px;padding:15px;border:0;border-radius:11px;background:#00aaff;color:#000;font-size:17px;font-weight:bold}',
  '.support{display:block;text-align:center;text-decoration:none;background:#0070ba;color:#fff;padding:13px;border-radius:11px;margin-bottom:24px;font-size:15px;font-weight:bold}'
].join('');

function buildConfigPage(cfg, models) {
  var data = {
    active: cfg.activeProvider,
    providers: cfg.providers || {},
    system: cfg.system || '',
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
    historyTurns: cfg.historyTurns,
    timeoutMs: cfg.timeoutMs,
    list: providers.list(),
    // Live model list pre-fetched by pkjs for the active provider (CORS blocks
    // fetching from this webview), offered as autocomplete on the model field.
    models: models || [],
    modelsFor: cfg.activeProvider,
    ttsList: tts.list(),
    tts: cfg.tts || {}
  };

  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Murmur</title><style>', STYLE, '</style></head><body>',
    '<h1>Murmur</h1>',
    '<div class="sub">Your API key stays on your phone.</div>',
    '<label>AI provider</label><select id="provider"></select>',
    '<label>API key</label><input id="apiKey" type="password" placeholder="paste key">',
    '<label>Model</label><select id="modelpick" style="margin-bottom:8px"></select>',
    '<input id="model" type="text" autocomplete="off" placeholder="or type any model ID">',
    '<div class="hint">Pick from the list, or type any model ID. Free text survives deprecations.</div>',
    '<label>Base URL (optional)</label><input id="baseUrl" type="text">',
    '<label>System prompt (optional)</label><textarea id="system"></textarea>',
    '<label>Temperature (blank = omit)</label><input id="temperature" type="number" step="any" min="0" max="2">',
    '<label>Max tokens (blank = provider default)</label><input id="maxTokens" type="number" min="1">',
    '<label>History turns</label><input id="historyTurns" type="number" min="0" max="50">',
    '<label>Network timeout (seconds)</label><input id="timeoutSeconds" type="number" min="5" max="120">',
    '<label style="margin-top:20px"><input type="checkbox" id="ttsEnabled" style="width:auto;margin-right:8px;vertical-align:middle"> Read answers aloud</label>',
    '<div id="ttsBox" style="display:none">',
    '<label>TTS service</label><select id="ttsProvider"></select>',
    '<label>TTS API key</label><input id="ttsKey" type="password" placeholder="blank = reuse chat key (OpenAI/Gemini)">',
    '<label>Voice</label><input id="ttsVoice" type="text">',
    '<label>TTS model (optional)</label><input id="ttsModel" type="text">',
    '<div class="hint">Reads short answers via the speaker. Needs a TTS-capable key (OpenAI, Gemini, or Google Cloud).</div>',
    '</div>',
    '<button id="save">Save</button>',
    '<a href="https://paypal.me/yoadadev" target="_blank" rel="noopener" class="support">☕ Support the developer</a>',
    '<script>var D=', JSON.stringify(data), ';</script>',
    '<script>', PAGE_JS, '</script>',
    '</body></html>'
  ].join('');
}

module.exports = buildConfigPage;
