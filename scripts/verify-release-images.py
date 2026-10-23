#!/usr/bin/env python3
"""Resolve immutable registry images and verify their source/version labels."""
import argparse
import hashlib
import json
import re
import urllib.error
import urllib.request

ACCEPT = ", ".join([
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
])


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def registry_url(registry, repository, endpoint, reference):
    require(bool(re.fullmatch(r"[a-zA-Z0-9.-]+(?::[0-9]+)?", registry)), "Invalid registry host")
    require(repository in ("youtube2text-api", "youtube2text-web"), "Invalid repository")
    require(bool(re.fullmatch(r"(?:[0-9]+\.[0-9]+\.[0-9]+|sha256:[a-f0-9]{64})", reference)), "Invalid image reference")
    return f"https://{registry}/v2/{repository}/{endpoint}/{reference}"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("Unexpected registry redirect")


def fetch(registry, repository, endpoint, reference):
    request = urllib.request.Request(registry_url(registry, repository, endpoint, reference), headers={"Accept": ACCEPT})
    with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
        body = response.read(4 * 1024 * 1024 + 1)
        require(len(body) <= 4 * 1024 * 1024, "Oversized registry response")
        digest = "sha256:" + hashlib.sha256(body).hexdigest()
        if endpoint == "manifests":
            require(response.headers.get("Docker-Content-Digest") == digest, "Registry manifest digest mismatch")
        if reference.startswith("sha256:"):
            require(reference == digest, "Registry content differs from requested digest")
        return json.loads(body), digest


def require_absent(registry, repository, version):
    try:
        fetch(registry, repository, "manifests", version)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return
        raise
    raise RuntimeError("Immutable release tag already exists; reconcile instead of rebuilding")


def resolve_image(registry, repository, version, revision, expected=""):
    require(bool(re.fullmatch(r"[a-f0-9]{40}", revision)), "Invalid source revision")
    if expected:
        require(bool(re.fullmatch(r"sha256:[a-f0-9]{64}", expected)), "Invalid expected digest")
    manifest, digest = fetch(registry, repository, "manifests", version)
    require(not expected or expected == digest, "Published tag differs from the qualified digest")
    if "manifests" in manifest:
        matches = [m for m in manifest["manifests"] if m.get("platform", {}).get("os") == "linux" and m.get("platform", {}).get("architecture") == "amd64"]
        require(len(matches) == 1, "Expected exactly one linux/amd64 manifest")
        manifest, _ = fetch(registry, repository, "manifests", matches[0]["digest"])
    config, _ = fetch(registry, repository, "blobs", manifest["config"]["digest"])
    require(config.get("os") == "linux" and config.get("architecture") == "amd64", "Unexpected image platform")
    labels = config.get("config", {}).get("Labels", {})
    require(labels.get("org.opencontainers.image.revision") == revision, "Image revision differs from runtime source")
    require(labels.get("org.opencontainers.image.version") == version, "Image version differs from release")
    return digest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("registry", "version", "revision"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--api-digest", default="")
    parser.add_argument("--web-digest", default="")
    args = parser.parse_args()
    digests = [resolve_image(args.registry, "youtube2text-" + kind, args.version, args.revision, getattr(args, kind + "_digest")) for kind in ("api", "web")]
    print(" ".join(digests))
