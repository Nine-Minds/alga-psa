#!/usr/bin/env bash
# Merge CE and EE migrations/seeds for dev environment
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

MIGRATIONS_TARGET="/tmp/alga-migrations"
SEEDS_TARGET="/tmp/alga-seeds"

echo "Merging CE and EE migrations and seeds..."

# Clean and create target directories
rm -rf "$MIGRATIONS_TARGET" "$SEEDS_TARGET"
mkdir -p "$MIGRATIONS_TARGET" "$SEEDS_TARGET"

# Merge migrations: CE first, then EE overwrites
if [ -d "$REPO_ROOT/server/migrations" ]; then
    echo "Copying CE migrations..."
    cp -r "$REPO_ROOT/server/migrations/"* "$MIGRATIONS_TARGET/" 2>/dev/null || true
fi

if [ -d "$REPO_ROOT/ee/server/migrations" ]; then
    echo "Overlaying EE migrations..."
    cp -r "$REPO_ROOT/ee/server/migrations/"* "$MIGRATIONS_TARGET/" 2>/dev/null || true
fi

# Merge seeds: CE first, then EE overwrites
if [ -d "$REPO_ROOT/server/seeds" ]; then
    echo "Copying CE seeds..."
    cp -r "$REPO_ROOT/server/seeds/"* "$SEEDS_TARGET/" 2>/dev/null || true
fi

if [ -d "$REPO_ROOT/ee/server/seeds" ]; then
    echo "Overlaying EE seeds..."
    cp -r "$REPO_ROOT/ee/server/seeds/"* "$SEEDS_TARGET/" 2>/dev/null || true
fi

echo "✓ Merged $(find "$MIGRATIONS_TARGET" -type f | wc -l | tr -d ' ') migration files"
echo "✓ Merged $(find "$SEEDS_TARGET" -type f | wc -l | tr -d ' ') seed files"
echo "Migrations: $MIGRATIONS_TARGET"
echo "Seeds: $SEEDS_TARGET"
