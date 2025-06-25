/**
 * API Response Helpers
 * Standardized response formatting utilities
 */

import { NextResponse } from 'next/server';

export interface ApiSuccessResponse<T = any> {
  data: T;
  meta?: {
    timestamp?: string;
    requestId?: string;
    version?: string;
    [key: string]: any;
  };
  links?: {
    self?: string;
    related?: Record<string, string>;
    [key: string]: any;
  };
}

export interface ApiPaginatedResponse<T = any> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  meta?: {
    timestamp?: string;
    requestId?: string;
    version?: string;
    filters?: Record<string, any>;
    sort?: string;
    order?: string;
    [key: string]: any;
  };
  links?: {
    self?: string;
    first?: string;
    last?: string;
    next?: string;
    prev?: string;
    [key: string]: any;
  };
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
    timestamp?: string;
    requestId?: string;
    path?: string;
  };
}

/**
 * Create a successful API response
 */
export function apiSuccess<T>(
  data: T,
  status: number = 200,
  meta?: Record<string, any>,
  links?: Record<string, string>
): NextResponse {
  const response: ApiSuccessResponse<T> = {
    data,
    meta: {
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      ...meta
    }
  };

  if (links) {
    response.links = links;
  }

  return NextResponse.json(response, { status });
}

/**
 * Create a paginated API response
 */
export function apiPaginated<T>(
  data: T[],
  pagination: {
    page: number;
    limit: number;
    total: number;
  },
  meta?: Record<string, any>,
  baseUrl?: string
): NextResponse {
  const { page, limit, total } = pagination;
  const totalPages = Math.ceil(total / limit);
  
  const response: ApiPaginatedResponse<T> = {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1
    },
    meta: {
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      ...meta
    }
  };

  // Generate pagination links if baseUrl provided
  if (baseUrl) {
    const links: Record<string, string> = {
      self: `${baseUrl}?page=${page}&limit=${limit}`,
      first: `${baseUrl}?page=1&limit=${limit}`,
      last: `${baseUrl}?page=${totalPages}&limit=${limit}`
    };

    if (page > 1) {
      links.prev = `${baseUrl}?page=${page - 1}&limit=${limit}`;
    }

    if (page < totalPages) {
      links.next = `${baseUrl}?page=${page + 1}&limit=${limit}`;
    }

    response.links = links;
  }

  return NextResponse.json(response);
}

/**
 * Create an error API response
 */
export function apiError(
  code: string,
  message: string,
  status: number = 400,
  details?: any,
  path?: string
): NextResponse {
  const response: ApiErrorResponse = {
    error: {
      code,
      message,
      timestamp: new Date().toISOString(),
      ...(details && { details }),
      ...(path && { path })
    }
  };

  return NextResponse.json(response, { status });
}

/**
 * Create a validation error response
 */
export function apiValidationError(
  message: string = 'Validation failed',
  details?: any
): NextResponse {
  return apiError('VALIDATION_ERROR', message, 400, details);
}

/**
 * Create an unauthorized error response
 */
export function apiUnauthorized(
  message: string = 'Unauthorized'
): NextResponse {
  return apiError('UNAUTHORIZED', message, 401);
}

/**
 * Create a forbidden error response
 */
export function apiForbidden(
  message: string = 'Forbidden'
): NextResponse {
  return apiError('FORBIDDEN', message, 403);
}

/**
 * Create a not found error response
 */
export function apiNotFound(
  message: string = 'Resource not found'
): NextResponse {
  return apiError('NOT_FOUND', message, 404);
}

/**
 * Create a conflict error response
 */
export function apiConflict(
  message: string = 'Resource conflict'
): NextResponse {
  return apiError('CONFLICT', message, 409);
}

/**
 * Create an internal server error response
 */
export function apiInternalError(
  message: string = 'Internal server error',
  details?: any
): NextResponse {
  return apiError('INTERNAL_ERROR', message, 500, details);
}

/**
 * Create a created response (201)
 */
export function apiCreated<T>(
  data: T,
  meta?: Record<string, any>,
  links?: Record<string, string>
): NextResponse {
  return apiSuccess(data, 201, meta, links);
}

/**
 * Create a no content response (204)
 */
export function apiNoContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

/**
 * Extract pagination parameters from URL
 */
export function extractPaginationParams(url: URL): {
  page: number;
  limit: number;
  sort?: string;
  order?: 'asc' | 'desc';
} {
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '25')));
  const sort = url.searchParams.get('sort') || undefined;
  const order = (url.searchParams.get('order') as 'asc' | 'desc') || undefined;

  return { page, limit, sort, order };
}

/**
 * Extract filters from URL search params
 */
export function extractFilters(url: URL, excludeParams: string[] = ['page', 'limit', 'sort', 'order']): Record<string, any> {
  const filters: Record<string, any> = {};
  
  url.searchParams.forEach((value, key) => {
    if (!excludeParams.includes(key)) {
      // Handle special filter types
      if (key.endsWith('_from') || key.endsWith('_to')) {
        filters[key] = new Date(value);
      } else if (value === 'true' || value === 'false') {
        filters[key] = value === 'true';
      } else if (!isNaN(Number(value))) {
        filters[key] = Number(value);
      } else {
        filters[key] = value;
      }
    }
  });

  return filters;
}

/**
 * Generate HATEOAS links for a resource
 */
/**
 * Generate HATEOAS links for a resource
 */
export function generateResourceLinks(
  resource: string,
  id: string,
  baseUrl: string,
  actions: string[] = ['read', 'update', 'delete'],
  additionalLinks: Record<string, string> = {}
): Record<string, { href: string; method: string; rel: string }> {
  const links: Record<string, { href: string; method: string; rel: string }> = {
    self: {
      href: `${baseUrl}/${resource}/${id}`,
      method: 'GET',
      rel: 'self'
    }
  };

  if (actions.includes('update')) {
    links.edit = {
      href: `${baseUrl}/${resource}/${id}`,
      method: 'PUT',
      rel: 'edit'
    };
    links.patch = {
      href: `${baseUrl}/${resource}/${id}`,
      method: 'PATCH',
      rel: 'partial-update'
    };
  }

  if (actions.includes('delete')) {
    links.delete = {
      href: `${baseUrl}/${resource}/${id}`,
      method: 'DELETE',
      rel: 'delete'
    };
  }

  // Add collection link
  links.collection = {
    href: `${baseUrl}/${resource}`,
    method: 'GET',
    rel: 'collection'
  };

  // Add create link for collection
  if (actions.includes('create')) {
    links.create = {
      href: `${baseUrl}/${resource}`,
      method: 'POST',
      rel: 'create'
    };
  }

  // Add additional custom links
  Object.entries(additionalLinks).forEach(([rel, href]) => {
    links[rel] = {
      href,
      method: 'GET',
      rel
    };
  });

  return links;
}


/**
 * Add HATEOAS links to response data
 */
/**
 * Add HATEOAS links to response data
 */
export function addHateoasLinks<T extends { [key: string]: any }>(
  data: T,
  links: Record<string, { href: string; method: string; rel: string }>
): T & { _links: Record<string, { href: string; method: string; rel: string }> } {
  return {
    ...data,
    _links: links
  };
}

/**
 * Generate collection-level HATEOAS links
 */
export function generateCollectionLinks(
  resource: string,
  baseUrl: string,
  pagination?: { page: number; limit: number; total: number; totalPages: number },
  filters?: Record<string, any>
): Record<string, { href: string; method: string; rel: string }> {
  const links: Record<string, { href: string; method: string; rel: string }> = {
    self: {
      href: `${baseUrl}/${resource}`,
      method: 'GET',
      rel: 'self'
    },
    create: {
      href: `${baseUrl}/${resource}`,
      method: 'POST',
      rel: 'create'
    }
  };

  // Add pagination links
  if (pagination) {
    const { page, limit, totalPages } = pagination;
    const baseQuery = new URLSearchParams(filters ? Object.entries(filters).map(([k, v]) => [k, String(v)]) : []);
    
    // First page
    links.first = {
      href: `${baseUrl}/${resource}?${new URLSearchParams({ ...Object.fromEntries(baseQuery), page: '1', limit: String(limit) })}`,
      method: 'GET',
      rel: 'first'
    };

    // Last page
    links.last = {
      href: `${baseUrl}/${resource}?${new URLSearchParams({ ...Object.fromEntries(baseQuery), page: String(totalPages), limit: String(limit) })}`,
      method: 'GET',
      rel: 'last'
    };

    // Previous page
    if (page > 1) {
      links.prev = {
        href: `${baseUrl}/${resource}?${new URLSearchParams({ ...Object.fromEntries(baseQuery), page: String(page - 1), limit: String(limit) })}`,
        method: 'GET',
        rel: 'prev'
      };
    }

    // Next page
    if (page < totalPages) {
      links.next = {
        href: `${baseUrl}/${resource}?${new URLSearchParams({ ...Object.fromEntries(baseQuery), page: String(page + 1), limit: String(limit) })}`,
        method: 'GET',
        rel: 'next'
      };
    }
  }

  return links;
}

/**
 * Generate relationship links for a resource
 */
export function generateRelationshipLinks(
  resource: string,
  id: string,
  baseUrl: string,
  relationships: Record<string, { resource: string; many?: boolean }>
): Record<string, { href: string; method: string; rel: string }> {
  const links: Record<string, { href: string; method: string; rel: string }> = {};

  Object.entries(relationships).forEach(([relationName, config]) => {
    const relationHref = `${baseUrl}/${resource}/${id}/${relationName}`;
    
    links[relationName] = {
      href: relationHref,
      method: 'GET',
      rel: 'related'
    };

    // Add creation/management links for relationships
    if (config.many) {
      links[`add_${relationName}`] = {
        href: relationHref,
        method: 'POST',
        rel: 'add-related'
      };
      
      links[`remove_${relationName}`] = {
        href: relationHref,
        method: 'DELETE',
        rel: 'remove-related'
      };
    }
  });

  return links;
}

/**
 * Generate action links for a resource
 */
export function generateActionLinks(
  resource: string,
  id: string,
  baseUrl: string,
  actions: Record<string, { method: string; path?: string }>
): Record<string, { href: string; method: string; rel: string }> {
  const links: Record<string, { href: string; method: string; rel: string }> = {};

  Object.entries(actions).forEach(([actionName, config]) => {
    const actionPath = config.path || actionName;
    links[actionName] = {
      href: `${baseUrl}/${resource}/${id}/${actionPath}`,
      method: config.method,
      rel: 'action'
    };
  });

  return links;
}

/**
 * Comprehensive HATEOAS link generator for any resource
 */
export function generateComprehensiveLinks(
  resource: string,
  id: string,
  baseUrl: string,
  options: {
    crudActions?: string[];
    relationships?: Record<string, { resource: string; many?: boolean }>;
    customActions?: Record<string, { method: string; path?: string }>;
    additionalLinks?: Record<string, string>;
  } = {}
): Record<string, { href: string; method: string; rel: string }> {
  const {
    crudActions = ['read', 'update', 'delete'],
    relationships = {},
    customActions = {},
    additionalLinks = {}
  } = options;

  // Generate base CRUD links
  const crudLinks = generateResourceLinks(resource, id, baseUrl, crudActions, additionalLinks);
  
  // Generate relationship links
  const relationshipLinks = generateRelationshipLinks(resource, id, baseUrl, relationships);
  
  // Generate action links
  const actionLinks = generateActionLinks(resource, id, baseUrl, customActions);

  return {
    ...crudLinks,
    ...relationshipLinks,
    ...actionLinks
  };
}