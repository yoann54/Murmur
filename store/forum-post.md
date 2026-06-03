# Forum post — apps published on Rebble dev portal not appearing in the Core (repebble) appstore

Post to: **forum.repebble.com → Mobile App Developer Corner**

Before posting, replace `<PEBBLEDANO_ID>` with the ID from your Pebbledano dev-portal
URL (same place you got Murmur's ID: `dev-portal.rebble.io/.../application/<ID>`).

---

**Title:** Apps published via dev-portal.rebble.io never appear in the Core appstore feed (appstore-api.repebble.com)

**Body:**

Hi all,

Apps I publish through the Rebble Developer Portal (dev-portal.rebble.io) never
show up in the Pebble mobile app's store. The docs say apps submitted there
"show up on the Pebble Appstore as well", automatically — but that does not seem
to be happening for me, and it's not a propagation delay: I have an app that was
published months ago and still isn't there.

It looks like the two feeds are effectively separate: my apps exist in the Rebble
backend but are absent from the Core backend that the mobile app queries by
default.

**Evidence (reproducible):**

Newly published app "Murmur" (public, author `yoada`, published 03 Jun 2026):

```
# Rebble feed — found
curl -s https://appstore-api.rebble.io/api/v1/apps/id/6a20087de609be0009ca1b9f
# -> full app JSON

# Core feed — not found
curl -s https://appstore-api.repebble.com/api/v1/apps/id/6a20087de609be0009ca1b9f
# -> {"error":"App not found"}
```

Older app "Pebbledano" (published several months ago, same account) — same
symptom:

```
curl -s https://appstore-api.repebble.com/api/v1/apps/id/<PEBBLEDANO_ID>
# -> {"error":"App not found"}
```

Both apps are visible and public on apps.rebble.io, with binaries for the modern
platforms (emery / flint / gabbro for Murmur).

**Questions:**

1. Is the Rebble → Core appstore sync supposed to be automatic, and on what
   schedule? Or is there a separate submission/claim step to get an app into the
   Core (repebble) feed that the default mobile app uses?
2. If it's automatic, can you check why these two apps haven't synced?
3. Is there anything required on the listing (a field, a flag, a category) for an
   app to be ingested by the Core feed?

Happy to provide more details. Thanks!

---

_(Tip: the "Forum Connection" button on your app's dev-portal listing links the
app to its forum thread — use it after posting so the thread is attached to
Murmur.)_
