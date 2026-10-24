# SLA configuration

Customer and MSP SLA obligations are separate. MSP targets are selected when a ticket is escalated, using the customer's priority mapping and the applicable MSP policy.

## Before you start

Use an MSP SLA administrator and a disposable customer ticket. Open the client's **Co-managed IT → Co-managed SLA priorities** or [the SLA page](http://feature-co-managed-it.localhost:23374/msp/co-management/sla) and select the appropriate workspace if prompted. Record existing mappings and policies.

The ticket-screen walkthrough showed handback pausing the MSP clock. Fresh policy/mapping and breach-notification acceptance were not part of that run. Use a disposable policy to avoid changing existing service commitments.

## Risks to check

- An escalation starting without a valid MSP target.
- Customer and MSP clocks being conflated.
- A mapping change rewriting targets already promised on older escalations.
- A departed customer continuing to read the former MSP's live clock.

## 1. Configure and persist priority mapping

1. Select **Manage SLA policies** to open [SLA settings](http://feature-co-managed-it.localhost:23374/msp/settings/sla). Confirm the prepared MSP policy has the intended targets and business hours.
2. Return to **Co-managed SLA priorities**. For a prepared customer priority, select the intended **MSP priority for …** value.
3. Select **Save access**, reload, and compare the saved mapping.

Expected: each selected customer priority maps to the intended MSP priority. An unmapped or unavailable policy is visible as such; do not infer a valid target merely from a running UI timer.

## 2. Start a new MSP obligation on escalation

As the customer, open the disposable native ticket, confirm its priority, and choose **Escalate to MSP** with a unique note. Reload both customer and shared MSP views. Inspect the Co-managed section's customer and MSP SLA displays and handoff history.

Expected: initial visibility alone does not start the MSP obligation. Escalation selects the applicable client, board or default MSP policy and starts the relevant clock. Customer SLA remains separately identified. If SLA setup is required, record that blocker and complete configuration before retrying the escalation.

## 3. Keep existing targets stable

Record the escalated ticket's MSP targets. Change the disposable priority mapping or applicable future policy configuration, save and reload the old ticket. Escalate a second disposable ticket to compare the newly selected target.

Expected: existing clocks retain their captured targets; new escalations use current configuration. Compare timestamps/targets, not just rounded remaining-time labels.

## 4. Pause MSP responsibility without erasing history

As the MSP, **Return to customer** with a note. Reload both screens and inspect handoff history. If restoring the fixture, have the customer re-escalate through the normal control.

Expected: the MSP display reflects the responsibility pause and preserves history. The customer clock is not replaced by the MSP clock. Record the resulting targets and transitions; do not assume re-escalation simply resets every SLA measure.

## 5. Check lifecycle and notifications on prepared fixtures

Use [Departure and archives](10-departure-and-archives.md) on a separate relationship. After departure, the customer must retain its own outcome while the former MSP's live SLA display becomes unavailable.

Breach and routing email require a short-target test policy and running delivery workers. Capture the intended recipient's actual notification/mail and verify an unrelated staff member or requester does not receive private obligation details. A clock label alone does not prove notification delivery.

## Pass criteria and recovery

Pass when saved mappings govern new escalations, old targets remain stable, responsibility transitions affect the correct organization, and departure ends live cross-organization reads. Restore reversible mapping changes and retain handoff/notification evidence.

## Source references

- [SLA mapping screen](../../../server/src/components/co-managed/CoManagedSlaPolicyPanel.tsx)
- [SLA selection and transitions](../../../packages/co-managed/src/ticketSla.ts)
- [Organization-specific SLA reads](../../../packages/co-managed/src/ticketSlaRead.ts)

