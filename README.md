# Murmur

A voice AI assistant for the new Pebble watches. Press select, speak, and your
words go to your phone, on to the AI provider of your choice, and the reply
scrolls back on your wrist.

**On the Pebble appstore:** <https://apps.rePebble.com/402b6431000f4bd88598692c>

## Why Murmur

The model is a **free-text field per provider** — never hardcoded. When a vendor
renames or retires a model, you just change a field in the settings; no app
update required. That single decision is the reason Murmur exists.

Supported providers: Anthropic (Claude), OpenAI, Google Gemini, DeepSeek,
xAI (Grok), Mistral, and any OpenAI-compatible endpoint. Bring your own API key —
**keys stay on your phone** and are never sent to the watch.

## Architecture

A thin C shell does the one thing that only exists in C — voice dictation — plus
the UI. All the logic that tends to rot (models, endpoints, request shapes) lives
in PebbleKit JS so it can change without republishing.

```
src/c/Murmur.c        C shell: DictationSession, drawn mic UI, scrolling reply,
                      chunk reassembly, versioned persisted state
src/pkjs/
  index.js            AppMessage glue, config events, response streaming
  providers.js        provider registry (free-text model, listModels)
  chat.js             bounded conversation history (user+assistant pairs)
  net.js              HTTP with a hard timeout
  config.js           versioned settings, keys kept phone-side
  config_page.js      self-contained settings page (data: URI, not Clay)
  chunk.js            UTF-8-safe chunking for streaming long replies
test/run.js           Node test harness for the JS core
tools/gen_assets.py   generates appstore icons + banner
store/                appstore assets + publishing notes
```

Target platforms: **emery** (Pebble Time 2), **flint** (Core 2 Duo),
**gabbro** (Pebble Round 2).

## Build & run

```sh
pebble build                       # builds for all target platforms
pebble install --emulator emery    # run on the emulator
pebble install --phone <ip>        # sideload to a paired watch (Dev Connection on)
node test/run.js                   # run the JS core tests
```

## Configure

In the Pebble phone app, open Murmur's settings (gear icon): pick a provider,
paste your API key, choose a model (the dropdown lists your available models, or
type any ID), optionally set a system prompt. Everything is saved on the phone.

## Publishing

Published to the Core appstore with `pebble publish` (see `store/PUBLISHING.md`).
Note: the Rebble dev portal alone does **not** make an app visible in the Pebble
mobile app — `pebble publish` uploads to the Core feed that the app reads.
