/**
 * HATEOAS Service
 * Centralized service for generating consistent hypermedia links across all API resources
 * Implements REST Level 3 (Hypermedia Controls) for complete API discoverability
 */

import { 
  generateComprehensiveLinks, 
  generateCollectionLinks, 
  addHateoasLinks 
} from '@product/api/utils/responseHelpers';

export interface ResourceLinkConfig {
  resource: string;
  id: string;
  baseUrl: string;
  crudActions?: string[];
  relationships?: Record<string, { resource: string; many?: boolean }>;
  customActions?: Record<string, { method: string; path?: string }>;
  conditionalActions?: Record<string, {
    method: string;
    path?: string;
    condition: (resourceData: any) => boolean;
  }>;
  resourceSpecificLinks?: Record<string, string>;
}

export interface CollectionLinkConfig {
  resource: string;
  baseUrl: string;
  pagination?: { page: number; limit: number; total: number; totalPages: number };
  filters?: Record<string, any>;
  additionalActions?: Record<string, { method: string; path?: string }>;
}

export class HateoasService {
  /**
   * Generate comprehensive HATEOAS links for a single resource
   */
  static generateResourceLinks(config: ResourceLinkConfig): Record<string, { href: string; method: string; rel: string }> {
    const {
      resource,
      id,
      baseUrl,
      crudActions = ['read', 'update', 'delete'],
      relationships = {},
      customActions = {},
      conditionalActions = {},
      resourceSpecificLinks = {}
    } = config;

    // Generate base links
    const links = generateComprehensiveLinks(resource, id, baseUrl, {
      crudActions,
      relationships,
      customActions,
      additionalLinks: resourceSpecificLinks
    });

    return links;
  }

  /**
   * Generate HATEOAS links for collections
   */
  static generateCollectionLinks(config: CollectionLinkConfig): Record<string, { href: string; method: string; rel: string }> {
    const {
      resource,
      baseUrl,
      pagination,
      filters,
      additionalActions = {}
    } = config;

    const links = generateCollectionLinks(resource, baseUrl, pagination, filters);

    // Add additional custom actions
    Object.entries(additionalActions).forEach(([actionName, actionConfig]) => {
      links[actionName] = {
        href: `${baseUrl}/${resource}/${actionConfig.path || actionName}`,
        method: actionConfig.method,
        rel: 'action'
      };
    });

    return links;
  }

  /**
   * Add HATEOAS links to a resource response
   */
  static addLinksToResource<T extends Record<string, any>>(
    resource: T,
    config: ResourceLinkConfig
  ): T & { _links: Record<string, { href: string; method: string; rel: string }> } {
    const links = this.generateResourceLinks(config);
    return addHateoasLinks(resource, links);
  }

  /**
   * Add HATEOAS links to a collection of resources
   */
  static addLinksToCollection<T extends Record<string, any>>(
    resources: T[],
    resourceConfigs: Omit<ResourceLinkConfig, 'id'>[],
    collectionConfig: CollectionLinkConfig
  ): {
    data: Array<T & { _links: Record<string, { href: string; method: string; rel: string }> }>;
    _links: Record<string, { href: string; method: string; rel: string }>;
  } {
    // Add links to individual resources
    const enhancedResources = resources.map((resource, index) => {
      const config = resourceConfigs[index] || resourceConfigs[0]; // Use first config as fallback
      const fullConfig = {
        ...config,
        id: resource[`${config.resource.slice(0, -1)}_id`] || resource.id || String(index)
      };
      return this.addLinksToResource(resource, fullConfig);
    });

    // Generate collection links
    const collectionLinks = this.generateCollectionLinks(collectionConfig);

    return {
      data: enhancedResources,
      _links: collectionLinks
    };
  }

  /**
   * Resource-specific link generators for common API patterns
   */
  static getResourceConfig(resourceType: string, id: string, resourceData?: any): ResourceLinkConfig {
    const baseUrl = '/api/v1';
    
    const configs: Record<string, Omit<ResourceLinkConfig, 'id'>> = {
      teams: {
        resource: 'teams',
        baseUrl,
        crudActions: ['read', 'update', 'delete'],
        relationships: {
          members: { resource: 'users', many: true },
          projects: { resource: 'projects', many: true },
          manager: { resource: 'users', many: false }
        },
        customActions: {
          'add-member': { method: 'POST', path: 'members' },
          'remove-member': { method: 'DELETE', path: 'members' },
          'assign-manager': { method: 'PUT', path: 'manager' },
          'assign-project': { method: 'POST', path: 'projects' },
          analytics: { method: 'GET', path: 'analytics' },
          permissions: { method: 'GET', path: 'permissions' },
          hierarchy: { method: 'GET', path: 'hierarchy' },
          capacity: { method: 'GET', path: 'capacity' }
        }
      },

      webhooks: {
        resource: 'webhooks',
        baseUrl,
        crudActions: ['read', 'update', 'delete'],
        relationships: {
          subscriptions: { resource: 'webhook-subscriptions', many: true },
          templates: { resource: 'webhook-templates', many: true }
        },
        customActions: {
          test: { method: 'POST', path: 'test' },
          deliveries: { method: 'GET', path: 'deliveries' },
          analytics: { method: 'GET', path: 'analytics' },
          retry: { method: 'POST', path: 'retry' }
        }
      },

      tickets: {
        resource: 'tickets',
        baseUrl,
        crudActions: ['read', 'update', 'delete'],
        relationships: {
          comments: { resource: 'ticket-comments', many: true },
          attachments: { resource: 'ticket-attachments', many: true },
          timeEntries: { resource: 'time-entries', many: true },
          assignee: { resource: 'users', many: false },
          project: { resource: 'projects', many: false }
        },
        customActions: {
          assign: { method: 'PUT', path: 'assign' },
          'change-status': { method: 'PUT', path: 'status' },
          'add-comment': { method: 'POST', path: 'comments' },
          'log-time': { method: 'POST', path: 'time-entries' },
          escalate: { method: 'POST', path: 'escalate' },
          'add-attachment': { method: 'POST', path: 'attachments' }
        }
      },

      projects: {
        resource: 'projects',
        baseUrl,
        crudActions: ['read', 'update', 'delete'],
        relationships: {
          tickets: { resource: 'tickets', many: true },
          timeEntries: { resource: 'time-entries', many: true },
          teams: { resource: 'teams', many: true },
          client: { resource: 'clients', many: false },
          manager: { resource: 'users', many: false }
        },
        customActions: {
          'assign-team': { method: 'POST', path: 'teams' },
          'change-status': { method: 'PUT', path: 'status' },
          analytics: { method: 'GET', path: 'analytics' },
          billing: { method: 'GET', path: 'billing' },
          'time-tracking': { method: 'GET', path: 'time-tracking' }
        }
      },

      users: {
        resource: 'users',
        baseUrl,
        crudActions: ['read', 'update', 'delete'],
        relationships: {
          teams: { resource: 'teams', many: true },
          roles: { resource: 'roles', many: true },
          permissions: { resource: 'permissions', many: true },
          timeEntries: { resource: 'time-entries', many: true }
        },
        customActions: {
          'assign-role': { method: 'POST', path: 'roles' },
          'change-password': { method: 'PUT', path: 'password' },
          permissions: { method: 'GET', path: 'permissions' },
          profile: { method: 'GET', path: 'profile' },
          activate: { method: 'PUT', path: 'activate' },
          deactivate: { method: 'PUT', path: 'deactivate' }
        }
      },

      invoices: {
        resource: 'invoices',
        baseUrl,
        crudActions: ['read', 'update', 'delete'],
        relationships: {
          lineItems: { resource: 'invoice-line-items', many: true },
          payments: { resource: 'payments', many: true },
          client: { resource: 'clients', many: false },
          project: { resource: 'projects', many: false }
        },
        customActions: {
          send: { method: 'POST', path: 'send' },
          'mark-paid': { method: 'PUT', path: 'mark-paid' },
          'add-payment': { method: 'POST', path: 'payments' },
          'generate-pdf': { method: 'GET', path: 'pdf' },
          'change-status': { method: 'PUT', path: 'status' },
          void: { method: 'PUT', path: 'void' }
        }
      },

      roles: {
        resource: 'roles',
        baseUrl,
        crudActions: ['read', 'update', 'delete'],
        relationships: {
          permissions: { resource: 'permissions', many: true },
          users: { resource: 'users', many: true }
        },
        customActions: {
          'assign-permission': { method: 'POST', path: 'permissions' },
          'remove-permission': { method: 'DELETE', path: 'permissions' },
          clone: { method: 'POST', path: 'clone' },
          'bulk-assign': { method: 'POST', path: 'bulk-assign' }
        }
      },

      permissions: {
        resource: 'permissions',
        baseUrl,
        crudActions: ['read', 'update', 'delete'],
        relationships: {
          roles: { resource: 'roles', many: true }
        },
        customActions: {
          check: { method: 'POST', path: 'check' },
          'bulk-check': { method: 'POST', path: 'bulk-check' }
        }
      }
    };

    const config = configs[resourceType];
    if (!config) {
      throw new Error(`Unknown resource type: ${resourceType}`);
    }

    return {
      ...config,
      id
    };
  }

  /**
   * Generate standard API discovery links
   */
  static generateApiDiscoveryLinks(baseUrl: string = '/api/v1'): Record<string, { href: string; method: string; rel: string }> {
    return {
      self: {
        href: baseUrl,
        method: 'GET',
        rel: 'self'
      },
      documentation: {
        href: `${baseUrl}/docs`,
        method: 'GET',
        rel: 'documentation'
      },
      openapi: {
        href: `${baseUrl}/meta/openapi`,
        method: 'GET',
        rel: 'openapi-spec'
      },
      health: {
        href: `${baseUrl}/meta/health`,
        method: 'GET',
        rel: 'health-check'
      },
      teams: {
        href: `${baseUrl}/teams`,
        method: 'GET',
        rel: 'collection'
      },
      users: {
        href: `${baseUrl}/users`,
        method: 'GET',
        rel: 'collection'
      },
      projects: {
        href: `${baseUrl}/projects`,
        method: 'GET',
        rel: 'collection'
      },
      tickets: {
        href: `${baseUrl}/tickets`,
        method: 'GET',
        rel: 'collection'
      },
      invoices: {
        href: `${baseUrl}/invoices`,
        method: 'GET',
        rel: 'collection'
      },
      roles: {
        href: `${baseUrl}/roles`,
        method: 'GET',
        rel: 'collection'
      },
      permissions: {
        href: `${baseUrl}/permissions`,
        method: 'GET',
        rel: 'collection'
      },
      webhooks: {
        href: `${baseUrl}/webhooks`,
        method: 'GET',
        rel: 'collection'
      }
    };
  }

  /**
   * Generate state-aware action links based on resource state
   */
  static generateStateAwareLinks(
    resourceType: string,
    id: string,
    resourceData: any,
    baseUrl: string = '/api/v1'
  ): Record<string, { href: string; method: string; rel: string }> {
    const links: Record<string, { href: string; method: string; rel: string }> = {};

    switch (resourceType) {
      case 'tickets':
        if (resourceData.status === 'open') {
          links['close'] = {
            href: `${baseUrl}/tickets/${id}/close`,
            method: 'PUT',
            rel: 'action'
          };
        }
        if (resourceData.status === 'closed') {
          links['reopen'] = {
            href: `${baseUrl}/tickets/${id}/reopen`,
            method: 'PUT',
            rel: 'action'
          };
        }
        if (!resourceData.assignee_id) {
          links['assign'] = {
            href: `${baseUrl}/tickets/${id}/assign`,
            method: 'PUT',
            rel: 'action'
          };
        }
        break;

      case 'invoices':
        if (resourceData.status === 'draft') {
          links['send'] = {
            href: `${baseUrl}/invoices/${id}/send`,
            method: 'POST',
            rel: 'action'
          };
        }
        if (resourceData.status === 'sent' && !resourceData.paid_at) {
          links['mark-paid'] = {
            href: `${baseUrl}/invoices/${id}/mark-paid`,
            method: 'PUT',
            rel: 'action'
          };
        }
        break;

      case 'projects':
        if (resourceData.status === 'planning') {
          links['start'] = {
            href: `${baseUrl}/projects/${id}/start`,
            method: 'PUT',
            rel: 'action'
          };
        }
        if (resourceData.status === 'active') {
          links['complete'] = {
            href: `${baseUrl}/projects/${id}/complete`,
            method: 'PUT',
            rel: 'action'
          };
        }
        break;

      case 'users':
        if (resourceData.is_inactive) {
          links['activate'] = {
            href: `${baseUrl}/users/${id}/activate`,
            method: 'PUT',
            rel: 'action'
          };
        } else {
          links['deactivate'] = {
            href: `${baseUrl}/users/${id}/deactivate`,
            method: 'PUT',
            rel: 'action'
          };
        }
        break;
    }

    return links;
  }
}