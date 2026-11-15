#!/bin/sh
# One-time production bootstrap. Generates every secret as a 0600 file under
# ./secrets (never committed; mounted as Docker/Kubernetes secrets).
#
#   ./scripts/production-init.sh https://app.example.com
#
# Re-running never overwrites an existing secret.
set -eu
ORIGIN="${1:-}"
case "$ORIGIN" in https://*) ;; *) echo "usage: $0 https://your.public.origin" >&2; exit 2;; esac
umask 077
mkdir -p secrets
b64url() { openssl rand -base64 "$1" | tr -d '\n=' | tr '/+' '_-'; }
put() { [ -e "secrets/$1" ] && { echo "keep   secrets/$1"; return; }; printf '%s' "$2" > "secrets/$1"; echo "create secrets/$1"; }

put session          "$(b64url 32)"
put login_password   "$(b64url 24)"
put operations_token "$(b64url 32)"
put backup_key       "$(go run ./cmd/server -generate-backup-key | cut -d= -f2)"

if [ ! -e secrets/transport_key ]; then
  out="$(go run ./cmd/server -generate-transport-key)"
  put transport_key "$(echo "$out" | sed -n 's/^APP_SECURE_TRANSPORT_KEY=//p')"
fi
if [ ! -e secrets/signing_key ]; then
  out="$(go run ./cmd/server -generate-signing-key)"
  put signing_key "$(echo "$out" | sed -n 's/^APP_RESPONSE_SIGNING_PRIVATE_KEY=//p')"
fi

echo
echo "Secrets written to ./secrets (0600, git-ignored). Back them up in your secret manager:"
echo "losing transport_key/signing_key invalidates enrolled devices; losing backup_key makes backups unreadable."
echo
echo "Initial admin password is in secrets/login_password - replace the demo login with your identity system."
echo "Add to .env:  APP_ENV=production  APP_ORIGIN=$ORIGIN  APP_TRUSTED_PROXIES=<your proxy subnet>"
