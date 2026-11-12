# Wales Hiking Map

Mobile-first hiking map for the Offa's Dyke Path in Wales.

## First prototype

The initial MVP package is ready. To put the web app online, upload the **contents** of the provided `wales-hiking-map-mvp.zip` archive to the root of this repository. The site consists of `index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest`, and the `icons/` folder.

Features in the MVP: OpenFreeMap/MapLibre basemap, GPX import, GPS position, editable points of interest and overnight stops, distance measuring, and JSON export/import of locally stored changes.

Important: this version does **not** provide fully offline map tiles or cross-device cloud sync.

## Publish through GitHub Pages

Go to **Settings → Pages**, select **Deploy from a branch**, choose `main` and `/ (root)`, then save.

Site URL: https://rashoed.github.io/wales-hiking-map/

## Development

The app uses plain HTML, CSS and JavaScript. No build step is required. To preview locally, run `python3 -m http.server 8000` in this directory and open http://localhost:8000.

## Privacy

Do not commit private trip notes or location history to this public repository. User edits in the prototype are browser-local.
