Alga Client SDK
===============

CLI and programmatic tools for building, packing, signing, and publishing Alga extensions.

Install (local dev)
-------------------
- From monorepo root:
  - Build: `npm run build:sdk`
  - Link globally (dev): `npm -w sdk/alga-client-sdk link`
  - Use: `alga --help`

- From the package folder:
  - Build: `npm run build`
  - Use without link: `node dist/src/cli.js --help`

CLI
---
- create-new-project [dir] --name <pkg>
- create-ui-project [dir] --name <pkg>
- pack <inputDir> <outputPath> [--force]
- pack-project --project <path> --out <bundle> [--force]
- publish --bundle <path> --manifest <path> [--server <url>] [--declared-hash <sha>] [--signature <path>] [--signature-algorithm <algo>]
- sign <bundlePath> --algorithm cosign|x509|pgp

Node Support
------------
- Requires Node.js >= 18. Windows support is best-effort.
