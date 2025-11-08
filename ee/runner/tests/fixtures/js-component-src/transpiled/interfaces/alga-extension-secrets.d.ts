/** @module Interface alga:extension/secrets **/
export function get(key: string): string;
export function listKeys(): Array<string>;
export type SecretError = import('./alga-extension-types.js').SecretError;
