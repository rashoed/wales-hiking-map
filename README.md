# Wales Trail Atlas

A lightweight, mobile-first personal hiking map for Wales and the Offa's Dyke Path.

## Current MVP (v0.4)

- Interactive MapLibre map with a minimalist OpenFreeMap basemap.
- Initial points: Chepstow, Tintern Abbey, Monmouth, Pandy, Hay-on-Wye.
- GPX track import (including elevation data when present). Saved in this device's browser.
- GPS position while the app is open, track distance and approximate time, estimate of remaining track distance.
- Two-tap straight-line distance measurement (clearly distinguished from path distance).
- Add, edit, delete and filter points; add by clicking the map or pasting a Google Maps URL **containing coordinates**.
- Descriptions and optional image URLs, loaded only when opening a point.
- JSON backup export/import to move data between devices.
- Installable PWA shell. **Map tiles are not yet available offline.**

Starter towns are connected by a **dashed planning corridor** solely to illustrate the region; this is NOT a walkable route. Import a trusted GPX file to see a real trail.

## Publish (free)

This site is static: no Node build, no API keys, no database.

1. Upload all files and folders to the root of a GitHub repository.
2. GitHub: **Settings → Pages → Build and deployment → Deploy from a branch → main / (root)** → Save.
3. When GitHub finishes publishing, open `https://rashoed.github.io/wales-hiking-map/`.
4. On iPhone: open the site in Safari and choose **Share → Add to Home Screen**.

Alternatively: create a Cloudflare Pages project, connect the GitHub repo, choose **None / static site**, leave build command empty and set output directory to `.` (repository root). Cloudflare automatically deploys later commits.

## Local preview

Serve this folder over HTTP:

```sh
python3 -m http.server 8000
```

Open http://localhost:8000. GPS and service workers need HTTPS in production (localhost is allowed for development).

## Getting a real GPX

- Official trail overview: https://www.gov.uk/government/publications/visit-a-national-trail-in-wales/offas-dyke-path-national-trail
- GPX download reference: https://www.visitdeanwye.co.uk/trails/the-offas-dyke-path

Check the route's accuracy, diversions and licensing before using/distributing third-party tracks. The current code does not bundle one.

## Privacy and backup

New edits and imported tracks stay in browser `localStorage`. To share an itinerary across devices, use **⋯ → Скачать общие данные для GitHub** and publish the downloaded file as `data/shared-data.json`. On a fresh device, the app loads that file automatically. This is **manual publication, not live synchronization**. Export a backup through the ⋯ menu and keep the downloaded JSON somewhere safe. Browser data can be cleared or evicted by iOS.

GPS uses the device browser's geolocation, with permission. It will not keep tracking reliably with iPhone screen locked. Map tiles require network requests to the provider. External photos load only if a point card is opened.

## Roadmap

- Offline **basemap** packs after choosing a provider/storage method that explicitly permits this use. OpenFreeMap has per-download limits; do not prefetch the whole region indiscriminately.
- Smooth elevation charts, ascent ahead and separate daily stages.
- Walking-network routing to arbitrary points, not straight-line estimates.
- Optional private cloud synchronization.
- Smart Google Maps short-link resolution and optional place metadata enrichment, subject to source API conditions.
- Photo uploads and optimization.
- Device testing for iOS Safari and PWA installation.

## Technology

Plain HTML/CSS/JavaScript + MapLibre GL JS v5 + OpenFreeMap. No build step or app store payment.

OpenFreeMap documentation: https://openfreemap.org/quick_start/

**Safety:** this is a planning prototype, not a certified navigation system. Carry a separately downloaded offline map and GPX, and do not rely on a website alone in remote terrain.

## v0.2 — Map markers and shared itinerary

- Fixed the MapLibre marker positioning conflict (CSS `transform` / `position` on the marker element). Marker symbols are anchored to their actual coordinates.
- Added one-file publication for **both GPX and points**. On the device with your trip, export `shared-data.json` via the `⋯` menu and upload it to this repository's `data/` folder; wait for Pages to publish and open/refresh the app on a second device.
- Old local itineraries are protected from being overwritten automatically. The menu has a confirmed action to replace local data with the published version.
- The web app remains static; it cannot automatically send changes to GitHub from a browser without a secure authenticated service. This version supports controlled, manual publication instead of true real-time sync.

## v0.4 — Six-day itinerary planner

Open the web app and select **Дни 6** in the bottom panel. A lightweight stage planner now:

- Derives the **Chepstow → Hay-on-Wye** portion of the published GPX automatically when both towns are within 3 km of the GPX line. The current shared file yields around **80.5 km** along the trail. Other GPX files fall back to the full GPX.
- Creates six **provisional distance-balanced stages**; these are **not confirmed sleeping sites**.
- Computes real along-GPX distance, ascent/descent and a rough walking-time estimate (3.8 km/h plus 600 m ascent per extra hour).
- Shows each day's GPX elevation graph, nearby saved POIs (within 2.5 km by straight line), and stage boundaries on the map.
- Lets you change how many days are planned, and move each day's end by clicking/tapping a new position near the GPX line.
- Lets you create an editable accommodation marker at a provisional boundary.
- Persists stage boundaries locally in the browser, and includes them in the next `shared-data.json` export for **manual** cross-device publication.
- Pre-caches the published route file for limited offline reading of track and stages after the app has been opened online. **Basemap tiles are NOT offline.** MapLibre's external JS/CSS may also need connectivity unless already cached by the browser.

The full GPX is still retained and shown faintly for context. The stats panel refers to the selected trip section, not the full file. Unpublished local POI and stage changes are not silently overwritten.

**Copyright warning:** the current published GPX file identifies itself as Saturday Walkers Club © 2024, all rights reserved. This code does not license the GPX for redistribution. Ensure you have permission before keeping it in a public repository; otherwise use a suitably licensed route track or keep your data private.
