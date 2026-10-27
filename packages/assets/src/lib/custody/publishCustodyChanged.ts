import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildAssetCustodyChangedPayload } from '@alga-psa/workflow-streams';
import type { CustodyEventType, IAssetCustody } from '@alga-psa/types';

/**
 * Publish ASSET_CUSTODY_CHANGED after the custody transaction has committed. Errors are logged and
 * swallowed: the custody write is already durable and must not be reported as failed.
 */
export async function publishCustodyChanged(input: {
  tenant: string;
  actorUserId: string;
  custody: IAssetCustody;
  eventType: CustodyEventType | 'updated';
  occurredAt: string;
}): Promise<void> {
  try {
    const { custody } = input;
    await publishWorkflowEvent({
      eventType: 'ASSET_CUSTODY_CHANGED',
      payload: buildAssetCustodyChangedPayload({
        assetId: custody.asset_id,
        custodyId: custody.custody_id,
        clientId: custody.client_id,
        ticketId: custody.ticket_id,
        eventType: input.eventType,
        state: custody.state,
        purpose: custody.purpose,
        nextActionParty: custody.next_action_party,
        followUpOn: custody.follow_up_on,
        locationId: custody.location_id,
        bin: custody.bin,
        holderUserId: custody.holder_user_id,
        actorUserId: input.actorUserId,
        occurredAt: input.occurredAt,
      }),
      ctx: {
        tenantId: input.tenant,
        occurredAt: input.occurredAt,
        actor: { actorType: 'USER', actorUserId: input.actorUserId },
      },
    });
  } catch (error) {
    console.error(
      `Post-commit effect failed (tenant=${input.tenant} asset_id=${input.custody.asset_id} event=ASSET_CUSTODY_CHANGED); the custody write is committed:`,
      error
    );
  }
}
