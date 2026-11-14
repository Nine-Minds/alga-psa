# UniFi: multiple API keys per integration

You can now connect more than one API key to the UniFi integration. This lets AlgaPSA
reach consoles that sit inside a UniFi fabric. A key created under Independent can list
those consoles but cannot reach them. A key created under a fabric reaches that fabric.

Add one key per fabric in **Settings → Integrations → RMM → UniFi**. Each key has a label,
and the page shows which consoles each key reaches. If a console is visible but no key
reaches it, the page tells you to add a key created under that fabric.

Existing connections keep working. Your current key becomes a key labelled `Default`, and
your mapped sites, assets and alerts stay as they are.

Changing the controller URL or connection type of a saved key now requires a new key. A
stored key is sent only to the address it was saved with.

Thanks to Ryan at Tom's Help Desk for finding and diagnosing the fabric API key limitation.

See [UniFi Integration (Admin Guide)](../integrations/unifi.md).
