#!/bin/sh
# Wrapper to stabilize yt-dlp extraction on modern YouTube pages.
# Keep args explicit and non-user-configurable (security posture).
exec yt-dlp --js-runtimes node,deno "$@"
