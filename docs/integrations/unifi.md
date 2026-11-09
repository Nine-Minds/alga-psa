# UniFi Integration (Admin Guide)

AlgaPSA connects to UniFi Site Manager or to a local UniFi Network controller. It syncs
your sites as mappings to clients, brings adopted gateways, switches and access points in
as assets, and raises offline-device alerts. You can connect more than one API key to the
same integration.

Thanks to Ryan at Tom's Help Desk for finding and diagnosing the fabric API key
limitation that this guide's "Fabric keys" section describes.

## Which key reaches which console

A UniFi API key only reaches the consoles in the place where it was created.

- **A key created under Independent** lists every console on your account. It can only
  reach the consoles that are not part of a fabric. For a console inside a fabric, UniFi
  answers 403.
- **A key created under a fabric** lists and reaches only the consoles in that fabric.
- **A local controller key** reaches the one controller whose URL you enter.

If you have consoles in more than one place, add one key for each.

## Create a key in Site Manager

1. Open UniFi Site Manager.
2. For a fabric, select that fabric first. For independent consoles, stay under Independent.
3. Open **API** and create a key. Copy it when UniFi shows it. UniFi does not show it again.

## Connect

Go to **Settings → Integrations → RMM → UniFi**.

1. Paste the key. Choose **Site Manager (cloud)** or **Local controller**. For a local
   controller, also enter the controller URL.
2. Give the key a label, such as the name of the fabric. The first key is labelled
   `Default` if you leave the label empty.
3. Select **Add key**. AlgaPSA checks the key with UniFi before it saves it.

To cover another fabric, select **Add key** again and repeat.

## Keys list

The list shows each key's label, type, status, the consoles it reaches, its last error and
when AlgaPSA last used it. You can add a key, replace a key, rename it, or remove it.
AlgaPSA never shows a stored key again.

- **Replace key** checks the new key before it replaces the stored one. If you change the
  controller URL or the connection type, you must enter a new key. AlgaPSA does not send a
  stored key to an address it was not saved with.
- **Remove** asks you to confirm if mapped sites use the key. The sites keep their client
  mapping and their assets. They stop syncing until another key reaches their console.
  A connection type cannot be changed on an existing key. Add a new key instead.

## Consoles no key can reach

If UniFi lists a console but none of your keys can reach it, the settings page shows its
name with this guidance: add a key created under the fabric the console belongs to.
Create the key in Site Manager with that fabric selected, then add it here.
Select **Re-check all keys** to try again straight away.

## How AlgaPSA picks a key

AlgaPSA remembers which key reaches each console and uses that key for 24 hours. It tries
the other keys again when:

- the remembered key is rejected for that console,
- you add, replace or remove a key,
- you run a full sync, or
- you select **Re-check all keys**.

One rejected key does not stop the others. AlgaPSA asks you to reconnect only when every
key has been rejected.

## Composite console IDs

Site Manager can return console IDs containing a colon. AlgaPSA preserves that complete
ID when addressing the Cloud Connector; only the final colon in a stored
`<consoleId>:<siteId>` mapping separates the site ID. Existing client and asset mappings
do not need to be recreated after a scope-parsing fix. Run a full device sync to retry
previously failed consoles.

For example, `console-1:123456:site-1` identifies console `console-1:123456` and site
`site-1`.

Credential removal does not guess the console for a malformed mapped-site scope
(for example, `console-1:` or `console-1:123456:`). If a key has console routes and
the integration contains an invalid client-mapped scope, removal fails before
deleting anything, even after confirmation. Repair or unmap the invalid site mapping
before trying again. The failure is logged without key material. Valid legacy
`console-1:site-1` and migrated `local:site-1` mappings still require confirmation.

## Related topics

- [Provider setup order](provider-setup-order.md) — the order in which to connect integrations
