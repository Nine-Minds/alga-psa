/**
 * Common API Types
 * Shared type definitions for API responses and data structures
 */

export interface SuccessResponse<T = any> {
  success: true;
  data: T;
  meta?: Record<string, any>;
}

export interface ErrorResponse {
  success: false;
  error: {
    message: string;
    code: string;
    details?: any;
  };
  meta?: Record<string, any>;
}

export interface PaginatedResponse<T = any> {
  success: true;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  meta?: Record<string, any>;
}

export interface ListOptions {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface FilterOptions {
  [key: string]: any;
}

export interface ServiceContext {
  tenantId: string;
  userId?: string;
  userRoles?: string[];
  permissions?: string[];
}