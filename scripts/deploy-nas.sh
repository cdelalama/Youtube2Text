#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAS_HOST="${NAS_HOST:-10.0.0.220}"
NAS_DIR="${NAS_DIR:-/share/Container/compose/youtube2text}"
REGISTRY="${REGISTRY:-registry.lamanoriega.com}"
API_URL="${Y2T_DEPLOY_API_URL:-http://10.0.0.220:8787}"
WEB_URL="${Y2T_DEPLOY_WEB_URL:-https://y2t.lamanoriega.com}"
MODE="deploy"
SKIP_CHECKS=false
SKIP_BUILD=false
VERSION=""

usage() {
  cat <<'EOF'
Usage:
  scripts/deploy-nas.sh [VERSION] [--skip-checks] [--skip-build]
  scripts/deploy-nas.sh --rollback VERSION

Environment overrides: NAS_HOST, NAS_DIR, REGISTRY, Y2T_DEPLOY_API_URL,
Y2T_DEPLOY_WEB_URL.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rollback)
      MODE="rollback"
      VERSION="${2:-}"
      shift 2
      ;;
    --skip-checks)
      SKIP_CHECKS=true
      shift
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -n "$VERSION" ]]; then
        usage >&2
        exit 2
      fi
      VERSION="$1"
      shift
      ;;
  esac
done

cd "$ROOT_DIR"
VERSION="${VERSION:-$(tr -d '[:space:]' < VERSION)}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "ERROR: invalid version: $VERSION" >&2
  exit 2
fi

REMOTE_DOCKER_PATH='/share/ZFS530_DATA/.qpkg/container-station/bin'

run_release_checks() {
  local source_version
  source_version="$(tr -d '[:space:]' < VERSION)"
  if [[ "$VERSION" != "$source_version" ]]; then
    echo "ERROR: deploy version $VERSION does not match source VERSION $source_version" >&2
    exit 1
  fi
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "ERROR: release deployment requires a clean worktree" >&2
    exit 1
  fi
  npm test
  npm run build
  npm --prefix web run build
  npm run version:check
  scripts/check-version-sync.sh
  npm run naming:check
  npm run api:contract:check
  node scripts/check-yt-dlp-upstream.mjs --pin-only
}

build_and_push() {
  local revision
  revision="$(git rev-parse HEAD)"
  docker build \
    --label "org.opencontainers.image.revision=$revision" \
    --label "org.opencontainers.image.version=$VERSION" \
    -t "$REGISTRY/youtube2text-api:$VERSION" .
  docker build \
    --label "org.opencontainers.image.revision=$revision" \
    --label "org.opencontainers.image.version=$VERSION" \
    -t "$REGISTRY/youtube2text-web:$VERSION" \
    -f web/Dockerfile web/
  docker push "$REGISTRY/youtube2text-api:$VERSION"
  docker push "$REGISTRY/youtube2text-web:$VERSION"
}

previous_version() {
  ssh -o BatchMode=yes "$NAS_HOST" "
    if [ -f '$NAS_DIR/release.env' ]; then
      sed -n 's/^Y2T_IMAGE_TAG=//p' '$NAS_DIR/release.env' | tail -n 1
    else
      sed -n 's/.*youtube2text-api:v\\([0-9][0-9.]*\\).*/\\1/p' '$NAS_DIR/docker-compose.yml' | head -n 1
    fi
  "
}

preserve_legacy_rollback_images() {
  local previous="$1"
  [[ -z "$previous" ]] && return
  ssh -o BatchMode=yes "$NAS_HOST" "
    set -eu
    export PATH='$REMOTE_DOCKER_PATH':\"\$PATH\"
    for image in youtube2text-api youtube2text-web; do
      target='$REGISTRY'/\$image:$previous
      if docker image inspect \"\$target\" >/dev/null 2>&1; then
        continue
      fi
      legacy=\$image:v$previous
      if docker image inspect \"\$legacy\" >/dev/null 2>&1; then
        docker tag \"\$legacy\" \"\$target\"
        docker push \"\$target\"
      fi
    done
  "
}

install_runtime_files() {
  local stamp="$1"
  ssh -o BatchMode=yes "$NAS_HOST" "
    set -eu
    mkdir -p '$NAS_DIR/.deploy-backups/$stamp'
    for file in docker-compose.yml start.sh stop.sh release.env; do
      if [ -f '$NAS_DIR/'\"\$file\" ]; then
        cp -p '$NAS_DIR/'\"\$file\" '$NAS_DIR/.deploy-backups/$stamp/'
      fi
    done
  "
  # QNAP's SSH server has no SFTP subsystem; force OpenSSH's legacy SCP transport.
  scp -O deploy/nas/docker-compose.yml "$NAS_HOST:$NAS_DIR/docker-compose.yml.new"
  scp -O deploy/nas/start.sh "$NAS_HOST:$NAS_DIR/start.sh.new"
  scp -O deploy/nas/stop.sh "$NAS_HOST:$NAS_DIR/stop.sh.new"
  ssh -o BatchMode=yes "$NAS_HOST" "
    set -eu
    mv '$NAS_DIR/docker-compose.yml.new' '$NAS_DIR/docker-compose.yml'
    mv '$NAS_DIR/start.sh.new' '$NAS_DIR/start.sh'
    mv '$NAS_DIR/stop.sh.new' '$NAS_DIR/stop.sh'
    printf 'Y2T_IMAGE_TAG=%s\\n' '$VERSION' > '$NAS_DIR/release.env'
    chmod 644 '$NAS_DIR/docker-compose.yml' '$NAS_DIR/release.env'
    chmod 755 '$NAS_DIR/start.sh' '$NAS_DIR/stop.sh'
  "
}

restore_backup() {
  local stamp="$1"
  echo "Deployment verification failed; restoring NAS deployment files from $stamp" >&2
  ssh -o BatchMode=yes "$NAS_HOST" "
    set -eu
    backup='$NAS_DIR/.deploy-backups/$stamp'
    for file in docker-compose.yml start.sh stop.sh; do
      cp -p \"\$backup/\$file\" '$NAS_DIR/'\"\$file\"
    done
    if [ -f \"\$backup/release.env\" ]; then
      cp -p \"\$backup/release.env\" '$NAS_DIR/release.env'
    else
      rm -f '$NAS_DIR/release.env'
    fi
    cd '$NAS_DIR'
    /bin/sh start.sh
  "
}

verify_release() {
  if [[ "$MODE" == "rollback" ]]; then
    node scripts/verify-deployment.mjs \
      --api-url "$API_URL" --web-url "$WEB_URL" --version "$VERSION" --legacy true
  else
    doppler run -p youtube2text -c prd -- \
      node scripts/verify-deployment.mjs \
        --api-url "$API_URL" --web-url "$WEB_URL" --version "$VERSION"
  fi
}

if [[ "$MODE" == "deploy" ]]; then
  if [[ "$SKIP_CHECKS" != true ]]; then run_release_checks; fi
  if [[ "$SKIP_BUILD" != true ]]; then build_and_push; fi
else
  for image in youtube2text-api youtube2text-web; do
    curl -fsS "https://$REGISTRY/v2/$image/tags/list" | grep -q "\"$VERSION\"" || {
      echo "ERROR: rollback image $REGISTRY/$image:$VERSION is not in the registry" >&2
      exit 1
    }
  done
fi

PREVIOUS_VERSION="$(previous_version)"
if [[ "$MODE" == "deploy" ]]; then preserve_legacy_rollback_images "$PREVIOUS_VERSION"; fi
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
install_runtime_files "$STAMP"

ssh -o BatchMode=yes "$NAS_HOST" "cd '$NAS_DIR' && /bin/sh start.sh"
if ! verify_release; then
  restore_backup "$STAMP"
  exit 1
fi

echo "Deployed Media2Text $VERSION to $NAS_HOST (previous: ${PREVIOUS_VERSION:-unknown})."
