import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseController } from './ApiBaseController';
import { MobileCapabilitiesService } from '../services/MobileCapabilitiesService';
import { runWithTenant } from '../../db';
import {
  createSuccessResponse,
  handleApiError,
} from '../middleware/apiMiddleware';

export class ApiMobileCapabilitiesController extends ApiBaseController {
  private mobileCapabilitiesService: MobileCapabilitiesService;

  constructor() {
    const mobileCapabilitiesService = new MobileCapabilitiesService();
    super(mobileCapabilitiesService, { resource: 'user' });
    this.mobileCapabilitiesService = mobileCapabilitiesService;
  }

  getMyCapabilities() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        return await runWithTenant(apiRequest.context.tenant, async () => {
          const capabilities = await this.mobileCapabilitiesService.getMyCapabilities(apiRequest.context);
          return createSuccessResponse(capabilities);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }
}
