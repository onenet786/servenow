# Play Store Upload Requirements and Release Guide

This document lists everything required to produce and upload a signed Android App Bundle (AAB) for the ServeNow Flutter app, along with a step‑by‑step checklist.

## 1) Technical Requirements

- Android package name (applicationId): must be globally unique and immutable after publishing.
  - Current: `com.onenetsol.servenow`
  - Recommended: `com.yourcompany.servenow`
  - Update in: `android/app/build.gradle.kts` under `defaultConfig { applicationId = "..." }`

- Versioning:
  - Controlled by `pubspec.yaml` (Flutter reads these for Android):
    - `version: MAJOR.MINOR.PATCH+BUILD`
  - Increment `BUILD` for every Play Store upload (e.g., `1.0.1+2`).

- Target API Level:
  - Must target the latest Play requirement (typically API 34 at time of writing).
  - This Flutter project uses `flutter.targetSdkVersion`; ensure your Flutter SDK/Android toolchain is up to date.

- 64-bit requirement:
  - Flutter builds arm64-v8a by default in release; satisfied.

- App bundle format:
  - Upload `.aab` (Android App Bundle) to Play Console, not `.apk`.

- Signing:
  - Use your upload keystore locally and opt into Play App Signing (recommended).

- Min SDK:
  - Ensure it meets plugin requirements. Project uses `flutter.minSdkVersion`.

- ProGuard / R8:
  - Enabled for release in `android/app/build.gradle.kts` with `proguard-rules.pro` present.

## 2) Keystore and Signing Setup (one-time)

1. Generate a keystore (if you don’t have one):

   ```sh
   keytool -genkeypair -v \
     -keystore android/release-keystore.jks \
     -keyalg RSA -keysize 2048 -validity 10000 \
     -alias upload
   ```

   - Execute from `mobile_app/` or adjust path accordingly.
   - Remember the store password and key password.

2. Create signing config file `android/key.properties`:

   ```properties
   storeFile=android/release-keystore.jks
   storePassword=YOUR_STORE_PASSWORD
   keyAlias=upload
   keyPassword=YOUR_KEY_PASSWORD
   ```

3. Keep secrets out of Git:
   - Ensure `android/key.properties` and any `*.jks` files are ignored by `.gitignore`.

## 3) Build a Signed Release AAB

Easiest: run `build_apk.bat` in the repo root (`D:\GIT-HUB\servenowuild_apk.bat`).
It builds the AAB and per-ABI APKs with the size flags below
(`build_apk.bat aab` = AAB only, `build_apk.bat apk` = APKs only).

By hand, from the `mobile_app` folder:

```sh
flutter clean
flutter pub get
flutter build appbundle --release --obfuscate --split-debug-info=build/symbols --tree-shake-icons
# Optional, for direct installs (one APK per CPU type instead of one fat APK):
flutter build apk --release --split-per-abi --obfuscate --split-debug-info=build/symbols --tree-shake-icons
```

Output:
- `build/app/outputs/bundle/release/app-release.aab` (upload this to Play)
- `build/app/outputs/flutter-apk/app-{armeabi-v7a,arm64-v8a,x86_64}-release.apk`
- `build/symbols/` (Dart debug symbols, see "Release size" below)

### Release size

What each flag does and why it is on:

| Flag | Effect |
|---|---|
| `appbundle` (AAB) | Play builds a device-specific APK from the bundle: users download only their CPU's native code and their screen density's resources. Play requires AAB for new apps anyway. |
| `--split-per-abi` (APK only) | Three APKs (armeabi-v7a, arm64-v8a, x86_64) instead of one "fat" APK with all three copies of the Flutter engine and Dart code. Use the `arm64-v8a` one for almost every current phone; `armeabi-v7a` for old 32-bit phones. Not needed for Play uploads (the AAB already does this). |
| `--obfuscate --split-debug-info=build/symbols` | Strips Dart symbol names from `libapp.so` and writes them to `build/symbols/*.symbols` on the build machine. Smaller binary and less readable if decompiled. |
| `--tree-shake-icons` | Only the Material icon glyphs the app uses are kept in the icon font (this is the release default; it is passed explicitly so it is never switched off by accident). |

Also done in the app itself (2026-10-29): `pubspec.yaml` now bundles only the
one image asset the code loads (`assets/icon/servenow_brand_logo_v2.png`);
seven unused PNG/JPEG files (about 3.9 MB) are no longer packed into every
build. The files stay in `assets/` for the launcher-icon tool.

**Keep `build/symbols/` for every release you upload** (zip it next to the
AAB, named with the version). Without it, crash stack traces from that
release cannot be read. To read one:

```sh
flutter symbolize -i crash_stacktrace.txt -d build/symbols/app.android-arm64.symbols
```

Play Console can also symbolize native crashes if you upload the native debug
symbols; Dart stack traces always need the files above.

Signing is not affected by any of these flags: the release build is still
signed with `android/key.properties` exactly as in section 2.

Size check: after a build, compare
`build/app/outputs/flutter-apk/app-arm64-v8a-release.apk` with the previous
release, or use `flutter build apk --analyze-size --target-platform android-arm64`
for a per-package breakdown. (Sizes were not measured when this was written:
the Android toolchain is not installed on the machine used for the change.)

## 4) Play Console Store Listing Requirements

Prepare the following before creating your production listing:

- App name and short description (up to 80 chars) and full description.
- App icon (512 × 512 px, PNG), feature graphic (1024 × 500 px), and screenshots:
  - Phone screenshots: at least 2 (recommended 1080 × 1920 or device resolution)
  - Optional: 7-inch and 10-inch tablet screenshots
- Category: Application type and category.
- Contact details: Email (and optional website, phone).
- Privacy policy URL: Publicly accessible HTTPS link.

## 5) App Content and Compliance

- Data safety form: disclose data collection, sharing, and security practices.
- Content rating questionnaire: complete and submit.
- Target audience & content: specify age groups and advertising.
- Permissions declarations:
  - If using location (e.g., rider features), explain usage clearly. For background location, additional declarations are required.
  - Notifications (Android 13+): runtime permission handled by plugin; disclose in Data safety if applicable.
- Payments policy:
  - If you sell in-app digital goods/services, you must use Google Play Billing. For physical goods (deliveries), external processors (e.g., Stripe) are acceptable; ensure compliance with policy.

## 6) App Integrity and Play Signing

- Play App Signing is recommended; upload your `.aab` signed with your upload key.
- App Integrity: No additional steps if using Play App Signing; Google manages the distribution keys.

## 7) Pre-Launch Checks and Testing

- Internal testing track: upload and test internally first.
- Pre-launch report (optional): enables automated device testing.
- Crash and ANR monitoring after release.

## 8) Common Project Adjustments

- Change package name (if still using default):
  - Update `applicationId` in `android/app/build.gradle.kts`.
  - Verify Kotlin/Java package in `android/app/src/main/kotlin/...` matches or adjust only if you use native code referencing it.

- Version updates:
  - Edit `pubspec.yaml` `version:` then rebuild. Example: `1.0.1+2`.

- ProGuard rules:
  - Adjust `android/app/proguard-rules.pro` for additional libraries if you add more plugins that use reflection.

- Icons and launcher:
  - This project uses `flutter_launcher_icons`. Re-generate if changing icons:
    ```sh
    flutter pub run flutter_launcher_icons:main
    ```

## 9) Build/Tooling Requirements

- Flutter SDK installed and up to date (`flutter --version`).
- Android SDK/commandline tools installed; accept licenses:
  ```sh
  flutter doctor --android-licenses
  ```
- JDK 17 used by this project (configured in Gradle to use Java 17).

## 10) Final Upload Steps (Checklist)

1. Set a unique `applicationId` in `android/app/build.gradle.kts`.
2. Update `pubspec.yaml` `version:` to a higher build number.
3. Ensure `android/key.properties` and keystore exist and are correct.
4. Run `build_apk.bat aab` from the repo root, or:
   ```sh
   flutter clean && flutter pub get && flutter build appbundle --release --obfuscate --split-debug-info=build/symbols --tree-shake-icons
   ```
5. Verify output AAB at `build/app/outputs/bundle/release/app-release.aab`, and
   archive `build/symbols/` with the version number.
6. In Play Console:
   - Create app (if new) and choose your language, app name.
   - Complete Store listing (text, graphics, screenshots).
   - Fill App content (Data safety, Content rating, Target audience, Permissions).
   - Upload the AAB to an internal testing track first; review pre-launch report.
   - Promote to production when ready.

## 11) Troubleshooting

- SigningConfig fallback to debug:
  - If `android/key.properties` is missing, the release build will fallback to debug signing. Ensure the file exists before building the final AAB.
- "Package name already exists":
  - Choose a different `applicationId`.
- Missing privacy policy:
  - Provide a hosted URL (e.g., in your website). This is required for most apps, especially with data collection/permissions.
- API Level errors on upload:
  - Update Flutter/Android SDKs and rebuild to ensure `targetSdkVersion` meets Play requirements.
- Crashes/ANRs:
  - Check logs via Play Console or connect `firebase_crashlytics` (optional) for better diagnostics.

---

This guide is tailored to the current project setup and Play policies commonly required for production releases. If you need iOS/App Store guidance, create a separate release checklist for Xcode signing, provisioning, and App Store Connect submission.
