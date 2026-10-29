@echo off
setlocal
REM ServeNow release build (Android).
REM
REM Produces, from mobile_app:
REM   1. build\app\outputs\bundle\release\app-release.aab   (upload this to Play)
REM   2. build\app\outputs\flutter-apk\app-armeabi-v7a-release.apk
REM      build\app\outputs\flutter-apk\app-arm64-v8a-release.apk
REM      build\app\outputs\flutter-apk\app-x86_64-release.apk
REM      (one APK per CPU type, for direct installs / sideloading; each is
REM       much smaller than a single "fat" APK containing all three)
REM
REM Size options (see mobile_app\PLAY_STORE_UPLOAD.md, "Release size"):
REM   --obfuscate --split-debug-info=build\symbols
REM       strips Dart symbol names from the binary; the symbol files needed to
REM       read crash stack traces are written to mobile_app\build\symbols.
REM       Keep that folder for every release you ship.
REM   --tree-shake-icons
REM       only the Material icons the app uses are bundled (already the
REM       release default; stated explicitly so nobody turns it off).
REM
REM Signing is unchanged: android\key.properties + the upload keystore, as
REM configured in android\app\build.gradle.kts.
REM
REM Usage:  build_apk.bat          AAB + per-ABI APKs
REM         build_apk.bat aab      AAB only
REM         build_apk.bat apk      per-ABI APKs only

cd /d "%~dp0mobile_app" || goto :fail

set "SIZE_FLAGS=--release --obfuscate --split-debug-info=build\symbols --tree-shake-icons"
set "TARGET=%~1"

call flutter pub get || goto :fail

if /i "%TARGET%"=="apk" goto :apk

echo.
echo === Building Android App Bundle (AAB) ===
call flutter build appbundle %SIZE_FLAGS% || goto :fail
if /i "%TARGET%"=="aab" goto :done

:apk
echo.
echo === Building per-ABI APKs ===
call flutter build apk --split-per-abi %SIZE_FLAGS% || goto :fail

:done
echo.
echo Build finished.
echo   AAB : %CD%\build\app\outputs\bundle\release\
echo   APKs: %CD%\build\app\outputs\flutter-apk\
echo   Debug symbols (keep for crash reports): %CD%\build\symbols\
pause
exit /b 0

:fail
echo.
echo Build FAILED (exit code %errorlevel%).
pause
exit /b 1
