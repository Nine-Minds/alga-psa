# Building Enterprise Edition

This project uses a monorepo structure to integrate the enterprise edition (EE) code with the community edition (CE) code while maintaining them as a single unit.

## Project Structure

```
/
├── package.json          # Root package.json with all dependencies
├── docker-compose.yaml   # Base docker-compose configuration
├── server/              # Community Edition
│   ├── package.json     # CE package.json (minimal, uses workspace)
│   ├── tsconfig.json    # Base TypeScript config
│   └── src/
│       ├── components/
│       ├── lib/
│       └── services/
└── ee/
    └── server/          # Enterprise Edition
        ├── package.json # EE package.json (minimal, uses workspace)
        ├── tsconfig.json# EE TypeScript config (extends base)
        └── src/
            ├── components/
            ├── lib/
            └── services/
```

## Docker Compose Configuration

The project uses a layered docker-compose configuration to support both CE and EE deployments:

1. **Base Configuration** (`docker-compose.yaml`):
   - Contains common service definitions
   - Defines shared environment variables including EDITION
   - Sets up base networking

2. **EE Configuration** (`ee/setup/docker-compose.yaml`):
   - Extends services from base configuration
   - Sets EDITION=enterprise
   - Uses EE-specific Dockerfile and configurations

### Running CE Version
```bash
# From project root
EDITION=community docker compose -f docker-compose.yaml up
```

### Running EE Version
```bash
# From project root
EDITION=enterprise docker compose -f docker-compose.yaml -f ee/setup/docker-compose.yaml up
```

## Workspace Setup

1. Root `package.json` defines workspaces and contains all dependencies:
```json
{
  "workspaces": [
    "server",
    "ee/server"
  ],
  "dependencies": {
    // All project dependencies are defined here
  }
}
```

2. CE and EE `package.json` files are minimal:
```json
{
  "name": "sebastian-ee",
  "version": "0.1.0",
  "private": true,
  "workspaces": {
    "nohoist": ["*"]
  }
}
```

## TypeScript Configuration

1. Base TypeScript config in `server/tsconfig.json`:
```json
{
  "compilerOptions": {
  }
}
```

2. EE TypeScript config in `ee/server/tsconfig.json` extends the base:
```json
{
  "extends": "../../server/tsconfig.json",
  "compilerOptions": {
    "paths": {
      "@/*": ["../../server/src/*"],
      "@ee/*": ["./src/*"]
    },
    "baseUrl": "."
  }
}
```

## Path Aliases

Use path aliases instead of relative paths:
- `@/*` for CE imports
- `@ee/*` for EE imports

Example:
```typescript
// Instead of relative paths like:
import { Something } from "../../../../../server/src/components/Something";

// Use path aliases:
import { Something } from "server/src/components/Something";
import { EEFeature } from "ee/components/EEFeature";
```

## Feature Flags

Use feature flags to conditionally include EE features:

```typescript
// server/src/lib/features.ts
export const isEnterprise = process.env.EDITION === 'enterprise';

export function getFeatureImplementation<T>(ceModule: T, eeModule?: T): T {
  if (isEnterprise && eeModule) {
    return eeModule;
  }
  return ceModule;
}
```

Usage:
```typescript
import { CEFeature } from "features/CEFeature";
import { EEFeature } from "ee/features/EEFeature";
import { getFeatureImplementation } from "server/src/lib/features";

const FeatureComponent = getFeatureImplementation(CEFeature, EEFeature);
```

## Conditional Dependencies

Some packages may only be needed when running in enterprise mode. To handle these cases:

1. Install the package conditionally in your code:
```typescript
let anthropicClient;
if (process.env.EDITION === 'enterprise') {
  // Dynamic import ensures the package is only loaded if EE is active
  const { default: Anthropic } = await import('anthropic-sdk');
  anthropicClient = new Anthropic();
}
```

2. Add the package to your dependencies in root package.json:
```json
{
  "dependencies": {
    "anthropic-sdk": "^0.1.0"  // Will only be used when EE is active
  }
}
```

This approach ensures that:
- The package is available when needed in EE mode
- The package is not loaded or used in CE mode
- TypeScript still has access to types for development

## Type Declarations

For TypeScript support of EE imports:

```typescript
// server/src/types/ee.d.ts
declare module '@ee/*' {
  const content: unknown;
  export default content;
}
```

## Build Scripts

The build scripts are defined in the root `package.json`:

```json
{
  "scripts": {
    "dev": "cd server && EDITION=enterprise next dev",
    "build": "cd server && next build",
    "build:ee": "cd server && EDITION=enterprise next build"
  }
}
```

## Best Practices

1. **Dependencies**: 
   - Keep all dependencies in the root `package.json`
   - Use workspace references in CE and EE packages
   - Use dynamic imports for EE-only packages

2. **Code Organization**:
   - Keep shared code in the CE codebase
   - Use path aliases consistently
   - Mirror CE directory structure in EE when extending features

3. **Types**:
   - Define shared interfaces in CE
   - Extend CE types in EE when needed
   - Use TypeScript path aliases for clean imports

4. **Feature Flags**:
   - Use the feature flag system for EE features
   - Document feature flag usage
   - Test both CE and EE configurations

5. **Testing**:
   - Test both editions during development
   - Use environment variables to control edition in tests
   - Ensure CE works independently of EE

## Development Workflow

1. Run the development server:
```bash
npm run dev  # Runs with EE features enabled
```

2. Build the project:
```bash
npm run build      # CE build
npm run build:ee   # EE build
```

3. Run with Docker Compose:
```bash
# Community Edition
EDITION=community docker compose -f docker-compose.yaml up

# Enterprise Edition
EDITION=enterprise docker compose -f docker-compose.yaml -f ee/setup/docker-compose.yaml up
```

Remember to:
- Document new EE features
- Test both CE and EE builds
- Keep the dependency tree unified
- Use TypeScript path aliases consistently
- Follow the established directory structure
