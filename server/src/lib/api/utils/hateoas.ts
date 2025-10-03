/**
 * HATEOAS (Hypermedia as the Engine of Application State) Utilities
 * Provides functionality to generate hypermedia links for API responses
 */

export interface HateoasLink {
  href: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  rel?: string;
  type?: string;
}

export interface HateoasLinks {
  self?: HateoasLink;
  edit?: HateoasLink;
  delete?: HateoasLink;
  create?: HateoasLink;
  list?: HateoasLink;
  [key: string]: HateoasLink | undefined;
}

/**
 * Generate standard HATEOAS links for a resource
 */
export function getHateoasLinks(
  resourceType: string,
  resourceId: string,
  baseUrl: string = '/api/v1'
): HateoasLinks {
  const resourcePath = `${baseUrl}/${resourceType}s`;
  const resourceDetailPath = `${resourcePath}/${resourceId}`;

  return {
    self: {
      href: resourceDetailPath,
      method: 'GET'
    },
    edit: {
      href: resourceDetailPath,
      method: 'PUT'
    },
    delete: {
      href: resourceDetailPath,
      method: 'DELETE'
    },
    list: {
      href: resourcePath,
      method: 'GET'
    }
  };
}

/**
 * Generate links for specific resource types
 */
export const resourceLinks = {
  client: (id: string) => getClientLinks(id),
  contact: (id: string) => getContactLinks(id),
  project: (id: string) => getProjectLinks(id),
  ticket: (id: string) => getTicketLinks(id),
  asset: (id: string) => getAssetLinks(id),
  invoice: (id: string) => getInvoiceLinks(id),
  user: (id: string) => getUserLinks(id),
  team: (id: string) => getTeamLinks(id),
  webhook: (id: string) => getWebhookLinks(id),
  workflow: (id: string) => getWorkflowLinks(id)
};

/**
 * Client-specific HATEOAS links
 */
function getClientLinks(id: string): HateoasLinks {
  const base = getHateoasLinks('client', id);
  return {
    ...base,
    contacts: {
      href: `/api/v1/clients/${id}/contacts`,
      method: 'GET'
    },
    locations: {
      href: `/api/v1/clients/${id}/locations`,
      method: 'GET'
    }
  };
}

/**
 * Contact-specific HATEOAS links
 */
function getContactLinks(id: string): HateoasLinks {
  const base = getHateoasLinks('contact', id);
  return {
    ...base,
    client: {
      href: `/api/v1/contacts/${id}/client`,
      method: 'GET'
    }
  };
}

/**
 * Project-specific HATEOAS links
 */
function getProjectLinks(id: string): HateoasLinks {
  const base = getHateoasLinks('project', id);
  return {
    ...base,
    phases: {
      href: `/api/v1/projects/${id}/phases`,
      method: 'GET'
    },
    tasks: {
      href: `/api/v1/projects/${id}/tasks`,
      method: 'GET'
    },
    tickets: {
      href: `/api/v1/projects/${id}/tickets`,
      method: 'GET'
    }
  };
}

/**
 * Ticket-specific HATEOAS links
 */
function getTicketLinks(id: string): HateoasLinks {
  const base = getHateoasLinks('ticket', id);
  return {
    ...base,
    comments: {
      href: `/api/v1/tickets/${id}/comments`,
      method: 'GET'
    },
    assignment: {
      href: `/api/v1/tickets/${id}/assignment`,
      method: 'PUT'
    },
    status: {
      href: `/api/v1/tickets/${id}/status`,
      method: 'PUT'
    }
  };
}

/**
 * Asset-specific HATEOAS links
 */
function getAssetLinks(id: string): HateoasLinks {
  const base = getHateoasLinks('asset', id);
  return {
    ...base,
    documents: {
      href: `/api/v1/assets/${id}/documents`,
      method: 'GET'
    },
    maintenance: {
      href: `/api/v1/assets/${id}/maintenance`,
      method: 'GET'
    },
    history: {
      href: `/api/v1/assets/${id}/history`,
      method: 'GET'
    }
  };
}

/**
 * Invoice-specific HATEOAS links
 */
function getInvoiceLinks(id: string): HateoasLinks {
  const base = getHateoasLinks('invoice', id);
  return {
    ...base,
    finalize: {
      href: `/api/v1/invoices/${id}/finalize`,
      method: 'POST'
    },
    send: {
      href: `/api/v1/invoices/${id}/send`,
      method: 'POST'
    },
    pdf: {
      href: `/api/v1/invoices/${id}/pdf`,
      method: 'GET'
    }
  };
}

/**
 * User-specific HATEOAS links
 */
function getUserLinks(id: string): HateoasLinks {
  const base = getHateoasLinks('user', id);
  return {
    ...base,
    roles: {
      href: `/api/v1/users/${id}/roles`,
      method: 'GET'
    },
    teams: {
      href: `/api/v1/users/${id}/teams`,
      method: 'GET'
    },
    permissions: {
      href: `/api/v1/users/${id}/permissions`,
      method: 'GET'
    }
  };
}

/**
 * Team-specific HATEOAS links
 */
function getTeamLinks(id: string): HateoasLinks {
  const base = getHateoasLinks('team', id);
  return {
    ...base,
    members: {
      href: `/api/v1/teams/${id}/members`,
      method: 'GET'
    },
    projects: {
      href: `/api/v1/teams/${id}/projects`,
      method: 'GET'
    }
  };
}

/**
 * Webhook-specific HATEOAS links
 */
function getWebhookLinks(id: string): HateoasLinks {
  const base = getHateoasLinks('webhook', id);
  return {
    ...base,
    test: {
      href: `/api/v1/webhooks/${id}/test`,
      method: 'POST'
    },
    deliveries: {
      href: `/api/v1/webhooks/${id}/deliveries`,
      method: 'GET'
    }
  };
}

/**
 * Workflow-specific HATEOAS links
 */
function getWorkflowLinks(id: string): HateoasLinks {
  const base = getHateoasLinks('workflow', id);
  return {
    ...base,
    execute: {
      href: `/api/v1/workflows/${id}/execute`,
      method: 'POST'
    },
    events: {
      href: `/api/v1/workflows/${id}/events`,
      method: 'GET'
    }
  };
}

/**
 * Add HATEOAS links to a resource object
 */
export function addHateoasLinks<T extends Record<string, any>>(
  resource: T,
  resourceType: string,
  idField: string = 'id'
): T & { _links: HateoasLinks } {
  const id = resource[idField];
  const linkGenerator = resourceLinks[resourceType as keyof typeof resourceLinks];
  
  const links = linkGenerator 
    ? linkGenerator(id)
    : getHateoasLinks(resourceType, id);

  return {
    ...resource,
    _links: links
  };
}