#!/bin/bash

# Enterprise Edition Build Script
# Historically this script overlaid EE-only files into the OSS `server/` tree.
#
# We no longer do that for routing/components:
# - Next.js App Router routes live in `server/src/app/**` for both CE and EE.
# - EE-only functionality is loaded via `@ee/*` and `@product/*` aliases (see `server/next.config.mjs`).
#
# Keep this script as a stable entrypoint for build pipelines (Dockerfiles, etc.),
# but avoid mutating the worktree.

set -e

echo "🏢 Building Enterprise Edition..."

# Check if we're building enterprise edition
if [ "$NEXT_PUBLIC_EDITION" != "enterprise" ]; then
    echo "ℹ️  Not building enterprise edition (NEXT_PUBLIC_EDITION=$NEXT_PUBLIC_EDITION)"
    exit 0
fi

echo "ℹ️  No filesystem overlay required (EE code resolved via aliases)."

echo "✅ Enterprise Edition build complete!"
