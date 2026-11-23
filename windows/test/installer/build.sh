#!/bin/bash
# Baut aus ../app: SimpleMail-Setup-<Version>.exe (Installer) und SimpleMail-Windows-portable.zip in ../dist
# Voraussetzungen (Linux): node, npm i in ../app und ../test, makensis (apt install nsis), zip
set -e
T="$(cd "$(dirname "$0")/.." && pwd)"; APP="$T/../app"; DIST="$T/../dist"
V=$(node -p "require('$APP/package.json').version")
node "$T/pack.js"
SRC="$DIST/SimpleMail-win32-x64"
cp "$APP/README-Windows.txt" "$SRC/LIESMICH.txt"
makensis -V2 -DVERSION="$V" -DSRC="$SRC" -DICON="$APP/assets/icon.ico" -DOUT="$DIST/SimpleMail-Setup-$V.exe" "$T/installer/SimpleMail.nsi"
# Portable: gleicher Programmordner + portable.txt → Daten im Unterordner „Daten“
P="$DIST/portable/SimpleMail-Portable"; rm -rf "$DIST/portable"; mkdir -p "$P"; cp -r "$SRC/." "$P/"
cp "$T/installer/portable.txt" "$P/portable.txt"
rm -f "$DIST/SimpleMail-Windows-portable.zip"; (cd "$DIST/portable" && zip -qr -9 "$DIST/SimpleMail-Windows-portable.zip" SimpleMail-Portable)
ls -la "$DIST"/*.exe "$DIST"/*.zip
