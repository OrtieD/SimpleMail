#!/bin/bash
# Baut SimpleMail.app (Release) im Ordner build/
set -euo pipefail
cd "$(dirname "$0")"

swift build -c release

# Bundle außerhalb des Schreibtischs bauen und signieren: iCloud/Finder hängen dort
# Attribute an, an denen codesign mit „detritus not allowed“ scheitert
FINAL="build/SimpleMail.app"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/simplemail.XXXXXX")"
APP="$WORK/SimpleMail.app"
rm -rf "$FINAL"
mkdir -p build
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp Assets/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
cp .build/release/SimpleMail "$APP/Contents/MacOS/SimpleMail"

cat > "$APP/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key><string>SimpleMail</string>
    <key>CFBundleDisplayName</key><string>SimpleMail</string>
    <key>CFBundleIdentifier</key><string>local.simplemail</string>
    <key>CFBundleExecutable</key><string>SimpleMail</string>
    <key>CFBundleIconFile</key><string>AppIcon</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>2.43</string>
    <key>CFBundleVersion</key><string>45</string>
    <key>LSMinimumSystemVersion</key><string>13.0</string>
    <key>NSHighResolutionCapable</key><true/>
    <key>NSContactsUsageDescription</key><string>SimpleMail schlägt beim Schreiben Adressen aus deinen Kontakten vor.</string>
    <key>NSCalendarsUsageDescription</key><string>SimpleMail zeigt deine Termine an und trägt Einladungen in deinen Kalender ein.</string>
    <key>NSCalendarsFullAccessUsageDescription</key><string>SimpleMail zeigt deine Termine an und trägt Einladungen in deinen Kalender ein.</string>
    <key>CFBundleDevelopmentRegion</key><string>de</string>
</dict>
</plist>
EOF

# Mit eigenem, gleichbleibendem Zertifikat signieren (siehe setup_signing.sh): dann merkt sich macOS
# „Immer erlauben“ für den Schlüsselbund auch nach einem Neubau. Sonst einfache Ad-hoc-Signatur.
# Erweiterte Attribute (Finder-Infos, Quarantäne) entfernen – sonst bricht codesign mit „detritus not allowed“ ab
xattr -cr "$APP"
IDENT="SimpleMail Lokal"
if security find-certificate -c "${IDENT}" >/dev/null 2>&1 && codesign --force --deep -s "${IDENT}" "$APP" 2>/dev/null; then
    echo "Signiert mit Zertifikat „${IDENT}“."
else
    codesign --force --deep -s - "$APP"
    echo "Hinweis: Einmal 'bash setup_signing.sh' ausführen – dann fragt macOS nach dem Bauen nicht mehr nach dem Passwort."
fi
codesign --verify --deep "$APP"
# ohne erweiterte Attribute zurückkopieren
ditto --noextattr --norsrc "$APP" "$FINAL"
rm -rf "$WORK"
touch "$FINAL"   # Finder-Icon-Cache aktualisieren
echo "Fertig: $FINAL  →  nach /Programme ziehen oder: open $FINAL"
