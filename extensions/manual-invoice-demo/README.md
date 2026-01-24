# Manual Invoice Demo (Extension)

This sample extension demonstrates creating a **draft manual invoice** via the extension host API (`cap:invoice.manual.create`).

## Build

```bash
cd extensions/manual-invoice-demo/component
npm ci
npm run build

# Copy built artifacts to extension root (required for packing/publishing)
rsync -a dist/ ../dist/
```

## Publish + Install (local dev)

```bash
node sdk/alga-cli/src/cli.ts extension publish ./extensions/manual-invoice-demo \
  --base-url http://localhost:3000 \
  --api-key $TENANT_ADMIN_KEY \
  --tenant $TENANT_ID
```

