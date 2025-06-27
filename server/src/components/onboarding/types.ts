export interface WizardData {
  // Company Info
  firstName: string;
  lastName: string;
  companyName: string;
  email: string;

  // Team Members
  teamMembers: TeamMember[];

  // Client Info
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  clientUrl: string;

  // Client Contact
  contactName: string;
  contactEmail: string;
  contactRole: string;

  // Billing
  serviceName: string;
  serviceDescription: string;
  servicePrice: string;
  planName: string;

  // Ticketing
  channelName: string;
  supportEmail: string;
  categories: string[];
  priorities: string[];
}

export interface TeamMember {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
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