# Citus verification — ticket time → project attribution (alga-2026-0002622)

Work item 8 of the plan: the resolver's derived table has to be pushed down
*inside the engine's pinned transaction*, or the plan's `LEFT JOIN LATERAL ...
LIMIT 1` + `NOT EXISTS` fallback is required instead. This is that check.

## Setup

Disposable three-node cluster (coordinator + two workers), `citusdata/citus:12.1`
(PostgreSQL 16.6, Citus 12.1-1), `citus.shard_count = 32`:

```
docker run -d --platform linux/amd64 --name mc7_citus_coord --network mc7_citus_net \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=attrib citusdata/citus:12.1   # + two workers
psql -c "SELECT citus_set_coordinator_host('mc7_citus_coord', 5432)" \
     -c "SELECT citus_add_node('mc7_citus_w1', 5432)" \
     -c "SELECT citus_add_node('mc7_citus_w2', 5432)"
```

`tickets`, `projects`, `project_phases`, `project_tasks`, `project_ticket_links`
and `time_entries` created with the columns the loaders read, each
`create_distributed_table(..., 'tenant', colocate_with => 'tickets')` — the same
scope and colocation `tenantTableMetadata` gives them in production — plus the
migration's partial index
`idx_project_ticket_links_tenant_ticket_billable (tenant, ticket_id) WHERE bill_under_project`.
Two tenants × 200 tickets × one billable link × one ticket time entry each, so a
tenant-filtered read is a genuine single-shard query rather than a trivial one.

## The pinned transaction

The engine's loaders run inside the generation transaction, which has already
written to distributed tables (`reconcileWindowAttribution` →
`contractLineAttributionWriter`). Both queries below were therefore explained
after an `UPDATE time_entries ...` in the same `BEGIN`, which is what pins the
transaction to a node and is exactly the state the plan asked us to test.

## Result: pushed down, one task, no fallback needed

Loader-shaped read (resolver + `projects` on
`COALESCE(project_phases.project_id, ticket_project.project_id)` + `tickets`):

```
 Custom Scan (Citus Adaptive)
   Task Count: 1
   Tasks Shown: All
   ->  Task
         Node: host=mc7_citus_w2 port=5432 dbname=attrib
         ->  Hash Left Join
               Hash Cond: (COALESCE(phase.project_id, ticket_project.project_id) = pr.project_id)
               ...
                     ->  Hash
                           ->  Subquery Scan on ticket_project
                                 ->  GroupAggregate
                                       Group Key: link.ticket_id
                                       Filter: (count(DISTINCT link.project_id) = 1)
                                             ->  Hash Join
                                                   Hash Cond: ((link.project_id = link_project.project_id) AND (link_ticket.client_id = link_project.client_id))
                                                         ->  Seq Scan on project_ticket_links_102149 link
                                                               Filter: (bill_under_project AND (tenant = '1111...'::uuid))
```

The ambiguity warning's query (`ambiguousTicketProjectLinksQuery()` joined to
`tickets` with the billable-time `EXISTS`) plans the same way: `Task Count: 1`.

* One adaptive task on one worker for both: whole statement, derived table and
  the client-match joins included, executes on the shard.
* No `Distributed Subplan`, no repartition join — grepped for and absent.
* Citus propagates the tenant equality into the derived table's own scans, so the
  grouped subquery stays single-shard; the client-match predicate added for the
  cross-client guard rides along as an ordinary join condition.
* Behaviour on the cluster matches single-node: 200 time entries in, 200 rows
  out, 200 attributed — the group-by can never fan a time entry out.

**Conclusion:** keep the grouped derived table. The plan's LATERAL + `NOT EXISTS`
fallback is not needed, and `MIN(project_id)` stays — it is only ever read when
`project_count = 1`, where it *is* the project.

Cluster torn down afterwards (`docker rm -f mc7_citus_coord mc7_citus_w1
mc7_citus_w2`); nothing in this repo depends on it.
