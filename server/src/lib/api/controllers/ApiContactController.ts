/**
 * API Contact Controller
 * Enhanced version with proper API key authentication
 */

import { ApiBaseController } from './ApiBaseController';
import { ContactService } from '../services/ContactService';
import { 
  createContactSchema,
  updateContactSchema,
  contactListQuerySchema,
  contactSearchSchema,
  contactExportQuerySchema
} from '../schemas/contact';
import { 
  withApiKeyAuth 
} from '../middleware/apiAuthMiddleware';
import {
  withPermission, 
  withQueryValidation,
  createSuccessResponse,
  createPaginatedResponse,
  NotFoundError,
  ApiRequest,
  compose
} from '../middleware/apiMiddleware';

export class ApiContactController extends ApiBaseController {
  private contactService: ContactService;

  constructor() {
    const contactService = new ContactService();
    
    super(contactService, {
      resource: 'contact',
      createSchema: createContactSchema,
      updateSchema: updateContactSchema,
      querySchema: contactListQuerySchema,
      permissions: {
        create: 'create',
        read: 'read',
        update: 'update',
        delete: 'delete',
        list: 'read'
      }
    });
    
    this.contactService = contactService;
  }

  /**
   * Search contacts
   */
  search() {
    const middleware = compose(
      withApiKeyAuth,
      withPermission('contact', 'read'),
      withQueryValidation(contactSearchSchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: any) => {
      const result = await this.contactService.searchContacts(
        validatedQuery,
        req.context!
      );

      return createSuccessResponse(result);
    });
  }

  /**
   * Export contacts
   */
  export() {
    const middleware = compose(
      withApiKeyAuth,
      withPermission('contact', 'read'),
      withQueryValidation(contactExportQuerySchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: any) => {
      const { format = 'csv', ...filters } = validatedQuery;
      
      const data = await this.contactService.exportContacts(
        filters,
        format,
        req.context!
      );

      if (format === 'csv') {
        return new Response(data as string, {
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': 'attachment; filename="contacts.csv"'
          }
        });
      }

      return createSuccessResponse(data);
    });
  }

  /**
   * Get contact statistics
   */
  stats() {
    const middleware = compose(
      withApiKeyAuth,
      withPermission('contact', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const stats = await this.contactService.getStatistics(req.context!);
      
      return createSuccessResponse(stats);
    });
  }

  /**
   * Helper to extract ID from request path
   */
  private extractIdFromPath(req: ApiRequest): string {
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/');
    const idIndex = pathParts.findIndex(part => part === 'contacts') + 1;
    return pathParts[idIndex] || '';
  }
}