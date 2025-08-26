# Example Integration (ext-v2)

Legacy descriptor-era examples (Tab slots, Navigation/Page registries, descriptor JSON mappings) have been removed. The extension UI is now served exclusively by the Runner via an iframe, and host-to-extension calls go through the Gateway.

Use this as a reference note only; there is no host-side wiring code in v2.

Key v2 pointers:
- UI: ${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]
- API: /api/ext/[extensionId]/[...] (Gateway → Runner /v1/execute)

Do not use:
- Host-side renderers such as DescriptorRenderer/ExtensionRenderer or any ui/descriptors/pages/tabs/navigation
- /api/extensions/* routes
- Any Next.js ext-ui route

See ee/server/src/lib/extensions/README.md for details.