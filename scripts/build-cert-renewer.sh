#!/usr/bin/env bash
# Build the cert-renewer Lambda package (handler + Linux wheels) into
# build/cert-renewer. Terraform runs this as an external data source on every
# plan, so it prints only the JSON Terraform expects; uv's output goes to stderr.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${REPO_ROOT}/cert-renewer"
OUT="${REPO_ROOT}/build/cert-renewer"

rm -rf "${OUT}"
mkdir -p "${OUT}"
uv pip install --quiet \
  --target "${OUT}" \
  --python-version 3.12 \
  --python-platform x86_64-manylinux_2_28 \
  --only-binary :all: \
  -r "${SRC}/requirements.txt" >&2
cp "${SRC}/handler.py" "${OUT}/"

printf '{"dir": "%s"}\n' "${OUT}"
