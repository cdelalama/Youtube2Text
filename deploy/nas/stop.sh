#!/bin/sh
set -eu

export PATH="/share/ZFS530_DATA/.qpkg/container-station/bin:$PATH"
COMPOSE="/usr/local/lib/docker/cli-plugins/docker-compose"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

cd "$SCRIPT_DIR"
$COMPOSE --env-file "$SCRIPT_DIR/release.env" down
