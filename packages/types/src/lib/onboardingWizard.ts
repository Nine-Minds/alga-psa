export interface WizardData {
  // Tenant Info
  firstName: string;
  lastName: string;
  tenantName: string;
  email: string;
  newPassword?: string;
  confirmPassword?: string;
  locale?: string;

  // Team Members
  teamMembers: TeamMember[];
  createdTeamMemberEmails?: string[]; // Track which team members have been created
  invitedTeamMemberEmails?: string[]; // Track which team members have been sent an email invite (not yet created)

  // Client Info
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  clientUrl: string;
  clientId?: string; // Added for tracking created client

  // Client Contact
  contactName: string;
  contactEmail: string;
  contactRole: string;
  contactId?: string; // Track created contact

  // Billing
  serviceName: string;
  serviceDescription: string;
  servicePrice: string;
  serviceBillingMode?: 'fixed' | 'hourly' | 'usage';
  contractLineName: string;
  serviceTypeId?: string; // Selected service type
  serviceId?: string; // Track created service
  currencyCode: string; // Default currency for pricing (e.g. 'USD')

  // Ticketing
  boardName: string;
  supportEmail: string;
  categories: any[];
  priorities: (
    | string
    | {
        priority_id: string;
        priority_name: string;
        color?: string;
        order_number?: number;
      }
  )[];
  ticketPrefix?: string;
  ticketPaddingLength?: number;
  ticketStartNumber?: number;
  boardId?: string;
  statusesImported?: boolean;
  statuses?: any[];

  // ITIL Configuration
  is_itil_compliant?: boolean;
  importBoardItilSettings?: Record<string, boolean>;

  // Wizard progress (persisted so a refresh resumes on the same step)
  currentStep?: number;
}

export interface TeamMember {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  password?: string;
  /** 'email' (default): send an invite link the invitee sets their own password with.
   *  'password': admin sets a temporary password now (legacy flow). */
  inviteMode?: 'email' | 'password';
}

export interface OnboardingState {
  currentStep: number;
  completedSteps: number[];
  data: WizardData;
  isComplete: boolean;
}

export interface StepProps {
  data: WizardData;
  updateData: (data: Partial<WizardData>) => void;
  attemptedToProceed?: boolean;
}

export const ONBOARDING_WIZARD_STEPS = [
  'Client Info',
  'Team Members',
  'Add Client',
  'Client Contact',
  'Billing',
  'Ticketing',
];

export const ONBOARDING_WIZARD_REQUIRED_STEP_INDEXES = [0, 5]; // Client Info and Ticketing are required
