'use client';

import React, { useState, useEffect } from 'react';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { Button } from 'server/src/components/ui/Button';
import { ExternalLink, Pen, Phone, Mail, Building, Calendar, User, MapPin } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { TagManager } from 'server/src/components/tags';
import { findTagsByEntityId } from 'server/src/lib/actions/tagActions';
import ContactAvatar from 'server/src/components/ui/ContactAvatar';
import { Card } from 'server/src/components/ui/Card';
import { useDrawer } from 'server/src/context/DrawerContext';
import CompanyDetailsDrawer from '../companies/CompanyDetailsDrawer';

interface ContactDetailsDrawerProps {
  contact: IContact;
  companies: ICompany[];
  onEdit?: () => void;
}

interface DetailRowProps {
  icon: React.ReactNode;
  label: string;
  value: string | null | undefined;
  href?: string;
  onClick?: () => void;
}

const DetailRow: React.FC<DetailRowProps> = ({ icon, label, value, href, onClick }) => {
  if (!value || value.trim() === '') {
    return (
      <div className="flex items-center gap-3 py-2 text-gray-400">
        {icon}
        <span className="text-sm">{label}: Not provided</span>
      </div>
    );
  }

  const content = (
    <div className="flex items-center gap-3 py-2">
      {icon}
      <div className="flex-1">
        <span className="text-sm text-gray-600">{label}:</span>
        <span className="ml-2 text-sm font-medium text-gray-900">{value}</span>
      </div>
    </div>
  );

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="block hover:bg-gray-50 rounded-md px-2 -mx-2 transition-colors"
      >
        {content}
      </a>
    );
  }

  if (onClick) {
    return (
      <button
        onClick={onClick}
        className="w-full text-left hover:bg-gray-50 rounded-md px-2 -mx-2 transition-colors"
      >
        {content}
      </button>
    );
  }

  return <div className="px-2 -mx-2">{content}</div>;
};

const ContactDetailsDrawer: React.FC<ContactDetailsDrawerProps> = ({ contact, companies, onEdit }) => {
  const router = useRouter();
  const { openDrawer } = useDrawer();
  const [tags, setTags] = useState<ITag[]>([]);
  const [isLoadingTags, setIsLoadingTags] = useState(true);

  useEffect(() => {
    const fetchTags = async () => {
      try {
        const contactTags = await findTagsByEntityId(contact.contact_name_id, 'contact');
        setTags(contactTags);
      } catch (error) {
        console.error('Error fetching contact tags:', error);
      } finally {
        setIsLoadingTags(false);
      }
    };

    fetchTags();
  }, [contact.contact_name_id]);

  const handlePopOut = () => {
    router.push(`/msp/contacts/${contact.contact_name_id}`);
  };

  const formatPhoneNumber = (phone: string | null | undefined) => {
    if (!phone) return null;
    // Basic phone formatting - you can enhance this as needed
    return phone.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');
  };

  const getCompanyName = () => {
    const company = companies.find(c => c.company_id === contact.company_id);
    return company?.company_name || 'Unknown Company';
  };

  const handleCompanyClick = () => {
    const company = companies.find(c => c.company_id === contact.company_id);
    if (company) {
      openDrawer(
        <CompanyDetailsDrawer company={company} />
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Contact Info */}
      <div className="flex items-start gap-4">
        <ContactAvatar
          contactId={contact.contact_name_id}
          contactName={`${contact.first_name} ${contact.last_name}`}
          size="xl"
        />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">
            {contact.first_name} {contact.last_name}
          </h1>
          {contact.title && (
            <p className="text-lg text-gray-600 mt-1">{contact.title}</p>
          )}
          <div className="flex items-center gap-2 mt-2">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              contact.is_inactive 
                ? 'bg-red-100 text-red-800' 
                : 'bg-green-100 text-green-800'
            }`}>
              {contact.is_inactive ? 'Inactive' : 'Active'}
            </span>
            {contact.is_primary && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                Primary Contact
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        <Button
          onClick={handlePopOut}
          variant="outline"
          size="sm"
          className="flex items-center gap-2"
        >
          <ExternalLink className="h-4 w-4" />
          Open Full View
        </Button>
        {onEdit && (
          <Button
            onClick={onEdit}
            variant="outline"
            size="sm"
            className="flex items-center gap-2"
          >
            <Pen className="h-4 w-4" />
            Edit
          </Button>
        )}
      </div>

      {/* Contact Information */}
      <Card className="p-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Contact Information</h3>
        <div className="space-y-1">
          <DetailRow
            icon={<Phone className="h-4 w-4 text-gray-500" />}
            label="Phone"
            value={formatPhoneNumber(contact.phone_no)}
            href={contact.phone_no ? `tel:${contact.phone_no}` : undefined}
          />
          <DetailRow
            icon={<Mail className="h-4 w-4 text-gray-500" />}
            label="Email"
            value={contact.email}
            href={contact.email ? `mailto:${contact.email}` : undefined}
          />
          <DetailRow
            icon={<Building className="h-4 w-4 text-gray-500" />}
            label="Company"
            value={contact.company_id ? getCompanyName() : null}
            onClick={contact.company_id ? handleCompanyClick : undefined}
          />
          <DetailRow
            icon={<MapPin className="h-4 w-4 text-gray-500" />}
            label="Address"
            value={contact.address}
          />
        </div>
      </Card>

      {/* Contact Details */}
      <Card className="p-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Contact Details</h3>
        <div className="space-y-1">
          <DetailRow
            icon={<User className="h-4 w-4 text-gray-500" />}
            label="Title"
            value={contact.title}
          />
          <DetailRow
            icon={<Calendar className="h-4 w-4 text-gray-500" />}
            label="Created"
            value={contact.created_at ? new Date(contact.created_at).toLocaleDateString() : null}
          />
        </div>
      </Card>

      {/* Tags */}
      <Card className="p-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Tags</h3>
        {isLoadingTags ? (
          <div className="text-sm text-gray-500">Loading tags...</div>
        ) : (
          <TagManager
            entityId={contact.contact_name_id}
            entityType="contact"
            initialTags={tags}
            onTagsChange={setTags}
            readOnly={false}
          />
        )}
      </Card>

      {/* Notes */}
      {contact.notes && (
        <Card className="p-4">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Notes</h3>
          <div className="text-sm text-gray-700 whitespace-pre-wrap">
            {contact.notes}
          </div>
        </Card>
      )}
    </div>
  );
};

export default ContactDetailsDrawer;