'use server'

import ClientPlanBundle from 'server/src/lib/models/clientPlanBundle';

export async function getClientBundles(clientId: string) {
  return ClientPlanBundle.getByClientId(clientId);
}

