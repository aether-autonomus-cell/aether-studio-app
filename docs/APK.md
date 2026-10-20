# Android APK

No APK was built for this project. There is no `.apk` in the tree, and this environment did not run Android Studio, Gradle, or Bubblewrap. The steps below are what you run on your own machine after the site is deployed. Do not treat this file as a claim that a package exists.

The phone install path that does exist is the PWA: `public/manifest.webmanifest`, `public/icon-192.png`, `public/icon-512.png`, `public/icon-512-maskable.png`, and `public/sw.js`. The studio shows **Add to Home screen**. The service worker registers on a normal top-level visit to the production build. It does not register inside the embedded preview or while `vite dev` is running, so that preview cannot get stuck on a cached shell.

## Before either path

1. Deploy to Vercel over HTTPS. See the README.
2. Open the live origin (not a file:// page). Confirm these return 200:
   - `/manifest.webmanifest` with content type `application/manifest+json`
   - `/icon-192.png` and `/icon-512.png`
   - `/sw.js`
3. Chrome: the address bar or menu can offer **Install app** after the service worker is controlling the page. iPhone uses Share → Add to Home Screen. That is not an APK.

## Path A — Trusted Web Activity (Bubblewrap)

Use this if the installed icon should open the deployed site.

1. On a computer with JDK 17 and the Android SDK, install the CLI: `npm install -g @bubblewrap/cli`.
2. `bubblewrap init --manifest https://YOUR_DOMAIN/manifest.webmanifest`
3. `bubblewrap build`
4. Sign the APK with a keystore you create locally. Do not commit the keystore, the passwords, or the APK. They are listed in `.gitignore`.
5. Publish `/.well-known/assetlinks.json` on that same domain so the signing certificate matches the TWA. Bubblewrap prints the statement. Without it, the app opens a browser bar instead of standing alone.

## Path B — Capacitor

Use this only if you need a native project, not just a home-screen icon.

1. Add Capacitor in a separate branch. Do not commit `android/app/debug.keystore` or release signing files.
2. Build the web app, then `npx cap add android` and `npx cap sync`.
3. Open the Android project in Android Studio and use **Build → Build Bundle(s) / APK(s)**.
4. The APK is an output of that machine. Copying it into this repo does not make the steps "done" unless the file is actually there — and it should stay gitignored.

Either path can fail on a missing SDK, an unsigned package, or a manifest URL that is not the live HTTPS origin. When it fails, there is still no APK.
