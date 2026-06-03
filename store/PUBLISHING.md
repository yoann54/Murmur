# Publishing Murmur to the Pebble Appstore

The build is release-ready. Uploading itself is a manual, logged-in step on the
portal — this file is the checklist and the copy/assets to paste in.

## Where

- **Docs:** <https://developer.repebble.com/guides/appstore-publishing/publishing-an-app/>
- **Upload portal:** <https://dev-portal.rebble.io/> — apps submitted here also
  appear in the Pebble appstore (Core Devices funds Rebble to run it).

## Steps (from the official guide)

1. Log in → **Add a Watchapp**.
2. Basic details: title, source-code URL, support email (below).
3. Select **Category**.
4. Upload **large** and **small** icons (`store/icon-large-144.png`,
   `store/icon-small-48.png`).
5. **Create** → opens the listing page.
6. **Add a release** → upload `build/Murmur.pbw` (+ optional release notes).
7. **Save**, reload, **Publish** next to the release.
8. **Manage Asset Collections** → one collection per supported platform
   (emery, flint, gabbro).
9. Per collection: description + screenshots + optional header images +
   **marketing banner** (`store/banner-720x320.png`).
10. **Publish** (or **Publish Privately** for a link-only release; note: public
    is irreversible).
11. Reload to get the shareable appstore link + deep link.

## Metadata to paste

| Field | Value |
|---|---|
| Title | Murmur |
| Category | Tools & Utilities |
| Support email | yoann.piconcely@skores.com |
| Source code URL | _(set once the repo is hosted)_ |
| Tagline | Voice AI, on your wrist. |

**Short description**

> Speak to ChatGPT, Claude, Gemini and more, straight from your watch.

**Long description**

> Murmur turns your Pebble into a voice assistant for the AI of your choice.
> Press select, speak, and your words go to your phone, on to your chosen AI
> provider, and the reply scrolls back on your wrist.
>
> • Bring your own API key — OpenAI, Claude (Anthropic), Gemini, DeepSeek, Grok,
>   Mistral, or any OpenAI-compatible endpoint.
> • The model is a free-text field, so Murmur keeps working when providers
>   rename or retire models — no app update needed.
> • Your API keys never leave your phone.
> • Long answers stream back in full; conversation context is kept for natural
>   follow-ups.
>
> Configure everything from the settings screen in the Pebble phone app.

_Murmur is "configurable": the gear icon appears automatically in the Pebble
phone app and opens the settings page (provider, key, model, system prompt)._

## Assets in this folder

| File | Size | Use |
|---|---|---|
| `icon-large-144.png` | 144×144 | Large appstore icon |
| `icon-small-48.png` | 48×48 | Small appstore icon |
| `menu-icon-25.png` | 25×25 | In-app launcher icon (already bundled in the .pbw) |
| `banner-720x320.png` | 720×320 | Marketing banner |
| `screenshots/emery-idle.png` | device res | emery collection |
| `screenshots/flint-idle.png` | device res | flint collection |
| `screenshots/gabbro-idle.png` | device res | gabbro collection |

Screenshots are captured straight from each emulator, so they are already at the
correct per-device resolution. Capture more states to reach the 5-per-platform
max once dictation can be exercised against a real transcription backend:

```sh
pebble install --emulator emery && pebble screenshot --emulator emery
```

Regenerate the icons/banner anytime with `python3 tools/gen_assets.py`.

## Pre-flight

- [x] Builds clean for emery / flint / gabbro
- [x] Launcher menu icon bundled
- [x] Config page (Clay) opens; API keys stay on the phone
- [ ] End-to-end test on real hardware (dictation + a live provider call)
- [ ] Source-code URL decided
