// Survey interfaces define the data contracts between server actions/services and UI components.
// These should remain frontend-friendly to avoid leaking database column naming conventions.

export interface SurveyDashboardFilters {
  startDate?: string;
  endDate?: string;
  clientId?: string;
  technicianId?: string;
  templateId?: string;
}

export interface SurveyDashboardMetrics {
  totalInvitations: number;
  totalResponses: number;
  responseRate: number;
  averageRating: number | null;
  outstandingInvitations: number;
  recentNegativeResponses: number;
}

export interface SurveyTrendPoint {
  date: string;
  averageRating: number | null;
  responseCount: number;
}

export interface SurveyDistributionBucket {
  rating: number;
  count: number;
  percentage: number;
}

export interface SurveyIssueSummary {
  responseId: string;
  ticketId: string;
  ticketNumber: string | null;
  clientName: string | null;
  comment: string | null;
  rating: number;
  submittedAt: string;
  assignedAgentName: string | null;
}

export interface SurveyResponseListItem {
  responseId: string;
  ticketId: string;
  ticketNumber: string | null;
  clientName: string | null;
  contactName: string | null;
  rating: number;
  comment: string | null;
  submittedAt: string;
  technicianName: string | null;
}

export interface SurveyResponsePage {
  items: SurveyResponseListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface SurveyDashboardData {
  metrics: SurveyDashboardMetrics;
  trend: SurveyTrendPoint[];
  distribution: SurveyDistributionBucket[];
  topIssues: SurveyIssueSummary[];
  recentResponses: SurveyResponseListItem[];
}

export interface SurveyClientSatisfactionSummary {
  clientId: string;
  clientName: string | null;
  totalResponses: number;
  averageRating: number | null;
  lastResponseAt: string | null;
  responseRate: number | null;
  trend: SurveyTrendPoint[];
}

export interface SurveyTicketSatisfactionSummary {
  ticketId: string;
  ticketNumber: string | null;
  latestResponseRating: number | null;
  latestResponseComment: string | null;
  latestResponseAt: string | null;
  totalResponses: number;
}
