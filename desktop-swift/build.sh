#!/bin/bash
# Builds a small universal macOS app: a native window around the system WebKit (no bundled browser).
set -euo pipefail
cd "$(dirname "$0")"
VERSION="${1:-3.7.1}"
APP="build/Loud Reader.app"
rm -rf build && mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/app"
swiftc -O -target arm64-apple-macos11.0 main.swift -o build/lr-arm64 -framework Cocoa -framework WebKit
swiftc -O -target x86_64-apple-macos11.0 main.swift -o build/lr-x64 -framework Cocoa -framework WebKit
lipo -create build/lr-arm64 build/lr-x64 -output "$APP/Contents/MacOS/LoudReader"
cp app/index.html "$APP/Contents/Resources/app/index.html"
sed "s/__VERSION__/$VERSION/g" Info.plist > "$APP/Contents/Info.plist"
mkdir -p build/icon.iconset
for s in 16 32 128 256 512; do
  sips -z $s $s ../desktop/build/icon.png --out "build/icon.iconset/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) ../desktop/build/icon.png --out "build/icon.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns build/icon.iconset -o "$APP/Contents/Resources/AppIcon.icns"
codesign --force --deep --sign - "$APP"
mkdir -p build/stage && cp -R "$APP" build/stage/ && ln -s /Applications build/stage/Applications
hdiutil create -volname "Loud Reader" -srcfolder build/stage -ov -format UDZO "build/LoudReader-$VERSION-macOS.dmg"
ditto -c -k --keepParent "$APP" "build/LoudReader-$VERSION-macOS.zip"
ls -lh build/*.dmg build/*.zip
