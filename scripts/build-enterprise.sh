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
mkdir -p server/src/app/api/extensions
mkdir -p server/src/lib/extensions
mkdir -p server/src/lib/actions
mkdir -p server/src/lib/actions/extension-actions

# Copy EE extension routes
if [ -d "ee/server/src/app/msp/extensions" ]; then
    echo "   📄 Copying extension routes..."
    cp -r ee/server/src/app/msp/extensions/* server/src/app/msp/extensions/
    echo "   ✅ Extension routes copied"
fi

# Copy EE API routes
if [ -d "ee/server/src/app/api/extensions" ]; then
    echo "   🌐 Copying extension API routes..."
    cp -r ee/server/src/app/api/extensions/* server/src/app/api/extensions/
    echo "   ✅ Extension API routes copied"
fi

# Copy EE extension libraries
if [ -d "ee/server/src/lib/extensions" ]; then
    echo "   📚 Copying extension libraries..."
    cp -r ee/server/src/lib/extensions/* server/src/lib/extensions/
    echo "   ✅ Extension libraries copied"
fi

# Copy EE extension actions
if [ -d "ee/server/src/lib/actions" ]; then
    echo "   🎬 Copying extension actions..."
    # Copy direct action files (like extensionDomainActions.ts)
    cp ee/server/src/lib/actions/*.ts server/src/lib/actions/ 2>/dev/null || true
    # Copy extension-actions subdirectory if it exists
    if [ -d "ee/server/src/lib/actions/extension-actions" ]; then
        cp -r ee/server/src/lib/actions/extension-actions/* server/src/lib/actions/extension-actions/
    fi
    echo "   ✅ Extension actions copied"
fi

# Copy EE MSP layout if it doesn't exist in main server
if [ -f "ee/server/src/app/msp/layout.tsx" ] && [ ! -f "server/src/app/msp/layout.tsx" ]; then
    echo "   🎨 Copying MSP layout..."
    cp ee/server/src/app/msp/layout.tsx server/src/app/msp/layout.tsx
    echo "   ✅ MSP layout copied"
fi


echo "✅ Enterprise Edition build complete!"
echo "🚀 Extension system ready for deployment"
echo ""
echo "📝 Note: Files now use @shared imports for clean cross-hierarchy compatibility"