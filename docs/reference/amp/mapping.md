# Mapping AMP entities into Alga

## Vocabulary

The package says **organizations**; Alga maps them to **clients**. The rename
happens in exactly one documented step (the organization applier); nothing
else in the pipeline uses the internal noun.

| AMP entity | Alga target |
| --- | --- |
| organizations | `clients` |
| locations | `client_locations` |
| contacts | `contacts` |
| tickets | `tickets` |
| ticket_comments | `comments` |
| assets | `assets` |

## Operator-supplied configuration at preflight

Packages carry source *names*, never Alga IDs. Before a job can run, the
operator resolves tenant reference data — required, never guessed:

- **Tickets:** target board; a status mapping (source `status_name` → tenant
  status); a priority mapping (source `priority_name` → tenant priority); a
  default requester client for tickets whose organization cannot be resolved;
  optionally a default assignee (absent means unassigned).
- **Assets:** an asset type mapping (source `asset_type_name` → tenant asset
  type).
- **All entities:** a default client for orphaned children (records whose
  organization reference is absent or unresolved).

Safe to auto-create during application: locations under a resolved
organization, contacts under a resolved organization, and tags. Never
auto-created: boards, statuses, priorities, asset types, users, or anything
else that changes tenant-wide taxonomy.

## CSV/XLSX mapping profiles

The CSV converter maps spreadsheet headers onto canonical columns using a
mapping profile scoped to an entity type and a source signature (the ordered
header set). Profiles are saved per tenant so a repeat import of the same
shape needs no re-mapping. Canonical AMP packages get no mapping UI by
design — mapping exists only where the source is not already canonical.

## Placement rules

- A location whose organization resolves is created under it; the
  one-default-location invariant of the client is preserved.
- A contact or asset without a resolvable organization goes to the operator's
  default client.
- A ticket whose organization cannot be resolved uses the default requester
  client.
- A comment is only applied when its ticket applied (dependency order:
  organizations → locations → contacts → tickets → comments → assets).
