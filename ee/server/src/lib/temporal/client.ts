import { Client, Connection } from '@temporalio/client';

const DEFAULT_TEMPORAL_ADDRESS = 'temporal-frontend.temporal.svc.cluster.local:7233';
const DEFAULT_TEMPORAL_NAMESPACE = 'default';

let connectionPromise: Promise<Connection> | undefined;
let clientPromise: Promise<Client> | undefined;

export function getTemporalClient(): Promise<Client> {
  connectionPromise ??= Connection.connect({
    address: process.env.TEMPORAL_ADDRESS || DEFAULT_TEMPORAL_ADDRESS,
  }).catch((error) => {
    connectionPromise = undefined;
    throw error;
  });
  clientPromise ??= connectionPromise.then((connection) => new Client({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE || DEFAULT_TEMPORAL_NAMESPACE,
  })).catch((error) => {
    clientPromise = undefined;
    throw error;
  });
  return clientPromise;
}
