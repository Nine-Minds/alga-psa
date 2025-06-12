#!/bin/bash
# SoftwareOne Extension Installation Script
# This script helps install the SoftwareOne extension into Alga PSA

set -e

echo "========================================="
echo "SoftwareOne Extension Installation Script"
echo "========================================="

# Check if we're in the right directory
if [ ! -f "alga-extension.json" ]; then
    echo "Error: alga-extension.json not found. Please run this script from the extension directory."
    exit 1
fi

# Build the extension
echo ""
echo "1. Building the extension..."
npm install
npm run build

if [ ! -d "dist" ]; then
    echo "Error: Build failed. No dist directory found."
    exit 1
fi

echo "✓ Build completed successfully"

# Package the extension
echo ""
echo "2. Packaging the extension..."
EXTENSION_NAME="com.alga.softwareone-0.1.0.algaext"
zip -r "$EXTENSION_NAME" alga-extension.json dist/ src/ package.json README.md

echo "✓ Extension packaged as $EXTENSION_NAME"

# Provide installation instructions
echo ""
echo "3. Manual Installation Steps:"
echo "============================="
echo ""
echo "Since the Extension CLI is not yet available, you'll need to manually register the extension:"
echo ""
echo "a) Copy the extension files to your Alga PSA installation:"
echo "   cp -r . /path/to/alga-psa/extensions/softwareone-ext/"
echo ""
echo "b) Connect to your PostgreSQL database and run:"
echo ""
cat << 'EOF'
-- Insert the extension registration
INSERT INTO extension_registry (
    id,
    name,
    version,
    manifest,
    status,
    tenant_id,
    created_at,
    updated_at
) VALUES (
    'com.alga.softwareone',
    'SoftwareOne Integration',
    '0.1.0',
    '${MANIFEST_JSON}',  -- Copy content from alga-extension.json
    'active',
    '${YOUR_TENANT_ID}', -- Replace with your tenant ID
    NOW(),
    NOW()
);

-- Grant permissions to the extension
INSERT INTO extension_permissions (
    extension_id,
    permission,
    tenant_id
) VALUES 
    ('com.alga.softwareone', 'companies:read', '${YOUR_TENANT_ID}'),
    ('com.alga.softwareone', 'invoices:write', '${YOUR_TENANT_ID}'),
    ('com.alga.softwareone', 'settings:read', '${YOUR_TENANT_ID}'),
    ('com.alga.softwareone', 'settings:write', '${YOUR_TENANT_ID}'),
    ('com.alga.softwareone', 'storage:read', '${YOUR_TENANT_ID}'),
    ('com.alga.softwareone', 'storage:write', '${YOUR_TENANT_ID}');
EOF

echo ""
echo "c) Restart your Alga PSA server to load the extension"
echo ""
echo "d) Navigate to Settings > SoftwareOne to configure the extension"
echo ""
echo "========================================="
echo "Installation preparation complete!"
echo "========================================="