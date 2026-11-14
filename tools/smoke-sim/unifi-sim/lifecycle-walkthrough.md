# UniFi lifecycle smoke walkthrough

This is prepared for the next smoke/review owner. It was not run in this repair step because the app server and simulator must not be started here. The simulator uses local-controller API shapes; it does not validate Site Manager behavior or live controller timestamps.

## Setup

1. Start the simulator from the review environment using the existing UniFi smoke procedure. Use its local controller URL and API key in **Settings → Integrations → UniFi**.
2. Map both `Emerald HQ` and `Munchkinland Branch` to test clients. Leave device asset sync disabled for at least one mapped site; alerting must still work.
3. In **UniFi → Alerting**, set offline grace to `1` minute. Add an active rule matching `DEVICE_OFFLINE` / `device_offline`, create a ticket, and enable auto resolve. Do not edit the generated ticket during the recovery case.
4. In the database, record the tenant and integration IDs. Run the check action once to initialize baseline healthy observations.

Use the simulator control plane (default host/port shown here; substitute the review environment's address):

```sh
SIM=http://127.0.0.1:18794
curl -s "$SIM/__sim/state"
curl -s -X POST "$SIM/__sim/device" -H 'content-type: application/json' \
  -d '{"siteId":"site-hq-0001","id":"dev-sw-0001","state":"OFFLINE"}'
```

## Scenario A: grace, outage identity, recovery, second outage

1. Set `dev-sw-0001` offline and run **Check Offline Devices Now** twice, with more than one minute between checks. First check: no condition transition or ticket. Second check: one `firing` condition, one `triggered` outbox row, one active RMM alert, and one ticket linked to the alert.
2. Repeat a check while still offline. The condition outage ID, external alert ID, RMM alert row, and ticket ID remain unchanged.
3. Set the switch online and check again. Expect one recovery transition, a resolved RMM alert, and closure of the untouched ticket according to the configured rule.
4. Set it offline again, wait through grace, and check. Expect a new outage ID, external alert ID, alert row, and ticket. The first alert's `ticket_id` and resolved history remain unchanged.

```sh
curl -s -X POST "$SIM/__sim/device" -H 'content-type: application/json' \
  -d '{"siteId":"site-hq-0001","id":"dev-sw-0001","state":"ONLINE"}'
```

## Scenario B: missing, empty, uncertain, and failed scope

Run each case while the switch outage is firing; after each change, check and confirm no synthetic recovery or new ticket:

```sh
# Missing device in a nonempty site response.
curl -s -X POST "$SIM/__sim/device" -H 'content-type: application/json' \
  -d '{"siteId":"site-hq-0001","id":"dev-sw-0001","remove":true}'

# Empty successful inventory for the site.
curl -s -X POST "$SIM/__sim/mode" -H 'content-type: application/json' \
  -d '{"siteId":"site-hq-0001","mode":"empty"}'

# Uncertain state.
curl -s -X POST "$SIM/__sim/mode" -H 'content-type: application/json' \
  -d '{"siteId":"site-hq-0001","mode":"normal"}'
curl -s -X POST "$SIM/__sim/device" -H 'content-type: application/json' \
  -d '{"siteId":"site-hq-0001","id":"dev-gw-0001","state":"UPDATING"}'

# One unavailable site while another site continues to process.
curl -s -X POST "$SIM/__sim/mode" -H 'content-type: application/json' \
  -d '{"siteId":"site-hq-0001","mode":"error500"}'
curl -s -X POST "$SIM/__sim/device" -H 'content-type: application/json' \
  -d '{"siteId":"site-br-0002","id":"dev-gw-0002","state":"OFFLINE"}'
```

With HQ unavailable, run another check after the grace interval to fire the branch gateway, then mark it online and check again. Verify its trigger and recovery complete while the HQ outage remains firing and held. Restore HQ to `normal`; its next fresh failing observation must continue the same outage if within the evidence gap, or restart pending grace if the gap exceeded the configured bound. Then restore the missing switch with:

```sh
curl -s -X POST "$SIM/__sim/device" -H 'content-type: application/json' \
  -d '{"siteId":"site-hq-0001","add":true,"device":{"id":"dev-sw-0001","name":"HQ Core Switch","model":"USW-Pro-24-PoE","macAddress":"74:AC:B9:00:00:02","state":"ONLINE","features":["switching"]}}'
```

Also remove a site's client mapping in the UI while its condition is firing. The condition should become `unmanaged`, retain its outage/ticket history, and stay open until an explicit recovery is observed after the site is mapped again.

## Database evidence to attach to the review

Run with the tenant and integration IDs recorded during setup:

```sql
SELECT scope_key, subject_key, condition_key, state, pending_since,
       current_outage_id, current_external_alert_id, last_trusted_evidence_at,
       last_observation_at, last_observation_kind
FROM rmm_condition_states
WHERE tenant = '<tenant>' AND integration_id = '<integration>'
ORDER BY scope_key, subject_key;

SELECT transition_kind, external_alert_id, status, created_at, delivered_at
FROM rmm_condition_transitions
WHERE tenant = '<tenant>' AND integration_id = '<integration>'
ORDER BY created_at;

SELECT external_alert_id, status, ticket_id, triggered_at, resolved_at, metadata
FROM rmm_alerts
WHERE tenant = '<tenant>' AND integration_id = '<integration>'
ORDER BY triggered_at;
```

Expected outcome: one state row per site/device/condition; exactly one trigger and recovery per completed outage; old `rmm_alerts` rows keep their original IDs and ticket links; the second outage has a different external ID; missing, empty, uncertain, failed, and unmanaged evidence never manufactures a recovery. Attach ticket IDs and screenshots showing the two distinct ticket journeys, plus the simulator request log with credentials omitted.

## Review limits

The next owner must run the browser walkthrough and refresh the review evidence against the exact pushed repair SHA. Unit and DB tests do not count as browser smoke evidence. A live Site Manager/controller check is a separate validation item and should record actual timestamp availability and per-site failure behavior.
