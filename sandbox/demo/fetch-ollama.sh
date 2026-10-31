#!/bin/sh
# Downloads the pinned Ollama release for one CPU architecture, verifies its SHA-256 and unpacks it (CPU
# backends only: the GPU libraries are most of the download and are not used in the demo).
#   OLLAMA_VERSION, OLLAMA_SHA256_AMD64, OLLAMA_SHA256_ARM64 come from the Containerfile.
#   fetch-ollama <amd64|arm64> <destination>
set -eu
arch="${1:?architecture (amd64 or arm64)}"
dest="${2:?destination directory}"
case "$arch" in
  amd64) sha="${OLLAMA_SHA256_AMD64:?}" ;;
  arm64) sha="${OLLAMA_SHA256_ARM64:?}" ;;
  *) echo "unsupported architecture: $arch" >&2; exit 1 ;;
esac
tmp="$(mktemp)"
curl -fsSL -o "$tmp" "https://github.com/ollama/ollama/releases/download/${OLLAMA_VERSION:?}/ollama-linux-${arch}.tar.zst"
echo "${sha}  ${tmp}" | sha256sum -c -
mkdir -p "$dest"
zstd -dc "$tmp" | tar -xf - -C "$dest" \
  --exclude='lib/ollama/cuda_*' --exclude='lib/ollama/vulkan' --exclude='lib/ollama/rocm*' --exclude='lib/ollama/mlx*'
rm -f "$tmp"
test -x "$dest/bin/ollama"
