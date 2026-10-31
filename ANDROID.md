# Android app build

This repository keeps the existing GitHub Pages web app and adds an Android wrapper powered by Capacitor.

## Build an APK

1. Open the repository's **Actions** tab.
2. Select **Build Android APK**.
3. Choose **Run workflow** (or let a relevant push trigger it).
4. When the run completes, download the `elhelw-coffee-android-debug` artifact.
5. Extract the ZIP to get `app-debug.apk`.

The current workflow creates a **debug APK for internal testing**. Before company-wide production distribution, create and securely store a release signing key, then configure a signed release build. Never commit signing keys or passwords.

## Local build

```bash
npm install
npm run build:web
npx cap add android
npx cap sync android
npx cap open android
```

Use Android Studio to build and test the APK. The web frontend continues to use the existing Supabase project and public publishable key from `config.js`. Do not put Supabase secret/service_role keys in the client app.
