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

declare module '@alga-psa/workflows/entry' {
  import type { ComponentType } from 'react';

  export const DnDFlow: ComponentType<any>;
  const _default: ComponentType<any>;
  export default _default;
}

declare module '@product/ext-proxy/handler' {
  export const dynamic: string;
  export const GET: any;
  export const POST: any;
  export const PUT: any;
  export const PATCH: any;
  export const DELETE: any;
}

declare module '@tiptap/extension-image' {
  import { Node } from '@tiptap/core';

  interface ImageOptions {
    inline?: boolean;
    allowBase64?: boolean;
    HTMLAttributes?: Record<string, unknown>;
  }

  const Image: Node<ImageOptions>;
  export default Image;
}

declare module '@emoji-mart/react' {
  import { ComponentType } from 'react';

  interface PickerProps {
    onEmojiSelect?: (emoji: { id: string; native?: string }) => void;
    custom?: Array<{
      id: string;
      name: string;
      emojis: Array<{
        id: string;
        name: string;
        keywords: string[];
        skins: Array<{ src: string }>;
      }>;
    }>;
    theme?: 'auto' | 'light' | 'dark';
    set?: string;
    perLine?: number;
    maxFrequentRows?: number;
    previewPosition?: 'top' | 'bottom' | 'none';
    skinTonePosition?: 'preview' | 'search' | 'none';
    emojiSize?: number;
    emojiButtonSize?: number;
    [key: string]: unknown;
  }

  const Picker: ComponentType<PickerProps>;
  export default Picker;
}
