# UsmanAI Android setup

This starter creates a native Android shell that opens the existing HTTPS UsmanAI website:
https://vortexviperog.pythonanywhere.com/

## Requirements
- Node.js 22 or newer
- Android Studio (current stable)
- Android SDK installed through Android Studio

## Build the Android project
1. Extract this ZIP.
2. Open a terminal in the extracted `UsmanAI-Android-Setup` folder.
3. Run:

   ```bash
   npm install
   npx cap add android
   npx cap sync android
   npx cap open android
   ```

4. In Android Studio, allow Gradle sync and install any SDK packages it requests.
5. Connect an Android phone with USB debugging enabled, or create an emulator, then press Run.
6. To create an APK: in Android Studio choose **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
   Android Studio will show the exact APK output location when the build completes.

## Important architecture note
This first Android setup loads the hosted website directly rather than copying its HTML/JS into the app. This preserves the website's own HTTPS origin and is more likely to keep its existing login/session-cookie behavior than loading it inside a separate-origin iframe.

It is a practical first test build, not yet a fully offline or store-ready mobile app. The app needs internet access. Test sign-up/login, chat, chat history, logout, keyboard behavior, and Android Back navigation on a real phone. If those tests reveal issues, we should address them before public distribution. A later production release should use a bundled web build with a deliberate API/authentication configuration rather than relying on a remote development-style server URL.

## iOS
The same Capacitor configuration can be used as a starting point for iOS, but creating and signing the iOS app requires macOS and Xcode.

## Security
Do not put API keys, Supabase keys, passwords, or signing credentials in this project or share them in chat. Keep backend secrets on the server.
