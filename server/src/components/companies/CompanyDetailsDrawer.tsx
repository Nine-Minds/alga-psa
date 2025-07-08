'use client';

import React, { useState, useEffect } from 'react';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { Button } from 'server/src/components/ui/Button';
import { ExternalLink, Pen, Phone, Mail, Globe, MapPin, Building, Calendar, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { TagManager } from 'server/src/components/tags';
import { findTagsByEntityId } from 'server/src/lib/actions/tagActions';
import CompanyAvatar from 'server/src/components/ui/CompanyAvatar';
import { Card } from 'server/src/components/ui/Card';

interface CompanyDetailsDrawerProps {
  company: ICompany;
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

const CompanyDetailsDrawer: React.FC<CompanyDetailsDrawerProps> = ({ company, onEdit }) => {
  const router = useRouter();
  const [tags, setTags] = useState<ITag[]>([]);
  const [isLoadingTags, setIsLoadingTags] = useState(true);

  useEffect(() => {
    const fetchTags = async () => {
      try {
        const companyTags = await findTagsByEntityId(company.company_id, 'company');
        setTags(companyTags);
      } catch (error) {
        console.error('Error fetching company tags:', error);
      } finally {
        setIsLoadingTags(false);
      }
    };

    fetchTags();
  }, [company.company_id]);

  const handlePopOut = () => {
    router.push(`/msp/companies/${company.company_id}`);
  };

  const formatPhoneNumber = (phone: string | null | undefined) => {
    if (!phone) return null;
    // Basic phone formatting - you can enhance this as needed
    return phone.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');
  };

  const formatUrl = (url: string | null | undefined) => {
    if (!url) return null;
    return url.startsWith('http') ? url : `https://${url}`;
  };

  return (
    <div className="space-y-6">
      {/* Header with Company Info */}
      <div className="flex items-start gap-4">
        <CompanyAvatar
          companyId={company.company_id}
          companyName={company.company_name}
          logoUrl={company.logoUrl ?? null}
          size="xl"
        />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 truncate">
            {company.company_name}
          </h1>
          <div className="flex items-center gap-2 mt-2">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              company.is_inactive 
                ? 'bg-red-100 text-red-800' 
                : 'bg-green-100 text-green-800'
            }`}>
              {company.is_inactive ? 'Inactive' : 'Active'}
            </span>
            {company.client_type && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                {company.client_type}
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
            value={formatPhoneNumber(company.phone_no)}
            href={company.phone_no ? `tel:${company.phone_no}` : undefined}
          />
          <DetailRow
            icon={<Mail className="h-4 w-4 text-gray-500" />}
            label="Email"
            value={company.email}
            href={company.email ? `mailto:${company.email}` : undefined}
          />
          <DetailRow
            icon={<Globe className="h-4 w-4 text-gray-500" />}
            label="Website"
            value={company.url}
            href={formatUrl(company.url) || undefined}
          />
          <DetailRow
            icon={<MapPin className="h-4 w-4 text-gray-500" />}
            label="Address"
            value={company.address}
          />
        </div>
      </Card>

      {/* Company Details */}
      <Card className="p-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Company Details</h3>
        <div className="space-y-1">
          <DetailRow
            icon={<Building className="h-4 w-4 text-gray-500" />}
            label="Type"
            value={company.client_type}
          />
          <DetailRow
            icon={<Calendar className="h-4 w-4 text-gray-500" />}
            label="Created"
            value={company.created_at ? new Date(company.created_at).toLocaleDateString() : null}
          />
          <DetailRow
            icon={<User className="h-4 w-4 text-gray-500" />}
            label="Account Manager"
            value={company.account_manager_id ? 'Assigned' : 'Not assigned'}
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
            entityId={company.company_id}
            entityType="company"
            initialTags={tags}
            onTagsChange={setTags}
            readOnly={false}
          />
        )}
      </Card>

      {/* Notes */}
      {company.notes && (
        <Card className="p-4">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Notes</h3>
          <div className="text-sm text-gray-700 whitespace-pre-wrap">
            {company.notes}
          </div>
        </Card>
      )}
    </div>
  );
};

export default CompanyDetailsDrawer;