#!/bin/bash
# Einmalig ausführen: legt im Schlüsselbund ein eigenes Signatur-Zertifikat „SimpleMail Lokal“ an.
# make_app.sh signiert damit jede neue Version gleich – macOS erkennt SimpleMail nach dem Neubau wieder
# und fragt nicht erneut nach dem Schlüsselbund-Passwort.
set -euo pipefail
IDENT="SimpleMail Lokal"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"

if security find-certificate -c "${IDENT}" >/dev/null 2>&1; then
    echo "Zertifikat „${IDENT}“ ist bereits vorhanden – nichts zu tun."
    exit 0
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/cfg" <<CFG
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = ${IDENT}
[ext]
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
CFG

/usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout "$TMP/key.pem" -out "$TMP/cert.pem" -config "$TMP/cfg" 2>/dev/null
/usr/bin/openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" \
    -name "${IDENT}" -out "$TMP/id.p12" -passout pass:simplemail

security import "$TMP/id.p12" -k "$KEYCHAIN" -P simplemail -T /usr/bin/codesign >/dev/null
echo "Zertifikat importiert. macOS fragt jetzt einmal nach deinem Passwort, um ihm für Code-Signatur zu vertrauen …"
security add-trusted-cert -r trustRoot -p codeSign -k "$KEYCHAIN" "$TMP/cert.pem" \
    || echo "(Vertrauen nicht gesetzt – Signieren funktioniert trotzdem.)"
echo "Fertig. Ab dem nächsten 'bash make_app.sh' wird mit „${IDENT}“ signiert."
