/**
 * Server-side implementation of IAnalyticsTracker interface
 * This adapter bridges the shared TicketModel with the server's analytics system
 */

import { analytics } from '../../posthog';
import { AnalyticsEvents } from '../../events';
import { featureAdoptionTracker } from '../featureAdoption';

export class ServerAnalyticsTracker {
  async trackTicketCreated(data: {
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
  }, userId?: string): Promise<void> {
    try {
      analytics.capture(AnalyticsEvents.TICKET_CREATED, {
        ...data,
        ...data.metadata
      }, userId);
    } catch (error) {
      console.error('Failed to track ticket creation analytics:', error);
      // Don't throw - analytics failure shouldn't break ticket operations
    }
  }

  async trackTicketUpdated(data: {
    ticket_id: string;
    changes: string[];
    updated_via: string;
    metadata?: Record<string, any>;
  }, userId?: string): Promise<void> {
    try {
      analytics.capture(AnalyticsEvents.TICKET_UPDATED, {
        ...data,
        ...data.metadata
      }, userId);
    } catch (error) {
      console.error('Failed to track ticket update analytics:', error);
      // Don't throw - analytics failure shouldn't break ticket operations
    }
  }

  async trackCommentCreated(data: {
    ticket_id: string;
    is_internal: boolean;
    is_resolution: boolean;
    author_type: string;
    created_via: string;
    metadata?: Record<string, any>;
  }, userId?: string): Promise<void> {
    try {
      analytics.capture(AnalyticsEvents.COMMENT_CREATED, {
        ...data,
        ...data.metadata
      }, userId);
    } catch (error) {
      console.error('Failed to track comment creation analytics:', error);
      // Don't throw - analytics failure shouldn't break ticket operations
    }
  }

  async trackFeatureUsage(feature: string, userId?: string, metadata?: Record<string, any>): Promise<void> {
    try {
      if (userId) {
        featureAdoptionTracker.trackFeatureUsage(feature, userId, metadata);
      }
    } catch (error) {
      console.error('Failed to track feature usage:', error);
      // Don't throw - analytics failure shouldn't break ticket operations
    }
  }
}
