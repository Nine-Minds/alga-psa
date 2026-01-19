import type { IAnalyticsTracker } from '@alga-psa/shared/models/ticketModel';
import { analytics, AnalyticsEvents } from '@alga-psa/analytics';

export class TicketModelAnalyticsTracker implements IAnalyticsTracker {
  async trackTicketCreated(
    data: {
      ticket_type: string;
      priority_id?: string;
      has_description: boolean;
      has_category: boolean;
      has_subcategory: boolean;
      is_assigned: boolean;
      board_id?: string;
      created_via: string;
      has_asset?: boolean;
      metadata?: Record<string, any>;
    },
    userId?: string
  ): Promise<void> {
    try {
      analytics.capture(
        AnalyticsEvents.TICKET_CREATED,
        {
          ...data,
          ...data.metadata,
        },
        userId
      );
    } catch (error) {
      console.error('Failed to track ticket creation analytics:', error);
    }
  }

  async trackTicketUpdated(
    data: { ticket_id: string; changes: string[]; updated_via: string; metadata?: Record<string, any> },
    userId?: string
  ): Promise<void> {
    try {
      analytics.capture(
        AnalyticsEvents.TICKET_UPDATED,
        {
          ...data,
          ...data.metadata,
        },
        userId
      );
    } catch (error) {
      console.error('Failed to track ticket update analytics:', error);
    }
  }

  async trackCommentCreated(
    data: { ticket_id: string; is_internal: boolean; is_resolution: boolean; author_type: string; created_via: string; metadata?: Record<string, any> },
    userId?: string
  ): Promise<void> {
    try {
      analytics.capture(
        AnalyticsEvents.COMMENT_CREATED,
        {
          ...data,
          ...data.metadata,
        },
        userId
      );
    } catch (error) {
      console.error('Failed to track comment creation analytics:', error);
    }
  }

  async trackFeatureUsage(_feature: string, _userId?: string, _metadata?: Record<string, any>): Promise<void> {
    // No-op in package context (feature adoption tracker is server-owned today).
  }
}

