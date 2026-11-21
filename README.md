# Stratrix

Your payday plan, debt countdown and savings tracker. An installable web app: open it in Chrome on your phone and choose **Install app**.

- **Your data stays on your device.** Nothing is sent anywhere and there's no sign-up. Download a backup now and then (Manage → Your data).
- **Not financial advice.** Stratrix helps you plan and track; decisions are yours.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The whole app, built from `src/` |
| `manifest.webmanifest` | Tells phones it's an installable app (name, icons, colours) |
| `sw.js` | Lets it open offline. Bump `VERSION` when `index.html` changes |
| `icon-*.png` | App icons |
| `src/` | Readable source: `engine.js` (the money rules), `app.js` (screens), `xlsx.js` (Excel export), `template.html` (layout and styles), `build.py` (joins them into `index.html`) |
