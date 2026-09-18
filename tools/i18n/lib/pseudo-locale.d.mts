export declare const PSEUDO_LOCALES: Record<string, { open: string; close: string; expand: number }>;
export declare function pseudoString(value: string, locale?: string): string;
export declare function pseudoPattern(locale?: string): RegExp;
export declare function isPseudoValue(value: unknown, locale?: string): boolean;
