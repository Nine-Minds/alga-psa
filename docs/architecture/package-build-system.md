# Package Build System Architecture

This document describes the hybrid build architecture for `@alga-psa/*` packages, which optimizes build times by pre-compiling library code while maintaining Next.js transpilation for runtime code.

## Overview

The monorepo uses a **hybrid build strategy**:

| Code Type | Build Tool | Output Location | Used By |
|-----------|------------|-----------------|---------|
| Library code (models, lib, services, types) | `tsup` | `packages/<pkg>/dist/` | Pre-compiled JS |
| Runtime code (actions, components, hooks) | Next.js | Transpiled at runtime | HMR, RSC support |

This approach significantly reduces Next.js dev server startup time by avoiding re-transpilation of stable library code on every restart.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Package Structure                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  packages/<package-name>/                                            │
│  ├── src/                                                            │
│  │   ├── index.ts          ─────► Pre-built (tsup) ──► dist/        │
│  │   ├── models/           ─────► Pre-built (tsup) ──► dist/        │
│  │   ├── lib/              ─────► Pre-built (tsup) ──► dist/        │
│  │   ├── services/         ─────► Pre-built (tsup) ──► dist/        │
│  │   │                                                               │
│  │   ├── actions/          ─────► Runtime (Next.js transpiled)      │
│  │   ├── components/       ─────► Runtime (Next.js transpiled)      │
│  │   └── hooks/            ─────► Runtime (Next.js transpiled)      │
│  │                                                                   │
│  ├── dist/                  ◄──── tsup output (ESM + CJS + .d.ts)   │
│  ├── tsup.config.ts                                                  │
│  ├── tsconfig.json                                                   │
│  └── package.json                                                    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Why This Architecture?

### Problem
- Next.js transpilePackages re-compiles all package source code on every dev server restart
- With 20+ internal packages, this added significant startup latency
- Pure library code (types, models, utilities) doesn't need HMR or RSC features

### Solution
- Pre-build stable library code with `tsup` (fast esbuild-based bundler)
- Keep runtime code (React components, server actions) transpiled by Next.js for:
  - Hot Module Replacement (HMR)
  - React Server Components (RSC) support
  - `'use server'` / `'use client'` directives

## Package Configuration

### tsup.config.ts Template

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    // Main entry point - exports library code only
    'index': 'src/index.ts',
    // Additional buildable modules
    'models/index': 'src/models/index.ts',
    'lib/utils': 'src/lib/utils.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  bundle: true,
  splitting: true,
  sourcemap: false,
  clean: true,
  outDir: 'dist',
  external: [
    // Peer dependencies - don't bundle these
    '@alga-psa/db',
    '@alga-psa/auth',
    'react',
    'react-dom',
    'next',
    'zod',
    // Add package-specific externals
  ],
});
```

### package.json Exports Pattern

```json
{
  "name": "@alga-psa/example",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./models": {
      "types": "./dist/models/index.d.ts",
      "import": "./dist/models/index.js",
      "require": "./dist/models/index.cjs"
    },
    "./actions": {
      "types": "./src/actions/index.ts",
      "import": "./src/actions/index.ts"
    },
    "./components": {
      "types": "./src/components/index.ts",
      "import": "./src/components/index.ts"
    }
  }
}
```

**Key points:**
- Pre-built exports point to `./dist/`
- Runtime exports point to `./src/` (Next.js transpiles these)

### project.json (Nx configuration)

```json
{
  "name": "example",
  "targets": {
    "build": {
      "executor": "nx:run-commands",
      "options": {
        "command": "tsup",
        "cwd": "packages/example"
      },
      "outputs": ["{projectRoot}/dist"]
    }
  }
}
```

## next.config.mjs Configuration

The Next.js config must resolve packages correctly:

### Webpack Aliases (for production builds)

```javascript
// Pre-built packages - point to /dist
'@alga-psa/billing': path.join(__dirname, '../packages/billing/dist'),

// Runtime subpaths - point to /src for Next.js transpilation
'@alga-psa/billing/actions': path.join(__dirname, '../packages/billing/src/actions'),
'@alga-psa/billing/components': path.join(__dirname, '../packages/billing/src/components'),
```

### Turbopack Aliases (for dev mode)

```javascript
experimental: {
  turbo: {
    resolveAlias: {
      '@alga-psa/billing': '../packages/billing/dist',
      '@alga-psa/billing/actions': '../packages/billing/src/actions',
      '@alga-psa/billing/components': '../packages/billing/src/components',
    }
  }
}
```

### transpilePackages

Only include packages that need Next.js transpilation:

```javascript
transpilePackages: [
  // External packages
  '@blocknote/core',
  '@blocknote/react',
  // Runtime-only internal packages (no pre-build)
  '@product/extensions',
  // Aliasing packages
  '@alga-psa/product-extension-actions',
]
```

**Do NOT include** pre-built `@alga-psa/*` packages - they're already compiled.

## Import Patterns

### Correct Usage

```typescript
// Library imports - resolved from dist/
import { BillingPlan } from '@alga-psa/billing';
import { Invoice } from '@alga-psa/billing/models';

// Runtime imports - resolved from src/ (Next.js transpiled)
import { createInvoice } from '@alga-psa/billing/actions';
import { InvoiceTable } from '@alga-psa/billing/components';
```

### Common Mistakes

```typescript
// WRONG: Importing runtime code from main entry
import { createInvoice } from '@alga-psa/billing'; // Will fail - not in dist/

// CORRECT: Use explicit subpath
import { createInvoice } from '@alga-psa/billing/actions';
```

## Building Packages

### Build All Packages

```bash
npm run build:shared
# or
npx nx run-many --target=build --all
```

### Build Single Package

```bash
npx nx build billing
# or
cd packages/billing && npx tsup
```

### Watch Mode (Development)

```bash
cd packages/billing && npx tsup --watch
```

## Adding a New Package

1. **Create package structure:**
   ```
   packages/new-package/
   ├── src/
   │   ├── index.ts         # Library exports
   │   ├── models/          # Pre-built
   │   ├── lib/             # Pre-built
   │   ├── actions/         # Runtime (Next.js)
   │   └── components/      # Runtime (Next.js)
   ├── tsup.config.ts
   ├── tsconfig.json
   ├── package.json
   └── project.json
   ```

2. **Configure tsup.config.ts** (see template above)

3. **Configure package.json exports** with dual dist/src paths

4. **Add aliases to next.config.mjs:**
   - Turbopack aliases in `experimental.turbo.resolveAlias`
   - Webpack aliases in `webpack.resolve.alias`

5. **Build the package:**
   ```bash
   npx nx build new-package
   ```

## Troubleshooting

### "Module not found" errors

1. Check that the package is built: `ls packages/<name>/dist/`
2. Verify next.config.mjs aliases are correct
3. Ensure package.json exports match the import path

### Type errors after build

1. Rebuild with `npx nx build <package>`
2. Check that `dts: true` is set in tsup.config.ts
3. Verify tsconfig.json paths are correct

### Runtime code not updating (HMR not working)

1. Ensure runtime code imports use `/actions`, `/components`, `/hooks` subpaths
2. Verify those subpaths point to `/src` in package.json exports
3. Check next.config.mjs aliases for runtime subpaths

### "Cannot use import statement outside a module"

1. Ensure package.json has `"type": "module"`
2. Check that tsup outputs both ESM (`.js`) and CJS (`.cjs`)

## Package Classification

### Pre-built Packages (tsup)

These packages have `tsup.config.ts` and output to `dist/`:

| Package | Library Exports | Runtime Subpaths |
|---------|-----------------|------------------|
| @alga-psa/analytics | events, config, lib | - |
| @alga-psa/assets | models | actions, components |
| @alga-psa/auth | lib, providers | actions |
| @alga-psa/billing | models, lib, services | actions, components |
| @alga-psa/client-portal | lib | actions, components |
| @alga-psa/clients | models, lib | actions, components, hooks |
| @alga-psa/documents | lib, handlers | actions, components |
| @alga-psa/email | lib, services | actions |
| @alga-psa/event-bus | - | - |
| @alga-psa/event-schemas | - | - |
| @alga-psa/integrations | lib, services | actions, components |
| @alga-psa/jobs | lib | components |
| @alga-psa/licensing | - | - |
| @alga-psa/notifications | lib | actions, components |
| @alga-psa/onboarding | lib | components |
| @alga-psa/projects | models, lib | actions, components |
| @alga-psa/reference-data | - | - |
| @alga-psa/reporting | lib | actions |
| @alga-psa/scheduling | models, lib | actions, components |
| @alga-psa/surveys | lib | actions, components |
| @alga-psa/tags | lib | actions, components |
| @alga-psa/teams | lib | actions, components |
| @alga-psa/tenancy | lib | actions |
| @alga-psa/tickets | models, lib | actions, components |
| @alga-psa/users | models, services | actions, components |
| @alga-psa/workflows | lib, ee, oss | actions, components, hooks |

### Source-only Packages (Next.js transpiled)

These packages are fully transpiled by Next.js:

- `@alga-psa/ui` - React component library (needs full HMR)
- `@alga-psa/db` - Database utilities (kept in source for HMR in dev)
- `@product/*` - Product feature packages

## Related Documentation

- [Nx Build System](https://nx.dev/)
- [tsup Documentation](https://tsup.egoist.dev/)
- [Next.js transpilePackages](https://nextjs.org/docs/app/api-reference/next-config-js/transpilePackages)
