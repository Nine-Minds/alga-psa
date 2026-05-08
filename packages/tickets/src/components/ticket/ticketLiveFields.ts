'use client';

export interface TicketLiveConflictState {
  updatedFields: string[];
  updatedBy: {
    userId: string;
    displayName: string;
  };
  updatedAt: string;
}

const LIVE_FIELD_ALIASES: Record<string, string> = {
  subcategory_id: 'category_id',
};

export function normalizeTicketLiveField(field: string) {
  return LIVE_FIELD_ALIASES[field] ?? field;
}

