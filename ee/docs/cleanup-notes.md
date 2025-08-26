# EE Cleanup Notes

- CE build does not import or execute legacy `ee/server/src/lib/extensions/initialize` unless `NEXT_PUBLIC_EDITION=enterprise`.
- No filesystem scanning of `./extensions` is present in this workspace; CE UI paths that referenced EE dynamic components remain gated by edition.
- Host-side descriptor rendering is planned for removal in EE; CE uses iframe-only scaffolding added in this overhaul.

