#!/bin/sh
set -eu

export PATH="/share/ZFS530_DATA/.qpkg/container-station/bin:$PATH"
COMPOSE="/usr/local/lib/docker/cli-plugins/docker-compose"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SECRETS_FILE="$SCRIPT_DIR/.env.doppler"
RELEASE_FILE="$SCRIPT_DIR/release.env"

umask 077
cleanup() {
    rm -f "$SECRETS_FILE"
}
trap cleanup EXIT INT TERM

require_file_value() {
    _name="$1"
    if ! grep -Eq "^${_name}=.+$" "$SECRETS_FILE"; then
        echo "ERROR: required Doppler secret ${_name} is missing" >&2
        exit 1
    fi
}

require_one_of() {
    _first="$1"
    _second="$2"
    if ! grep -Eq "^(${_first}|${_second})=.+$" "$SECRETS_FILE"; then
        echo "ERROR: Doppler must provide ${_first} or ${_second}" >&2
        exit 1
    fi
}

if [ ! -f "$SCRIPT_DIR/.env" ]; then
    echo "ERROR: .env must contain DOPPLER_TOKEN" >&2
    exit 1
fi
if [ ! -f "$RELEASE_FILE" ] || ! grep -Eq '^Y2T_IMAGE_TAG=[0-9]+\.[0-9]+\.[0-9]+$' "$RELEASE_FILE"; then
    echo "ERROR: release.env must contain a semver Y2T_IMAGE_TAG" >&2
    exit 1
fi

DOPPLER_TOKEN="$(grep '^DOPPLER_TOKEN=' "$SCRIPT_DIR/.env" | cut -d'=' -f2-)"
if [ -z "$DOPPLER_TOKEN" ]; then
    echo "ERROR: DOPPLER_TOKEN is empty" >&2
    exit 1
fi

echo "Fetching production secrets from Doppler..."
docker run --rm -e "DOPPLER_TOKEN=$DOPPLER_TOKEN" \
    dopplerhq/cli secrets download --no-file --format env > "$SECRETS_FILE"

require_file_value Y2T_API_KEY
require_file_value Y2T_WEB_AUTH_SECRET
require_file_value Y2T_WEB_AUTH_PASSPHRASE

STT_PROVIDER="$(sed -n 's/^Y2T_STT_PROVIDER=//p' "$SECRETS_FILE" | tail -n 1 | tr -d "'\"")"
case "${STT_PROVIDER:-deepgram}" in
    assemblyai) require_one_of ASSEMBLYAI_API_KEY Y2T_ASSEMBLYAI_API_KEYS ;;
    deepgram) require_one_of DEEPGRAM_API_KEY Y2T_DEEPGRAM_API_KEYS ;;
    openai_whisper) require_one_of OPENAI_API_KEY Y2T_OPENAI_API_KEY ;;
    *) echo "ERROR: unsupported Y2T_STT_PROVIDER" >&2; exit 1 ;;
esac

cd "$SCRIPT_DIR"
$COMPOSE --env-file "$RELEASE_FILE" --env-file "$SECRETS_FILE" config --quiet
$COMPOSE --env-file "$RELEASE_FILE" --env-file "$SECRETS_FILE" pull
$COMPOSE --env-file "$RELEASE_FILE" --env-file "$SECRETS_FILE" up -d --remove-orphans
cleanup

echo "Media2Text started. Check status with: $COMPOSE --env-file release.env ps"
