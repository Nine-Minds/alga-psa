#!/usr/bin/env bash
# Builds the algasim container image without dragging the monorepo into the
# build context. Each emulator package's dist is self-sufficient (the QBO
# package bundles its billing-owned core at build time), so the image is just
# the built packages plus their public npm dependencies.
#
# Usage: ./build-image.sh [image-tag]     (default: algasim:dev)
set -euo pipefail
cd "$(dirname "$0")"

TAG="${1:-algasim:dev}"
PACKAGES=(host msgraph qbo webhook-sink smtp-sink suite)

for pkg in "${PACKAGES[@]}"; do
  (cd "$pkg" && npx tsup)
done

STAGE=stage
rm -rf "$STAGE"
mkdir -p "$STAGE"

for pkg in "${PACKAGES[@]}"; do
  mkdir -p "$STAGE/$pkg"
  cp -R "$pkg/dist" "$STAGE/$pkg/dist"
  cp "$pkg/package.json" "$STAGE/$pkg/package.json"
done
cp -R host/console "$STAGE/host/console"
cp -R suite/scenarios "$STAGE/suite/scenarios"

# Rewrite workspace "*" references to file: paths so npm resolves the staged
# copies instead of the private registry, and emit the stage root manifest.
node - "$STAGE" <<'EOF'
const fs = require('fs');
const stage = process.argv[2];
for (const dir of fs.readdirSync(stage)) {
  const path = `${stage}/${dir}/package.json`;
  const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
  delete pkg.devDependencies;
  delete pkg.scripts;
  for (const [dep, version] of Object.entries(pkg.dependencies ?? {})) {
    if (dep.startsWith('@alga-psa/emulator-')) {
      pkg.dependencies[dep] = `file:../${dep.replace('@alga-psa/emulator-', '')}`;
    } else if (dep.startsWith('@alga-psa/')) {
      // Bundled at build time (e.g. billing's QBO core) — not a runtime dep.
      delete pkg.dependencies[dep];
    }
  }
  fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
}
fs.writeFileSync(`${stage}/package.json`, JSON.stringify({
  name: 'algasim-image',
  private: true,
  type: 'module',
  dependencies: { '@alga-psa/emulator-suite': 'file:suite' },
}, null, 2) + '\n');
EOF

docker build -t "$TAG" .
echo "Built $TAG"
