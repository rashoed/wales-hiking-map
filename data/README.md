# Published trip data

This directory holds the optional `shared-data.json` file, which the app reads on each device.

## Publish your itinerary

1. Open the web app on the device where you imported the GPX and edited the points.
2. Select **⋯ → Скачать общие данные для GitHub**. Your browser downloads `shared-data.json`.
3. In this GitHub repository, open the `data/` folder and select **Add file → Upload files**.
4. Upload `shared-data.json` and commit it to `main`.
5. After the GitHub Pages deployment succeeds, refresh the website on your phone.

A new device will load the published track and points automatically. Local unpublished edits are preserved; to intentionally replace them, select **⋯ → Загрузить опубликованную версию**.

This is manual publishing, **not continuous real-time synchronization**. A writable authenticated backend is needed for that.
