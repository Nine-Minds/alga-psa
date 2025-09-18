# Alga PSA SDK Workspace

This `sdk/` workspace collects all developer-facing tooling, client artifacts, and runnable examples that support the Alga PSA APIs. It acts as an umbrella for multiple packages—each with its own `package.json`—alongside shared docs and samples.

## Repository Layout

```
sdk/
  README.md                 # You are here
  package.json              # Scripts and deps for shared docs/samples
  tsconfig.json             # TypeScript config for shared tooling
  docs/                     # Conceptual + reference documentation source
  samples/                  # Standalone usage examples (Node, Postman, etc.)
  scripts/                  # Utility scripts (e.g., OpenAPI generation)
  alga-client-sdk/          # Browser/client library (managed independently)
  alga-cli/                 # Command-line tooling package
  extension-iframe-sdk/     # IFrame helper SDK for extensions
```

Each subpackage remains independent—run installs/tests within the respective directory. The root `package.json` is marked `private` and exists purely to support documentation, samples, and shared tooling.

## Working With Shared Docs & Samples

1. Install dependencies in this directory:
   ```bash
   cd sdk
   npm install
   ```
2. Set required environment variables before running a sample (see script comments).
3. Execute a sample script, for example:
   ```bash
   npm run sample:create-service-category -- "Onboarding"
   ```
4. Generate the latest OpenAPI spec:
   ```bash
   npm run openapi:generate
   ```
   The JSON and YAML outputs land in `docs/openapi/` for documentation sites or client generation.

You can safely add more scripts under `samples/` or automation under `scripts/` without affecting the sibling SDK packages.

## Subpackage Workflow

For `alga-client-sdk`, `alga-cli`, or `extension-iframe-sdk`, continue managing dependencies and build steps from their own folders. Optional next step is to introduce a monorepo workspace (npm/pnpm) if you want unified dependency installs, but it is not required for the current layout.

## Next Steps

- Populate `docs/` with detailed guides and OpenAPI references as they become available.
- Expand `samples/` to cover additional endpoints and languages.
- Add `scripts/` automation (e.g., `generate-openapi.ts`) to keep documentation in sync with the codebase.
