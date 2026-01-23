#!/bin/bash

# Enterprise Edition Build Script
# Copies EE-licensed extension files to main server during build

set -e

echo "🏢 Building Enterprise Edition..."

# Check if we're building enterprise edition
if [ "$NEXT_PUBLIC_EDITION" != "enterprise" ]; then
    echo "ℹ️  Not building enterprise edition (NEXT_PUBLIC_EDITION=$NEXT_PUBLIC_EDITION)"
    exit 0
fi

echo "📁 Copying EE extension files to main server..."

# Create directories in main server if they don't exist
mkdir -p server/src/app/msp/extensions
mkdir -p server/src/app/msp
mkdir -p server/src/lib/extensions
mkdir -p server/src/lib/actions/extension-actions

# Copy EE MSP app routes/layouts (filesystem routing requires these live under server/src/app)
if [ -d "ee/server/src/app/msp" ]; then
    echo "   🧭 Copying MSP app routes/layouts..."
    cp -r ee/server/src/app/msp/* server/src/app/msp/
    echo "   ✅ MSP app routes/layouts copied"
fi

# Copy EE extension routes
if [ -d "ee/server/src/app/msp/extensions" ]; then
    echo "   📄 Copying extension routes..."
    cp -r ee/server/src/app/msp/extensions/* server/src/app/msp/extensions/
    echo "   ✅ Extension routes copied"
fi

# Copy EE extension libraries
if [ -d "ee/server/src/lib/extensions" ]; then
    echo "   📚 Copying extension libraries..."
    cp -r ee/server/src/lib/extensions/* server/src/lib/extensions/
    echo "   ✅ Extension libraries copied"
fi

# Copy EE extension actions
if [ -d "ee/server/src/lib/actions/extension-actions" ]; then
    echo "   🎬 Copying extension actions..."
    cp -r ee/server/src/lib/actions/extension-actions/* server/src/lib/actions/extension-actions/
    echo "   ✅ Extension actions copied"
fi

echo "✅ Enterprise Edition build complete!"
echo "🚀 Extension system ready for deployment"
echo ""
echo "📝 Note: Files now use @shared imports for clean cross-hierarchy compatibility"
