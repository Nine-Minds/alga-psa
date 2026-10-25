# Export, restore and independence

A customer can download an encrypted workspace backup, restore it through an installation operator, or upgrade the current workspace to independent AlgaPSA. Upgrade keeps the current hosting; moving installations requires export and restore.

## Before you start

Use a customer administrator and disposable customer data with identifiable tickets, tasks, documents, files and business credentials. Restore additionally requires an isolated destination installation, its database-owner operator, file storage and destination entitlement. Upgrade requires a separate disposable relationship and the customer's own paid/test subscription or tenant-bound signed Pro license.

The latest ticket-screen review did not freshly demonstrate these journeys. The restore/activation tooling is implemented, but there is no customer restore wizard. Do not upgrade the active White Rabbit review fixture. See [review order](README.md#review-order-and-retained-changes).

## Risks to check

- A backup that cannot restore without the original installation's keys.
- Customer data loss, broken file links or inclusion of MSP-private data.
- Restoring live trust, old connections or active automation unintentionally.
- Upgrade using the sponsor's entitlement or releasing its allocation twice.

## 1. Download an encrypted customer workspace

As the customer administrator, open [Export workspace](http://feature-co-managed-it.localhost:23374/msp/co-management/export). Enter and confirm a private passphrase of 16–1024 UTF-8 bytes, then choose the download action. Retain the archive privately and reload the export page to check continued access.

Expected: a complete encrypted download, not a success page mistaken for the archive. The export includes authorized customer records/files and the customer business credential vault, while excluding MSP-private stores, installation keys, sessions and live MSP trust. Use operator inspection and restore to prove contents; a nonempty file alone is insufficient.

Repeat export after departure on its prepared fixture to confirm the customer can still recover its own data. Do not put passphrases or decrypted credentials in screenshots, review evidence or shell arguments.

The October 25 operator check restored the current production export into a
new isolated tenant (`1f7161e2`). It retained two tickets, one project, one task,
22 comments and one shared file with matching archive checksum; its only user
remains inactive and the tenant is suspended pending activation. Retrying
returned the original receipt. Wrong passphrases and a tampered archive were
rejected. This is operator restore evidence, separate from the export video.
Destination paid activation, native login and full credential recovery remain
unaccepted.

## 2. Inspect and restore on an isolated destination

The installation operator runs the following from the destination checkout's `server/` directory, with its documented destination configuration loaded. Replace placeholders before execution. These commands prompt for the archive passphrase.

```sh
npm exec -- tsx --tsconfig ../ee/server/tsconfig.json scripts/restore-portable-workspace.ts --inspect --archive /absolute/customer-backup.alga
```

Record the inspection manifest and select the source administrator UUID from verified archive content. Choose a new, unused destination tenant UUID.

```sh
npm exec -- tsx --tsconfig ../ee/server/tsconfig.json scripts/restore-portable-workspace.ts --restore --archive /absolute/customer-backup.alga --destination-tenant <new-tenant-uuid> --administrator-user-id <source-admin-uuid>
```

Expected: authenticated archive contents restore into an isolated destination with remapped identities. Users remain inactive pending activation, connections require reauthorization and restored dispatch remains paused. Wrong passphrases or altered archives must fail without a partially active workspace. Preserve the restore receipt.

## 3. Activate with the destination's own entitlement

For self-hosted activation, obtain a Pro license signed for the new destination tenant and retain a new operation UUID:

```sh
npm exec -- tsx --tsconfig ../ee/server/tsconfig.json scripts/restore-portable-workspace.ts --activate --destination-tenant <restored-tenant-uuid> --operation-id <retained-operation-uuid> --license-file /absolute/customer-pro-license.jwt
```

For hosted activation, the destination must already have its own current paid subscription in native billing records and a verifiable provider subscription:

```sh
npm exec -- tsx --tsconfig ../ee/server/tsconfig.json scripts/restore-portable-workspace.ts --activate-hosted --destination-tenant <restored-tenant-uuid> --operation-id <retained-operation-uuid>
```

Activation prompts for a new administrator password. Hosted activation does not purchase or provision that subscription; its dedicated restore billing setup remains a preparation gap.

Sign in to the destination as the activated administrator. Compare source records, file bytes, document links, attribution and authorized business credential values through native screens. Verify other users remain inactive, workflows remain paused and old provider/MSP connections have not revived. Replaying the same activation operation must return its receipt without resetting credentials or unpausing work.

## 4. Upgrade a current workspace independently

On a separate disposable customer workspace, open [Upgrade to AlgaPSA](http://feature-co-managed-it.localhost:23374/msp/co-management/upgrade). Record required technician seats. For hosted review, complete the customer's test purchase and refresh until its own paid entitlement is verified. For self-hosted review, use **Manage workspace license** to install the customer's tenant-bound signed test license.

Payment alone must not end MSP trust. Once ready, choose **Upgrade workspace**, confirm the described effects, and wait for completion. Select **Open AlgaPSA**, refresh the session and inspect the same tickets/projects/history.

Expected: the same workspace becomes independent, live MSP access closes and its old allocation releases once. Sponsor licenses cannot substitute for customer entitlement. A refresh/retry must not run conversion or charge again. The MSP's permitted archive remains available.

## Pass criteria and retained state

Record export, restore and activation receipts separately from upgrade results. Pass only when native destination data/files/credential recovery and paused trust/automation are verified, or when same-workspace upgrade preserves data under its own entitlement. Store archives and licenses privately. Retain an activated/restored or upgraded fixture; neither operation is undone by resetting a checkbox.

## Source references

- [Customer export screen](../../../server/src/components/co-managed/CoManagedPortableExport.tsx)
- [Operator restore CLI](../../../server/scripts/restore-portable-workspace.ts)
- [Portable workspace behavior and limitations](../../features/co-managed-portable-workspace.md)
- [Upgrade screen](../../../server/src/components/co-managed/CoManagedUpgrade.tsx)
