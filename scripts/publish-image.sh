#!/usr/bin/env bash
set -euo pipefail

IMAGE="phuc16/discord-mcp"
PLATFORMS="linux/amd64,linux/arm64"
dry_run=0

usage() {
  echo "usage: scripts/publish-image.sh [--dry-run]" >&2
  echo "  --dry-run  build for the local platform only and load it into the local docker (no push)" >&2
}

for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "refusing to publish: git working tree is not clean" >&2
  exit 1
fi

VERSION="$(node -p "require('./package.json').version")"
GIT_SHA="$(git rev-parse --short HEAD)"

if [ "$dry_run" -eq 1 ]; then
  docker buildx build \
    --load \
    --build-arg "VERSION=${VERSION}" \
    --build-arg "GIT_SHA=${GIT_SHA}" \
    -t "${IMAGE}:${VERSION}" \
    -t "${IMAGE}:latest" \
    -t "${IMAGE}:sha-${GIT_SHA}" \
    .
  echo "dry run: built ${IMAGE}:${VERSION} locally, nothing pushed"
  exit 0
fi

if ! grep -q 'index.docker.io' "${DOCKER_CONFIG:-$HOME/.docker}/config.json" 2>/dev/null; then
  echo "refusing to push: not logged in to Docker Hub (run: docker login)" >&2
  exit 1
fi

docker buildx build \
  --platform "$PLATFORMS" \
  --build-arg "VERSION=${VERSION}" \
  --build-arg "GIT_SHA=${GIT_SHA}" \
  -t "${IMAGE}:${VERSION}" \
  -t "${IMAGE}:latest" \
  -t "${IMAGE}:sha-${GIT_SHA}" \
  --push \
  .
