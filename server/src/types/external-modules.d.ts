declare module '@alga-psa/product-auth-ee' {
  export function parsePolicy(input: string): any;
  export const PolicyManagement: any;
}

declare module '@alga-psa/product-extension-initialization' {
  export function initializeExtensions(): Promise<void>;
  const _default: any;
  export default _default;
}

declare module '@alga-psa/product-extension-actions' {
  export function validate(params: any): Promise<any>;
  export function lookupByHost(host: string): Promise<any>;
  export function listAppMenuItemsForTenant(tenantId?: string): Promise<any[]>;
  export type AppMenuItem = any;
}

declare module '@product/extensions/entry' {
  export const metadata: any;
  const _default: any;
  export default _default;
}

declare module '@product/workflows/entry' {
  export const DnDFlow: any;
}

declare module '@product/ext-proxy/handler' {
  export const dynamic: string;
  export const GET: any;
  export const POST: any;
  export const PUT: any;
  export const PATCH: any;
  export const DELETE: any;
}
