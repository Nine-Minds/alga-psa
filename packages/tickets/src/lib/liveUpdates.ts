import { getRedisClient, getRedisConfig } from '@alga-psa/event-bus';

export interface TicketLiveUpdateActor {
  userId: string;
  displayName: string;
}

export interface PublishTicketUpdateParams {
  tenantId: string;
  ticketId: string;
  updatedFields: string[];
  updatedBy: TicketLiveUpdateActor;
  updatedAt: string;
}

const TICKET_UPDATE_CHANNEL_PREFIX = 'ticket-updates:';

function normalizeJsonbValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeJsonbValue);
  }

  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = normalizeJsonbValue((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }

  return value;
}

function areFieldValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalizeJsonbValue(left)) === JSON.stringify(normalizeJsonbValue(right));
}

export function diffTicketFields(
  currentRow: Record<string, unknown> | null | undefined,
  validatedUpdate: Record<string, unknown> | null | undefined
): string[] {
  if (!currentRow || !validatedUpdate) {
    return [];
  }

  return Object.keys(validatedUpdate).filter((fieldName) => {
    const nextValue = validatedUpdate[fieldName];

    if (typeof nextValue === 'undefined') {
      return false;
    }

    return !areFieldValuesEqual(currentRow[fieldName], nextValue);
  });
}

export function getTicketUpdateChannel(tenantId: string, ticketId: string): string {
  const config = getRedisConfig();
  return `${config.prefix}${TICKET_UPDATE_CHANNEL_PREFIX}${tenantId}:${ticketId}`;
}

export async function publishTicketUpdate(params: PublishTicketUpdateParams): Promise<void> {
  if (process.env.LIVE_TICKET_UPDATES_DISABLED === '1') {
    return;
  }

  if (params.updatedFields.length === 0) {
    return;
  }

  let client: Awaited<ReturnType<typeof getRedisClient>> | null = null;

  try {
    client = await getRedisClient();
    await client.publish(
      getTicketUpdateChannel(params.tenantId, params.ticketId),
      JSON.stringify({
        updatedFields: params.updatedFields,
        updatedBy: params.updatedBy,
        updatedAt: params.updatedAt,
      })
    );
  } catch (error) {
    console.warn('[publishTicketUpdate] Failed to publish live ticket update:', error);
  } finally {
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // Ignore disconnect errors for best-effort pub/sub publishing.
      }
    }
  }
}
