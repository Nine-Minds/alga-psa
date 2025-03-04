'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from 'server/src/components/ui/Card';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import { getCurrentUser, getUserRolesWithPermissions, getUserCompanyId } from 'server/src/lib/actions/user-actions/userActions';
import { getCompanyById, updateCompany } from 'server/src/lib/actions/companyActions';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { IPermission } from 'server/src/interfaces/auth.interfaces';

export function CompanyDetailsSettings() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
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

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !companyDetails?.company_id) return;

    try {
      // TODO: Implement logo upload server action
      // For now, just update the local state to show the preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setCompanyDetails(prev => prev ? {
          ...prev,
          properties: {
            ...prev.properties,
            logo: reader.result as string
          }
        } : null);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Failed to upload logo:', error);
      setError('Failed to upload logo');
    }
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
              {companyDetails.properties?.logo ? (
                <img 
                  src={companyDetails.properties.logo} 
                  alt="Company logo" 
                  className="w-full h-full object-contain"
                />
              ) : (
                <span className="text-gray-400">Logo</span>
              )}
            </div>
            <div>
              <Input
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                className="mb-2"
              />
              <p className="text-sm text-gray-500">
                Recommended size: 200x200px. Max file size: 2MB
              </p>
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
