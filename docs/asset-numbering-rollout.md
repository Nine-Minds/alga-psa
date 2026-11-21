# Asset numbering rollout

Deploy the asset-numbering schema and application before activating unique asset tags for a tenant. During a blue/green rollout, both releases can create and edit assets. New code checks the physical tag of rows written by the previous release, even when their normalized metadata is absent or stale.

Before activation, the previous release does not participate in claim arbitration. It can still introduce a duplicate or use a reserved tag. Finish upgrading writers and reconcile these conflicts before enabling uniqueness.

After every application instance and asset-writing integration has been upgraded, open **Settings → Assets** (`/msp/settings/assets`). Reconcile duplicate tags, record the review notes, and select **Activate unique asset tags**. Activation preserves physical labels and intentionally blank legacy records. It refuses unresolved duplicates and tags held by another asset or a printed reservation.

Activation locks the tenant policy, refreshes old identity metadata, acquires claims, and adopts existing rows in one transaction. A composite foreign key then rejects writes that omit the managed identity protocol, including direct SQL inserts and attempts to demote an existing asset. In-flight compatibility inserts finish before activation adopts their rows. New application writes hold the policy stable until their asset is persisted.

After activation, an older application instance cannot create assets or change physical tags. Roll back the application only to a release that supports the identity protocol. There is no automatic deactivation; removing enforcement would require a separately reviewed data migration.

The storage implementation is in the asset-numbering migrations, `shared/services/assetNumbering.ts`, and `shared/services/assetTagActivation.ts`. Behavioral coverage is in `server/src/test/integration/assetNumberingPersistence.integration.test.ts`.
