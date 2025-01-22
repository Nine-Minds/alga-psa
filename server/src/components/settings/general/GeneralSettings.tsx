'use client'

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { Checkbox } from "@/components/ui/Checkbox";
import { Plus, Trash } from 'lucide-react';
import toast from 'react-hot-toast';
import { getTenantDetails, updateTenantName, addCompanyToTenant, removeCompanyFromTenant, setDefaultCompany } from "@/lib/actions/tenantActions";
import { getAllCompanies } from "@/lib/actions/companyActions";
import { CompanyPicker } from "@/components/companies/CompanyPicker";
import { ICompany } from "@/interfaces/company.interfaces";

const GeneralSettings = () => {
  const [tenantName, setTenantName] = React.useState('');
  const [companies, setCompanies] = React.useState<{ id: string; name: string; isDefault: boolean }[]>([]);

  React.useEffect(() => {
    loadTenantData();
  }, []);
  const [selectedCompanyId, setSelectedCompanyId] = React.useState<string | null>(null);
  const [allCompanies, setAllCompanies] = React.useState<ICompany[]>([]);

  const loadTenantData = async () => {
    try {
      const tenant = await getTenantDetails();
      setTenantName(tenant.company_name);
      setCompanies(tenant.companies.map(c => ({
        id: c.company_id,
        name: c.company_name,
        isDefault: c.is_default
      })));
    } catch (error) {
      toast.error("Failed to load tenant data");
    }
  };

  const handleSaveTenantName = async () => {
    try {
      await updateTenantName(tenantName);
      toast.success("Tenant name updated successfully");
    } catch (error) {
      toast.error("Failed to update tenant name");
    }
  };

  const handleAddCompany = async () => {
    if (!selectedCompanyId) {
      toast.error("Please select a company");
      return;
    }

    try {
      const companyToAdd = allCompanies.find(c => c.company_id === selectedCompanyId);
      if (!companyToAdd) {
        throw new Error("Company not found");
      }

      const newCompany = {
        id: companyToAdd.company_id,
        name: companyToAdd.company_name,
        isDefault: companies.length === 0
      };
      
      await addCompanyToTenant(newCompany.id);
      setCompanies([...companies, newCompany]);
      setSelectedCompanyId(null);
      
      if (newCompany.isDefault) {
        await setDefaultCompany(newCompany.id);
      }

      toast.success("Company added successfully");
    } catch (error) {
      toast.error("Failed to add company");
    }
  };

  React.useEffect(() => {
    const loadCompanies = async () => {
      try {
        const companies = await getAllCompanies();
        setAllCompanies(companies);
      } catch (error) {
        toast.error("Failed to load companies");
      }
    };
    loadCompanies();
  }, []);

  const handleRemoveCompany = async (companyId: string) => {
    try {
      await removeCompanyFromTenant(companyId);
      setCompanies(companies.filter(c => c.id !== companyId));
      toast.success("Company removed successfully");
    } catch (error) {
      toast.error("Failed to remove company");
    }
  };

  const handleSetDefaultCompany = async (companyId: string) => {
    try {
      await setDefaultCompany(companyId);
      setCompanies(companies.map(c => ({
        ...c,
        isDefault: c.id === companyId
      })));
      toast.success("Default company updated successfully");
    } catch (error) {
      toast.error("Failed to set default company");
    }
  };

  return (
    <Card>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div>
            <Label htmlFor="tenantName">Organization Name</Label>
            <Input
              id="tenantName"
              value={tenantName}
              onChange={(e) => setTenantName(e.target.value)}
            />
          </div>
          <Button 
            id="save-tenant-name-button"
            onClick={handleSaveTenantName}
          >
            Save Organization Name
          </Button>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Companies</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Default</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((company) => (
                <TableRow key={company.id}>
                  <TableCell>{company.name}</TableCell>
                  <TableCell>
                    <Checkbox
                      id={`default-company-checkbox-${company.id}`}
                      checked={company.isDefault}
                      onChange={() => handleSetDefaultCompany(company.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      id={`remove-company-button-${company.id}`}
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveCompany(company.id)}
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="space-y-4">
            <CompanyPicker
              id="tenant-company-picker"
              companies={allCompanies}
              onSelect={setSelectedCompanyId}
              selectedCompanyId={selectedCompanyId}
              filterState="all"
              onFilterStateChange={() => {}}
              clientTypeFilter="all"
              onClientTypeFilterChange={() => {}}
            />
            <Button
              onClick={handleAddCompany}
              id="add-company-button"
              disabled={!selectedCompanyId}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Company
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default GeneralSettings;