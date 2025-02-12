import { Temporal } from '@js-temporal/polyfill';

export type ISO8601String = string;

export interface TemporalDate {
    toJSON(): string;
    toString(): string;
}

// Type guard to check if a value is a Temporal.PlainDate
export function isTemporalDate(value: any): value is Temporal.PlainDate {
    return value instanceof Temporal.PlainDate;
}

// Helper type for dates that can be either Temporal.PlainDate or ISO string
export type DateValue = Temporal.PlainDate | ISO8601String;