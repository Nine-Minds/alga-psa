'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { Card } from 'server/src/components/ui/Card';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import { getCurrentUser, getUserRolesWithPermissions, getUserCompanyId } from 'server/src/lib/actions/user-actions/userActions';
import { getCompanyById, updateCompany, uploadCompanyLogo, removeCompanyLogo } from 'server/src/lib/actions/companyActions';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { IPermission } from 'server/src/interfaces/auth.interfaces';
import CompanyAvatar from 'server/src/components/ui/CompanyAvatar';

export function CompanyDetailsSettings() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false); // General form saving
  const [isPendingUpload, startUploadTransition] = useTransition();
  const [isPendingRemove, startRemoveTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [companyDetails, setCompanyDetails] = useState<ICompany | null>(null);
  useEffect(() => {
    async function loadData() {
      try {
        // Get current user and their roles with permissions
        const user = await getCurrentUser();
        if (!user) {
          router.push('/auth/signin');
          return;
        }

        const rolesWithPermissions = await getUserRolesWithPermissions(user.user_id);
        
        // Check if user has required permissions
        const hasRequiredPermissions = rolesWithPermissions.some(role => 
          role.permissions.some((permission: IPermission) => 
            `${permission.resource}.${permission.action}` === 'company_setting.read' || 
            `${permission.resource}.${permission.action}` === 'company_setting.update' ||
            `${permission.resource}.${permission.action}` === 'company_setting.delete'
          )
        );

        if (!hasRequiredPermissions) {
          setError('You do not have permission to access company settings');
          return;
        }

        // Get company ID
        const userCompanyId = await getUserCompanyId(user.user_id);
        if (!userCompanyId) {
          setError('Company not found');
          return;
        }

        // Load company details
        const company = await getCompanyById(userCompanyId);
        if (!company) {
          setError('Failed to load company details');
          return;
        }

        setCompanyDetails(company);
      } catch (error) {
        console.error('Error loading company details:', error);
        setError('Failed to load company details');
      }
    }

    loadData();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyDetails?.company_id) return;

    setIsLoading(true);
    try {
      const updatedCompany = await updateCompany(companyDetails.company_id, {
        company_name: companyDetails.company_name,
        phone_no: companyDetails.phone_no,
        email: companyDetails.email,
        url: companyDetails.url,
        address: companyDetails.address,
        properties: {
          ...companyDetails.properties,
          industry: companyDetails.properties?.industry
        }
      });
      setCompanyDetails(updatedCompany);
    } catch (error) {
      console.error('Failed to update company details:', error);
      setError('Failed to update company details');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !companyDetails?.company_id) return;

    const companyId = companyDetails.company_id;
    const formData = new FormData();
    formData.append('logo', file);

    startUploadTransition(async () => {
      try {
        const result = await uploadCompanyLogo(companyId, formData);
        if (result.success) {
          // Refetch company details to get updated logoUrl
          const updatedCompany = await getCompanyById(companyId);
          if (updatedCompany) {
            setCompanyDetails(updatedCompany);
          }
          toast.success(result.message || 'Company logo uploaded successfully.');
        } else {
          throw new Error(result.message || 'Failed to upload logo.');
        }
      } catch (err: any) {
        console.error('Failed to upload logo:', err);
        toast.error(err.message || 'Failed to upload logo.');
        // Optionally reset the file input if needed
        e.target.value = '';
      }
    });
  };

  const handleRemoveLogo = () => {
    if (!companyDetails?.company_id) return;
    const companyId = companyDetails.company_id;

    startRemoveTransition(async () => {
      try {
        const result = await removeCompanyLogo(companyId);
        if (result.success) {
           // Refetch company details to get updated logoUrl (should be null)
           const updatedCompany = await getCompanyById(companyId);
           if (updatedCompany) {
             setCompanyDetails(updatedCompany);
           }
          toast.success(result.message || 'Company logo removed successfully.');
        } else {
          throw new Error(result.message || 'Failed to remove logo.');
        }
      } catch (err: any) {
        console.error('Failed to remove logo:', err);
        toast.error(err.message || 'Failed to remove logo.');
      }
    });
  };

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4">
        <p className="text-red-800">{error}</p>
      </div>
    );
  }

  if (!companyDetails) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
        <div className="h-32 bg-gray-200 rounded"></div>
      </div>
    );
  }

  return (
    <Card className="p-6">
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Logo Upload Section */}
        <div className="mb-6">
          <h3 className="text-lg font-medium mb-4">Company Logo</h3>
          <div className="flex items-center space-x-4">
            <div className="w-24 h-24 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center overflow-hidden">
              <CompanyAvatar
                companyId={companyDetails.company_id}
                companyName={companyDetails.company_name}
                logoUrl={companyDetails.logoUrl ?? null}
                size="lg" // Adjust size as needed
                className="w-full h-full" // Ensure it fills the container
              />
            </div>
            <div className="flex flex-col space-y-2">
              <Input
                id="logo-upload"
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                disabled={isPendingUpload || isPendingRemove}
                className="mb-1"
              />
              <p className="text-sm text-gray-500">
                Max file size: 2MB. PNG, JPG, GIF.
              </p>
              {companyDetails.logoUrl && (
                 <Button
                   id="remove-company-logo"
                   type="button"
                   variant="destructive"
                   size="sm"
                   onClick={handleRemoveLogo}
                   disabled={isPendingRemove || isPendingUpload}
                   className="w-fit"
                 >
                   {isPendingRemove ? 'Removing...' : 'Remove Logo'}
                 </Button>
               )}
               {isPendingUpload && <p className="text-sm text-blue-600">Uploading...</p>}
            </div>
          </div>
        </div>

        {/* Company Information */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Company Name
            </label>
            <Input
              type="text"
              value={companyDetails.company_name}
              onChange={(e) => setCompanyDetails(prev => prev ? {
                ...prev,
                company_name: e.target.value
              } : null)}
              placeholder="Enter company name"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Phone Number
            </label>
            <Input
              type="tel"
              value={companyDetails.phone_no}
              onChange={(e) => setCompanyDetails(prev => prev ? {
                ...prev,
                phone_no: e.target.value
              } : null)}
              placeholder="Enter phone number"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <Input
              type="email"
              value={companyDetails.email}
              onChange={(e) => setCompanyDetails(prev => prev ? {
                ...prev,
                email: e.target.value
              } : null)}
              placeholder="Enter email address"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Website
            </label>
            <Input
              type="url"
              value={companyDetails.url}
              onChange={(e) => setCompanyDetails(prev => prev ? {
                ...prev,
                url: e.target.value
              } : null)}
              placeholder="Enter website URL"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Industry
            </label>
            <Input
              type="text"
              value={companyDetails.properties?.industry || ''}
              onChange={(e) => setCompanyDetails(prev => prev ? {
                ...prev,
                properties: {
                  ...prev.properties,
                  industry: e.target.value
                }
              } : null)}
              placeholder="Enter industry"
            />
          </div>
        </div>

        {/* Address Information */}
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Address Information</h3>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Address
            </label>
            <Input
              type="text"
              value={companyDetails.address}
              onChange={(e) => setCompanyDetails(prev => prev ? {
                ...prev,
                address: e.target.value
              } : null)}
              placeholder="Enter address"
            />
          </div>
        </div>

        {/* Submit Button */}
        <div className="flex justify-end">
          <Button
            id="save-company-details"
            type="submit"
            disabled={isLoading}
            className="w-full md:w-auto"
          >
            {isLoading ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
