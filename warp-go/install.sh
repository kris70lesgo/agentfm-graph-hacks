#!/bin/sh
set -eu

# Install the Warp CLI from the checkout that contains this script.
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$ROOT"

if ! command -v go >/dev/null 2>&1; then
  echo "Go 1.25 or later is required to build Warp." >&2
  exit 1
fi

go install ./cmd/warp
printf 'Installed warp in %s/bin\n' "$(go env GOPATH)"
