# Microsoft Graph endpoint reality guard

`endpoints.json` is the source of truth for Microsoft Graph calls made by Alga
and routes served by its Graph emulators. `validate-endpoints.mjs` checks that:

1. each registered path resolves against Microsoft's pinned v1.0 or beta CSDL;
2. statically discoverable Graph calls in production source are registered; and
3. every Graph route in the packaged and legacy test-harness emulators is registered.

Run `npm run guard:microsoft-graph-endpoints`. The check is offline and has no
package dependencies. Metadata is pinned to the commit recorded in
`endpoints.json`; update both gzip files and the commit together when bumping it.

Current compressed-file SHA-256 checksums:

- `v1.0.xml.gz`: `6fb2e1b8f2f1669eada0265833af30d22510e3c4ca482cad98b0ee46e3c71e22`
- `beta.xml.gz`: `1e1705bc8bbf4a6074ea35bf8b214a4836e0b816070b4f4de112dcba1a713252`

The validator deliberately checks API existence and version placement, not
permissions, filterability, throttling, or runtime response behavior.
