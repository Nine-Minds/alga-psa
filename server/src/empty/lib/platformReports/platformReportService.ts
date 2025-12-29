/**
 * Platform Report Service - CE Empty Stub
 *
 * This is a stub implementation for Community Edition builds.
 * The actual implementation is in ee/server/src/lib/platformReports/
 */

import { ReportDefinition, ReportResult, ReportParameters } from 'server/src/lib/reports/core/types';

export interface CustomReport {
  tenant: string;
  report_id: string;
  name: string;
  description: string | null;
  category: string | null;
  report_definition: ReportDefinition;
  platform_access: boolean;
  display_config: Record<string, unknown> | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  is_active: boolean;
}

export interface CreateReportInput {
  name: string;
  description?: string;
  category?: string;
  report_definition: ReportDefinition;
  platform_access?: boolean;
  display_config?: Record<string, unknown>;
}

export interface UpdateReportInput {
  name?: string;
  description?: string;
  category?: string;
  report_definition?: ReportDefinition;
  platform_access?: boolean;
  display_config?: Record<string, unknown>;
  is_active?: boolean;
}

export class PlatformReportService {
  constructor(_masterTenantId: string) {
    // CE stub - no implementation
  }

  async listReports(_options?: { category?: string; activeOnly?: boolean }): Promise<CustomReport[]> {
    return [];
  }

  async getReport(_reportId: string): Promise<CustomReport | null> {
    return null;
  }

  async createReport(_input: CreateReportInput, _createdBy?: string): Promise<CustomReport> {
    throw new Error('Platform reports are only available in Enterprise Edition');
  }

  async updateReport(_reportId: string, _input: UpdateReportInput): Promise<CustomReport | null> {
    return null;
  }

  async deleteReport(_reportId: string): Promise<boolean> {
    return false;
  }

  async executeReport(_reportId: string, _parameters?: ReportParameters): Promise<ReportResult> {
    throw new Error('Platform reports are only available in Enterprise Edition');
  }
}
