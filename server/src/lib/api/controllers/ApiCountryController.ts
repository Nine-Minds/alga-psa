import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseController } from './ApiBaseController';
import { CountryService } from '../services/CountryService';
import { runWithTenant } from '../../db';
import { createSuccessResponse, handleApiError } from '../middleware/apiMiddleware';

/** Any authenticated user may read countries; they gate nothing on their own. */
export class ApiCountryController extends ApiBaseController {
  private countryService: CountryService;

  constructor() {
    const countryService = new CountryService();
    super(countryService, { resource: 'country' });
    this.countryService = countryService;
  }

  list() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await runWithTenant(apiRequest.context.tenant, async () => {
          const countries = await this.countryService.listActive(apiRequest.context);
          return createSuccessResponse(countries);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }
}
