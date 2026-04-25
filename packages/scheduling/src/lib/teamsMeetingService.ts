import logger from '@alga-psa/core/logger';
import { isEnterprise } from '@alga-psa/core/features';

export interface TeamsMeetingCapabilityResult {
  available: boolean;
  reason?: 'ee_disabled' | 'not_configured' | 'no_organizer';
}

export interface CreateTeamsMeetingInput {
  tenantId: string;
  subject: string;
  startDateTime: string;
  endDateTime: string;
  appointmentRequestId?: string | null;
}

export interface CreateTeamsMeetingResult {
  joinWebUrl: string;
  meetingId: string;
}

export interface UpdateTeamsMeetingInput {
  tenantId: string;
  meetingId: string;
  startDateTime: string;
  endDateTime: string;
  appointmentRequestId?: string | null;
}

export interface DeleteTeamsMeetingInput {
  tenantId: string;
  meetingId: string;
  appointmentRequestId?: string | null;
}

export interface TeamsMeetingService {
  getTeamsMeetingCapability: (tenantId: string) => Promise<TeamsMeetingCapabilityResult>;
  createTeamsMeeting: (input: CreateTeamsMeetingInput) => Promise<CreateTeamsMeetingResult | null>;
  updateTeamsMeeting: (input: UpdateTeamsMeetingInput) => Promise<boolean>;
  deleteTeamsMeeting: (input: DeleteTeamsMeetingInput) => Promise<boolean>;
}

type EeTeamsMeetingModule = Partial<TeamsMeetingService>;

const eeDisabledCapability: TeamsMeetingCapabilityResult = {
  available: false,
  reason: 'ee_disabled',
};

const noOpTeamsMeetingService: TeamsMeetingService = {
  async getTeamsMeetingCapability() {
    return eeDisabledCapability;
  },
  async createTeamsMeeting() {
    return null;
  },
  async updateTeamsMeeting() {
    return false;
  },
  async deleteTeamsMeeting() {
    return false;
  },
};

let eeTeamsMeetingModulePromise: Promise<EeTeamsMeetingModule> | null = null;

async function loadEeTeamsMeetingModule(): Promise<EeTeamsMeetingModule> {
  if (!eeTeamsMeetingModulePromise) {
    eeTeamsMeetingModulePromise = import('@alga-psa/ee-microsoft-teams/lib')
      .then((mod) => mod as EeTeamsMeetingModule)
      .catch((error) => {
        logger.warn('[TeamsMeetingService] Failed to load EE Teams meeting implementation', {
          error: error instanceof Error ? error.message : String(error),
        });
        return {} as EeTeamsMeetingModule;
      });
  }

  return eeTeamsMeetingModulePromise;
}

export async function resolveTeamsMeetingService(): Promise<TeamsMeetingService> {
  if (!isEnterprise) {
    return noOpTeamsMeetingService;
  }

  const ee = await loadEeTeamsMeetingModule();

  return {
    getTeamsMeetingCapability: ee.getTeamsMeetingCapability ?? noOpTeamsMeetingService.getTeamsMeetingCapability,
    createTeamsMeeting: ee.createTeamsMeeting ?? noOpTeamsMeetingService.createTeamsMeeting,
    updateTeamsMeeting: ee.updateTeamsMeeting ?? noOpTeamsMeetingService.updateTeamsMeeting,
    deleteTeamsMeeting: ee.deleteTeamsMeeting ?? noOpTeamsMeetingService.deleteTeamsMeeting,
  };
}
