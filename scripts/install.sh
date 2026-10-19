#!/usr/bin/env bash
# Installs the `bobi` command into ~/.local/bin (or $BOBI_BIN_DIR) as a small wrapper around this checkout.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd -P)"
bin="${BOBI_BIN_DIR:-$HOME/.local/bin}"
mkdir -p "$bin"
cat > "$bin/bobi" <<WRAPPER
#!/usr/bin/env bash
exec bun "$repo/packages/shell/src/cli.ts" "\$@"
WRAPPER
chmod +x "$bin/bobi"
echo "installed $bin/bobi -> $repo"
case ":$PATH:" in *":$bin:"*) ;; *) echo "add $bin to PATH to use 'bobi' from anywhere" ;; esac
