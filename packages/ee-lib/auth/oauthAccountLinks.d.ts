export type OAuthLinkProvider = string;

export class OAuthAccountLinkConflictError extends Error {}

export function upsertOAuthAccountLink(...args: any[]): Promise<any>;

export function findOAuthAccountLink(...args: any[]): Promise<any>;

