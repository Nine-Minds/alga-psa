# Enterprise Build Workflow Guide

This guide explains the enterprise edition build process for Alga PSA extensions, including the proper workflow for developing and deploying enterprise features.

## Overview

The Alga PSA extension system uses a one-way build process where Enterprise Edition (EE) files serve as the source of truth and are copied to the main server during builds. Understanding this workflow is crucial for proper development and avoiding overwrites.

## Build Architecture

### Directory Structure

```
alga-psa/
├── ee/server/src/                    # 🎯 SOURCE (Enterprise Edition)
│   ├── lib/extensions/
│   ├── app/msp/extensions/
│   └── lib/actions/extension-actions/
├── server/src/                       # 📦 TARGET (Main Server)
│   ├── lib/extensions/               # ← Copied from EE
│   ├── app/msp/extensions/          # ← Copied from EE
│   └── lib/actions/extension-actions/ # ← Copied from EE
└── scripts/
    └── build-enterprise.sh          # 🔧 Build Script
```

### Build Flow

```
EE Source Files → Build Script → Main Server Files → Application
     ↓               ↓              ↓               ↓
   Edit Here     Copies Files    Never Edit     Runtime
```

## Enterprise Build Script

### Script Location

The build script is located at:
```
/scripts/build-enterprise.sh
```

### Script Function

The script performs these operations:

1. **Environment Check**: Verifies `NEXT_PUBLIC_EDITION=enterprise`
2. **Directory Creation**: Creates target directories in main server
3. **File Copying**: Copies EE files to main server locations
4. **Validation**: Ensures all required files are copied

### File Mapping

| EE Source | Main Server Target | Purpose |
|-----------|-------------------|---------|
| `ee/server/src/app/msp/extensions/` | `server/src/app/msp/extensions/` | Extension routes and pages |
| `ee/server/src/lib/extensions/` | `server/src/lib/extensions/` | Extension libraries and UI components |
| `ee/server/src/lib/actions/extension-actions/` | `server/src/lib/actions/extension-actions/` | Server actions for extension operations |

## Proper Development Workflow

### ✅ Correct Workflow

1. **Edit EE Source Files**:
   ```bash
   # Edit files in ee/server/src/
   vim ee/server/src/lib/extensions/ui/DescriptorRenderer.tsx
   ```

2. **Run Enterprise Build**:
   ```bash
   NEXT_PUBLIC_EDITION=enterprise ./scripts/build-enterprise.sh
   ```

3. **Test Changes**:
   ```bash
   # Changes are now live in main server
   # Test your extension functionality
   ```

### ❌ Incorrect Workflow (Will Cause Overwrites)

```bash
# DON'T DO THIS - Files will be overwritten
vim server/src/lib/extensions/ui/DescriptorRenderer.tsx

# Later when enterprise build runs:
NEXT_PUBLIC_EDITION=enterprise ./scripts/build-enterprise.sh
# ↑ This overwrites your changes!
```

## Build Commands

### Manual Build

Run the enterprise build script directly:

```bash
cd /home/coder/alga-psa
NEXT_PUBLIC_EDITION=enterprise ./scripts/build-enterprise.sh
```

### Build with Application

The enterprise build is integrated into the main build process:

```bash
cd /home/coder/alga-psa/server
NEXT_PUBLIC_EDITION=enterprise npm run build
```

This runs:
1. Enterprise build script (copies EE files)
2. Next.js build process (builds the application)

### Development Mode

For development, you typically only need the enterprise build:

```bash
# Just copy EE files without full build
NEXT_PUBLIC_EDITION=enterprise ./scripts/build-enterprise.sh
```

## Script Output

### Successful Build

```
🏢 Building Enterprise Edition...
📁 Copying EE extension files to main server...
   📄 Copying extension routes...
   ✅ Extension routes copied
   📚 Copying extension libraries...
   ✅ Extension libraries copied
   🎬 Copying extension actions...
   ✅ Extension actions copied
✅ Enterprise Edition build complete!
🚀 Extension system ready for deployment

📝 Note: Files now use @shared imports for clean cross-hierarchy compatibility
```

### Build Skipped (Wrong Environment)

```
🏢 Building Enterprise Edition...
ℹ️  Not building enterprise edition (NEXT_PUBLIC_EDITION=)
```

## Environment Variables

### Required Variables

- `NEXT_PUBLIC_EDITION=enterprise` - Enables enterprise build

### Setting Environment Variable

```bash
# For single command
NEXT_PUBLIC_EDITION=enterprise ./scripts/build-enterprise.sh

# For session
export NEXT_PUBLIC_EDITION=enterprise
./scripts/build-enterprise.sh

# In package.json script
"build:enterprise": "NEXT_PUBLIC_EDITION=enterprise ./scripts/build-enterprise.sh"
```

## Common Issues and Solutions

### Issue 1: Changes Not Appearing

**Problem**: Made changes but don't see them in the application.

**Solution**: 
1. Verify you edited EE source files (not main server files)
2. Run enterprise build script
3. Check console output for successful copy

### Issue 2: Files Being Overwritten

**Problem**: Changes keep disappearing after builds.

**Root Cause**: Editing main server files instead of EE source files.

**Solution**:
1. Copy your changes from main server to EE source
2. Always edit EE source files going forward
3. Run enterprise build to deploy

### Issue 3: Build Script Not Running

**Problem**: Build script exits without copying files.

**Common Causes**:
- Missing `NEXT_PUBLIC_EDITION=enterprise` environment variable
- Permissions issue with script execution
- Missing source directories

**Solution**:
```bash
# Ensure environment variable is set
echo $NEXT_PUBLIC_EDITION

# Make script executable
chmod +x ./scripts/build-enterprise.sh

# Check if EE directories exist
ls -la ee/server/src/lib/extensions/
```

### Issue 4: Import Path Issues

**Problem**: Import errors after copying files.

**Cause**: Path differences between EE and main server structure.

**Solution**: Use relative imports or @shared imports:

```typescript
// Good - relative import
import { ComponentRegistry } from './ComponentRegistry';

// Good - @shared import  
import { logger } from '@shared/core/logger';

// Avoid - absolute paths that may not exist
import { DataTable } from 'server/src/components/ui/DataTable';
```

## File Ownership

### EE-Only Files

These files should ONLY exist in EE and be copied:

- `lib/extensions/ui/DescriptorRenderer.tsx`
- `lib/extensions/ui/descriptors/ComponentRegistry.ts`
- `app/msp/extensions/[extensionId]/[...path]/page.tsx`
- `lib/actions/extension-actions/extensionActions.ts`

### Shared Files

These files may exist in both EE and main server:

- `app/api/extensions/[extensionId]/*/route.ts` (API routes)
- Utility functions and types

## Best Practices

### 1. Always Edit EE Source

Make this your default workflow:
```bash
# Navigate to EE source
cd ee/server/src/lib/extensions/

# Edit files here
vim ui/DescriptorRenderer.tsx

# Deploy changes
cd ../../../..
NEXT_PUBLIC_EDITION=enterprise ./scripts/build-enterprise.sh
```

### 2. Verify Build Success

Always check the build output:
```
✅ Extension routes copied
✅ Extension libraries copied  
✅ Extension actions copied
```

### 3. Use Git to Track Changes

Monitor which files are being modified:
```bash
# Before editing
git status

# After enterprise build
git status  # Should show modified files in server/src/
```

### 4. Regular Builds

Run enterprise build frequently during development:
```bash
# Create an alias for convenience
alias ee-build='NEXT_PUBLIC_EDITION=enterprise ./scripts/build-enterprise.sh'

# Use it regularly
ee-build
```

## Integration with CI/CD

### Build Pipeline

```yaml
# Example GitHub Actions
- name: Build Enterprise Edition
  run: |
    NEXT_PUBLIC_EDITION=enterprise ./scripts/build-enterprise.sh
    
- name: Build Application
  run: |
    cd server
    NEXT_PUBLIC_EDITION=enterprise npm run build
```

### Environment Configuration

```bash
# Production deployment
export NEXT_PUBLIC_EDITION=enterprise
```

## Troubleshooting Build Issues

### Debug Build Process

1. **Check Environment**:
   ```bash
   echo "NEXT_PUBLIC_EDITION: $NEXT_PUBLIC_EDITION"
   ```

2. **Verify Source Files**:
   ```bash
   ls -la ee/server/src/lib/extensions/
   ```

3. **Check Permissions**:
   ```bash
   ls -la scripts/build-enterprise.sh
   ```

4. **Manual Copy Test**:
   ```bash
   cp -r ee/server/src/lib/extensions/* server/src/lib/extensions/
   ```

### Clean Build

If builds are inconsistent, clean and rebuild:

```bash
# Remove copied files
rm -rf server/src/lib/extensions/
rm -rf server/src/app/msp/extensions/
rm -rf server/src/lib/actions/extension-actions/

# Run fresh build
NEXT_PUBLIC_EDITION=enterprise ./scripts/build-enterprise.sh
```

This enterprise build workflow ensures that:
- EE features remain properly isolated
- Changes are tracked in the correct source files  
- Builds are reproducible and consistent
- No work is accidentally lost to overwrites