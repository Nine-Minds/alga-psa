/** @module Interface alga:extension/storage **/
export function get(namespace: string, key: string): StorageEntry;
export function put(entry: StorageEntry): StorageEntry;
export { _delete as delete };
function _delete(namespace: string, key: string): void;
export function listEntries(namespace: string, cursor: string | undefined): Array<StorageEntry>;
export type StorageEntry = import('./alga-extension-types.js').StorageEntry;
export type StorageError = import('./alga-extension-types.js').StorageError;
