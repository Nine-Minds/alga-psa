'use client';

import type { IClient, IContact, IDocument, IInteraction, ITag } from '@alga-psa/types';
import ContactBentoLayout from './ContactBentoLayout';
import type {
  ContactPortalSummary,
  ContactRelatedWorkSummary,
  ContactStatsSummary,
  ContactTicketsSummary,
} from '../../../actions/contact-actions/contactBentoActions';

interface ContactQuickViewProps {
  id?: string;
  contact: IContact;
  clients: IClient[];
  documents?: IDocument[];
  interactions?: IInteraction[];
  tags?: ITag[];
  stats?: ContactStatsSummary | null;
  ticketsSummary?: ContactTicketsSummary | null;
  relatedWork?: ContactRelatedWorkSummary | null;
  portalSummary?: ContactPortalSummary | null;
  userId?: string;
  userPermissions?: {
    canInvite: boolean;
    canUpdateRoles: boolean;
    canRead: boolean;
  };
  onContactUpdated?: () => Promise<void> | void;
  onChangesSaved?: () => void;
  onDocumentCreated?: () => Promise<void>;
}

export default function ContactQuickView(props: ContactQuickViewProps) {
  return <ContactBentoLayout {...props} id={props.id ?? 'contact-quick-view'} quickView />;
}
