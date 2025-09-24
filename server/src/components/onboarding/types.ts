export interface WizardData {
  // Company Info
  firstName: string;
  lastName: string;
  companyName: string;
  email: string;
  newPassword?: string;
  confirmPassword?: string;

  // Team Members
  teamMembers: TeamMember[];
  createdTeamMemberEmails?: string[]; // Track which team members have been created

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
  planName: string;
  serviceTypeId?: string; // Selected service type
  serviceId?: string; // Track created service

  // Ticketing
  channelName: string;
  supportEmail: string;
  categories: any[];
  priorities: (string | {
    priority_id: string;
    priority_name: string;
    color?: string;
    order_number?: number;
  })[];
  ticketPrefix?: string;
  ticketPaddingLength?: number;
  ticketStartNumber?: number;
  channelId?: string;
  statusesImported?: boolean;
  statuses?: any[];

  // ITIL Configuration
  is_itil_compliant?: boolean;
  importChannelItilSettings?: Record<string, boolean>;
}

export interface TeamMember {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  password?: string;
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

export const STEPS = [
  'Company Info',
  'Team Members',
  'Add Client',
  'Client Contact',
  'Billing',
  'Ticketing'
];

export const REQUIRED_STEPS = [0, 5]; // Company Info and Ticketing are required