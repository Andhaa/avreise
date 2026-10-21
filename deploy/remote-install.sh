#!/usr/bin/env bash
set -Eeuo pipefail

# Runs as root on the VPS from deploy-to-arhp.sh. Keeping this in a file on the
# staged release avoids feeding a large heredoc through an allocated SSH TTY.

stage="${1:?missing staged release path}"
app_root="${2:?missing application path}"
service_user="${3:?missing service user}"
release_id="${4:?missing release id}"

if [[ ! -x /usr/bin/node ]]; then
  printf '%s\n' 'ERROR: /usr/bin/node was not found.' >&2
  exit 1
fi

node_major="$(/usr/bin/node -p 'process.versions.node.split(".")[0]')"
if (( node_major < 20 )); then
  printf 'ERROR: Node.js 20 or newer is required; found %s.\n' "$node_major" >&2
  exit 1
fi

if ! command -v convert >/dev/null 2>&1; then
  printf '%s\n' 'ERROR: ImageMagick convert is required for /status.png.' >&2
  exit 1
fi

if ! id "$service_user" >/dev/null 2>&1; then
  useradd --system --home "$app_root" --shell /usr/sbin/nologin "$service_user"
fi

install -d -o "$service_user" -g "$service_user" -m 0755 "$app_root"

if [[ -d "$app_root" && -n "$(find "$app_root" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
  cp -a "$app_root" "${app_root}.previous.${release_id}"
fi

rsync -a --delete --chown="$service_user:$service_user" "$stage/" "$app_root/"
install -o root -g root -m 0644 \
  "$app_root/deploy/umbrella-signage.service" \
  /etc/systemd/system/umbrella-signage.service

if [[ ! -f /etc/default/umbrella-signage ]]; then
  install -o root -g root -m 0644 \
    "$app_root/deploy/umbrella-signage.env.example" \
    /etc/default/umbrella-signage
fi

systemctl daemon-reload
systemctl enable umbrella-signage
systemctl restart umbrella-signage
systemctl --no-pager --full status umbrella-signage

printf '%s\n' '==> Private health check'
curl -fsS http://127.0.0.1:8787/umbrella/healthz
printf '\n'

printf '%s\n' '==> Private PNG check'
private_png="$(mktemp --suffix=.png)"
trap 'rm -f -- "$private_png"' EXIT
curl -fsS -o "$private_png" \
  'http://127.0.0.1:8787/umbrella/status.png?width=800&height=600'
file "$private_png"
