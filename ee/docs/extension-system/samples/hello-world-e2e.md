# Hello World Sample Extension — E2E Install

This sample provides a minimal UI-only extension that displays “Hello World” in an iframe. Use it to validate the upload→finalize→list flow against MinIO/S3.

## Files
- Manifest: [ee/extensions/samples/hello-world/manifest.json](ee/extensions/samples/hello-world/manifest.json)
- UI entry: [ee/extensions/samples/hello-world/ui/index.html](ee/extensions/samples/hello-world/ui/index.html)
- UI script: [ee/extensions/samples/hello-world/ui/main.js](ee/extensions/samples/hello-world/ui/main.js)
- App menu: declares `ui.hooks.appMenu.label = "Hello World"` so the sample appears in the host navigation menu once installed.

## A) Install via the Install UI

Prereqs:
- MinIO/S3 env configured (STORAGE_*), and app running.
- Local RBAC bypass for dev: set EXT_BUNDLES_ALLOW_INSECURE=true or use admin header if needed.
- Ensure the enterprise flow is configured per the E2E walkthrough: [e2e-minio-walkthrough.md](ee/docs/extension-system/e2e-minio-walkthrough.md:1)

Steps:
1) Pack the sample into a canonical tar.zst:
   - alga pack ee/extensions/samples/hello-world ./out/hello-world-bundle.tar.zst
   - This computes sha256 and writes a sidecar bundle.sha256 next to the bundle.
2) (Optional) Sign placeholder:
   - alga sign ./out/hello-world-bundle.tar.zst --algorithm cosign
3) Open the Install page:
   - Path: /msp/settings/extensions/install
   - Component for reference: [page.tsx](ee/server/src/app/msp/settings/extensions/install/page.tsx:1)
4) Fill the form:
   - File: select ./out/hello-world-bundle.tar.zst
   - Declared Hash: (optional) paste the SHA-256 from bundle.sha256 (lowercase, 64 hex chars)
   - Content-Type: application/octet-stream
   - Manifest JSON: paste the entire manifest from [manifest.json](ee/extensions/samples/hello-world/manifest.json:1)
   - Signature: optional (if you produced SIGNATURE)
5) Initiate Upload → Upload File → Finalize
   - You should see a success payload { extension, version, contentHash, canonicalKey }.
6) Confirm in S3/MinIO:
   - Objects appear under sha256/<hash>/bundle.tar.zst and sha256/<hash>/manifest.json
7) Verify the extension appears in the Extensions list:
   - /msp/settings/extensions
   - List component: [Extensions.tsx](ee/server/src/components/settings/extensions/Extensions.tsx:1)
8) Open/view the extension (host will load the iframe at the Runner-served URL once installed per environment).

## B) Install via CLI

1) Pack:
   - alga pack ee/extensions/samples/hello-world ./out/hello-world-bundle.tar.zst
2) (Optional) Sign:
   - alga sign ./out/hello-world-bundle.tar.zst --algorithm cosign
3) Publish (requires local admin header env):
   - ALGA_ADMIN_HEADER=true alga publish --bundle ./out/hello-world-bundle.tar.zst --manifest ee/extensions/samples/hello-world/manifest.json
4) Verify output and check the Extensions list.

## Notes
- The Hello World sample is UI-only. The host menu integration references the UI entry declared in the manifest ("ui/index.html").
- For Runner UI serving, the iframe URL must point to `${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{contentHash}/index.html`. The host constructs this automatically for installed extensions per the system design.
- If you enable signature policy (SIGNING_TRUST_BUNDLE), ensure you provide a valid SIGNATURE per your signing method.
