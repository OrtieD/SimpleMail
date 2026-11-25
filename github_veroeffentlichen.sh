#!/bin/bash
# SimpleMail auf GitHub veröffentlichen bzw. aktualisieren (Benutzer OrtieD, Repo SimpleMail).
#
#   bash github_veroeffentlichen.sh              → Quellcode hochladen (erstes Mal: Repo anlegen)
#   bash github_veroeffentlichen.sh --release    → zusätzlich Release mit Mac-App + Windows-Zip
#
# Für das Release: Windows-Dateien in „Downloads“ oder als Teile in „Claude outputs/release-<Version>/“.
set -euo pipefail
cd "$(dirname "$0")"

OWNER="OrtieD"
REPO="SimpleMail"
RELEASE=0
[ "${1:-}" = "--release" ] && RELEASE=1

say()  { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m✗ %s\033[0m\n' "$*"; exit 1; }
ask()  { local a; read -r -p "$1 [j/n] " a; [[ "$a" =~ ^[jJyY] ]]; }

# ---------- 1. Werkzeuge ----------
say "Prüfe Werkzeuge"
command -v git >/dev/null || fail "git fehlt – im Terminal 'xcode-select --install' ausführen."
if ! command -v gh >/dev/null; then
  if [ -x "$HOME/.local/bin/gh" ]; then
    export PATH="$HOME/.local/bin:$PATH"
  elif command -v brew >/dev/null; then
    brew install gh
  else
    echo "Lade GitHub-Kommandozeile (gh) herunter …"
    TMP=$(mktemp -d)
    URL=$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest \
          | grep -o 'https://[^"]*macOS_universal\.zip' | head -1)
    [ -n "$URL" ] || fail "Download-Adresse für gh nicht gefunden."
    curl -fsSL "$URL" -o "$TMP/gh.zip"
    unzip -q "$TMP/gh.zip" -d "$TMP"
    mkdir -p "$HOME/.local/bin"
    cp "$TMP"/gh_*/bin/gh "$HOME/.local/bin/gh"
    xattr -d com.apple.quarantine "$HOME/.local/bin/gh" 2>/dev/null || true
    rm -rf "$TMP"
    export PATH="$HOME/.local/bin:$PATH"
  fi
fi
echo "git und gh sind da."

# ---------- 2. Anmelden ----------
say "Anmeldung bei GitHub"
if ! gh auth status >/dev/null 2>&1; then
  echo "Gleich öffnet sich der Browser. Den angezeigten Code dort eingeben und mit $OWNER anmelden."
  gh auth login --hostname github.com --git-protocol https --web
fi
LOGIN=$(gh api user --jq .login)
[ "$LOGIN" = "$OWNER" ] || fail "Angemeldet als '$LOGIN', erwartet '$OWNER'. Abmelden: gh auth logout"
gh auth setup-git >/dev/null
echo "Angemeldet als $LOGIN."

# ---------- 3. Lokales Repo ----------
say "Bereite Git-Repo im Ordner vor"
[ -f .gitignore ] || fail ".gitignore fehlt – bitte nicht ohne starten."
if [ ! -d .git ]; then
  git init -q -b main
fi
# Commits mit der privaten GitHub-Adresse statt der echten E-Mail
UID_GH=$(gh api user --jq .id)
git config user.name  "$OWNER"
git config user.email "${UID_GH}+${OWNER}@users.noreply.github.com"

git add -A
# Sicherheitsnetz: nichts Großes oder Privates hochladen
BAD=$(git diff --cached --name-only | grep -Ei '\.(zip|dmg|exe|p12|pem|key|app/|log)$|^build/|^\.build/|^Claude outputs/|^Cache/|^Daten/|node_modules/|google\.json' || true)
[ -z "$BAD" ] || { echo "$BAD"; git reset -q; fail "Diese Dateien dürfen nicht hoch – Vorgang abgebrochen."; }
BIG=$(git diff --cached --name-only -z | xargs -0 -I{} sh -c 'f="{}"; [ -f "$f" ] && [ $(stat -f%z "$f") -gt 5000000 ] && echo "$f"' || true)
[ -z "$BIG" ] || { echo "$BIG"; git reset -q; fail "Dateien über 5 MB gefunden – Vorgang abgebrochen."; }

echo "Folgende Dateien werden hochgeladen:"
git diff --cached --name-status | sed 's/^/   /'
if git diff --cached --quiet; then
  echo "   (keine Änderungen)"
else
  ask "Passt die Liste?" || { git reset -q; fail "Abgebrochen – nichts hochgeladen."; }
  MAC=$(grep -o 'CFBundleShortVersionString</key><string>[^<]*' make_app.sh | sed 's/.*<string>//')
  WIN=$(grep -o '"version": *"[^"]*"' windows/app/package.json | sed 's/.*"\([^"]*\)"$/\1/')
  git commit -q -m "SimpleMail Mac $MAC / Windows $WIN"
  echo "Gespeichert: Mac $MAC / Windows $WIN"
fi

# ---------- 4. Auf GitHub hochladen ----------
say "Hochladen nach github.com/$OWNER/$REPO"
if gh repo view "$OWNER/$REPO" >/dev/null 2>&1; then
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$OWNER/$REPO.git"
  git push -u origin main
else
  if ask "Repo neu anlegen. Soll es ÖFFENTLICH sein (n = privat)?"; then VIS=--public; else VIS=--private; fi
  gh repo create "$OWNER/$REPO" $VIS --source=. --remote=origin --push \
     --description "Schlanker E-Mail-Client für macOS und Windows"
fi
echo "Fertig: https://github.com/$OWNER/$REPO"

# ---------- 5. Release (optional) ----------
if [ "$RELEASE" = 1 ]; then
  say "Release mit fertigen Programmen"
  MAC=$(grep -o 'CFBundleShortVersionString</key><string>[^<]*' make_app.sh | sed 's/.*<string>//')
  WIN=$(grep -o '"version": *"[^"]*"' windows/app/package.json | sed 's/.*"\([^"]*\)"$/\1/')
  TAG="mac-$MAC-win-$WIN"
  OUT=$(mktemp -d)
  FILES=()
  if [ -d /Applications/SimpleMail.app ]; then
    ditto -c -k --keepParent /Applications/SimpleMail.app "$OUT/SimpleMail-Mac-$MAC.zip"
    FILES+=("$OUT/SimpleMail-Mac-$MAC.zip")
  else
    echo "Hinweis: /Applications/SimpleMail.app fehlt – Mac-App wird übersprungen."
  fi
  # Windows: Setup-Zip und portable Zip – aus „Downloads“ oder in Teilen aus „Claude outputs/release-<Version>“
  PARTS="Claude outputs/release-$WIN"
  for NAME in "SimpleMail-Setup-$WIN.zip" "SimpleMail-Windows-portable.zip"; do
    case "$NAME" in *portable.zip) DEST="SimpleMail-Windows-portable-$WIN.zip";; *) DEST="$NAME";; esac
    if [ -f "$HOME/Downloads/$NAME" ]; then
      cp "$HOME/Downloads/$NAME" "$OUT/$DEST"
    elif ls "$PARTS/$NAME.part-"* >/dev/null 2>&1; then
      cat "$PARTS/$NAME.part-"* > "$OUT/$DEST"
      if [ -f "$PARTS/SHA256SUMS" ]; then
        WANT=$(grep " $NAME\$" "$PARTS/SHA256SUMS" | cut -d' ' -f1)
        HAVE=$(shasum -a 256 "$OUT/$DEST" | cut -d' ' -f1)
        [ "$WANT" = "$HAVE" ] || fail "$NAME: Prüfsumme stimmt nicht – Teile unvollständig."
      fi
      echo "$NAME aus Teilen zusammengesetzt (Prüfsumme ok)."
    else
      echo "Hinweis: $NAME nicht gefunden – wird übersprungen."; continue
    fi
    FILES+=("$OUT/$DEST")
  done
  [ ${#FILES[@]} -gt 0 ] || fail "Keine Programme gefunden – kein Release angelegt."
  if gh release view "$TAG" -R "$OWNER/$REPO" >/dev/null 2>&1; then
    gh release upload "$TAG" "${FILES[@]}" --clobber -R "$OWNER/$REPO"
  else
    gh release create "$TAG" "${FILES[@]}" -R "$OWNER/$REPO" --target main \
      --title "SimpleMail Mac $MAC / Windows $WIN" \
      --notes "Mac: SimpleMail-Mac-$MAC.zip entpacken, App nach Programme ziehen, beim ersten Start Rechtsklick → Öffnen.
Windows: SimpleMail-Setup-$WIN.zip entpacken und das Setup starten – oder SimpleMail-Windows-portable-$WIN.zip entpacken und SimpleMail.exe starten (SmartScreen: Weitere Informationen → Trotzdem ausführen)."
  fi
  rm -rf "$OUT"
  echo "Release: https://github.com/$OWNER/$REPO/releases/tag/$TAG"
fi
say "Alles erledigt."
