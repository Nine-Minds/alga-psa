'use client';

import React, { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { DataTable } from 'server/src/components/ui/DataTable';
import { Switch } from 'server/src/components/ui/Switch';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { Upload, AlertTriangle, Check, Download } from 'lucide-react';
import { parseCSV } from 'server/src/lib/utils/csvParser';
import { checkExistingCompanies, importCompaniesFromCSV } from 'server/src/lib/actions/company-actions/companyActions';

interface CompaniesImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: (companies: ICompany[], updateExisting: boolean) => void;
}

type MappableCompanyField = 
  | 'company_name'
  | 'phone_no'
  | 'email'
  | 'url'
  | 'address'
  | 'client_type'
  | 'is_inactive'
  | 'notes'
  // Location fields
  | 'location_name'
  | 'address_line1'
  | 'address_line2'
  | 'address_line3'
  | 'city'
  | 'state_province'
  | 'postal_code'
  | 'country_code'
  | 'country_name'
  | 'is_billing_address'
  | 'is_shipping_address'
  | 'is_default'
  | 'location_phone'
  | 'location_fax'
  | 'location_email'
  | 'location_notes'
  | 'is_location_active';

interface ICSVColumnMapping {
  csvHeader: string;
  companyField: MappableCompanyField | null;
}

interface ICSVPreviewData {
  headers: string[];
  rows: string[][];
}

interface ICSVValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  data: Record<string, any>;
  isExisting?: boolean;
}

interface ImportOptions {
  updateExisting: boolean;
  skipInvalid: boolean;
}

const COMPANY_FIELDS: Record<MappableCompanyField, string> = {
  company_name: 'Company Name',
  phone_no: 'Phone Number',
  email: 'Email',
  url: 'URL',
  address: 'Address',
  client_type: 'Client Type',
  is_inactive: 'Is Inactive',
  notes: 'Notes',
  // Location fields
  location_name: 'Location Name',
  address_line1: 'Address Line 1',
  address_line2: 'Address Line 2',
  address_line3: 'Address Line 3',
  city: 'City',
  state_province: 'State/Province',
  postal_code: 'Postal Code',
  country_code: 'Country Code',
  country_name: 'Country Name',
  is_billing_address: 'Is Billing Address',
  is_shipping_address: 'Is Shipping Address',
  is_default: 'Is Default Location',
  location_phone: 'Location Phone',
  location_fax: 'Location Fax',
  location_email: 'Location Email',
  location_notes: 'Location Notes',
  is_location_active: 'Is Location Active'
} as const;

const CompaniesImportDialog: React.FC<CompaniesImportDialogProps> = ({
  isOpen,
  onClose,
  onImportComplete,
}) => {
  const [step, setStep] = useState<'upload' | 'mapping' | 'preview' | 'importing' | 'complete'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<ICSVPreviewData | null>(null);
  const [columnMappings, setColumnMappings] = useState<ICSVColumnMapping[]>([]);
  const [validationResults, setValidationResults] = useState<ICSVValidationResult[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [importOptions, setImportOptions] = useState<ImportOptions>({
    updateExisting: false,
    skipInvalid: false
  });
  const [showUpdateConfirmation, setShowUpdateConfirmation] = useState(false);
  const [existingCompaniesCount, setExistingCompaniesCount] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showOptionalFields, setShowOptionalFields] = useState(false);

  const handleDownloadTemplate = async () => {
    try {
      const response = await fetch('/api/v1/companies/template');
      if (!response.ok) throw new Error('Failed to download template');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'companies_template.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading template:', error);
      setErrors(['Failed to download template']);
    }
  };

  const getFieldOptions = useCallback(() => {
    return [
      { value: 'unassigned', label: 'Select field' },
      ...Object.entries(COMPANY_FIELDS).map(([value, label]): { value: string; label: string } => ({
        value,
        label,
      })),
    ];
  }, []);

  const validateCompanyData = useCallback((mappedData: Record<string, any>): ICSVValidationResult => {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!mappedData.company_name) {
      errors.push('Company name is required');
    }

    if (mappedData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mappedData.email)) {
      errors.push('Invalid email format');
    }

    if (mappedData.credit_limit && isNaN(Number(mappedData.credit_limit))) {
      errors.push('Credit limit must be a number');
    }

    if (mappedData.auto_invoice && typeof mappedData.auto_invoice !== 'boolean') {
      warnings.push('Auto invoice should be true/false');
    }

    if (mappedData.is_inactive && typeof mappedData.is_inactive !== 'boolean') {
      warnings.push('Is inactive should be true/false');
    }

    if (mappedData.is_tax_exempt && typeof mappedData.is_tax_exempt !== 'boolean') {
      warnings.push('Is tax exempt should be true/false');
    }

    // Location field validation
    if (mappedData.location_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mappedData.location_email)) {
      errors.push('Invalid location email format');
    }

    if (mappedData.country_code && mappedData.country_code.length !== 2) {
      warnings.push('Country code should be 2 characters (e.g., US, CA)');
    }

    if (mappedData.is_billing_address && !['true', 'false', true, false].includes(mappedData.is_billing_address)) {
      warnings.push('Is billing address should be true/false');
    }

    if (mappedData.is_shipping_address && !['true', 'false', true, false].includes(mappedData.is_shipping_address)) {
      warnings.push('Is shipping address should be true/false');
    }

    if (mappedData.is_default && !['true', 'false', true, false].includes(mappedData.is_default)) {
      warnings.push('Is default location should be true/false');
    }

    if (mappedData.is_location_active && !['true', 'false', true, false].includes(mappedData.is_location_active)) {
      warnings.push('Is location active should be true/false');
    }

    // Validate client_type
    if (mappedData.client_type && !['company', 'individual'].includes(mappedData.client_type.toLowerCase())) {
      errors.push('Client type must be either "company" or "individual"');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      data: {
        ...mappedData,
        tenant: 'default',
        is_inactive: mappedData.is_inactive === 'true' || mappedData.is_inactive === true,
        is_tax_exempt: mappedData.is_tax_exempt === 'true' || mappedData.is_tax_exempt === true,
        auto_invoice: mappedData.auto_invoice === 'true' || mappedData.auto_invoice === true,
        credit_limit: mappedData.credit_limit ? Number(mappedData.credit_limit) : undefined,
        // Location boolean conversions
        is_billing_address: mappedData.is_billing_address === 'true' || mappedData.is_billing_address === true,
        is_shipping_address: mappedData.is_shipping_address === 'true' || mappedData.is_shipping_address === true,
        is_default: mappedData.is_default === 'true' || mappedData.is_default === true,
        is_location_active: mappedData.is_location_active === 'true' || mappedData.is_location_active === true || mappedData.is_location_active === undefined ? true : false
      }
    };
  }, []);

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = event.target.files?.[0];
    if (!uploadedFile) return;

    setFile(uploadedFile);
    setErrors([]);
    setIsProcessing(true);

    try {
      const text = await uploadedFile.text();
      const rows = parseCSV(text);
      
      if (rows.length < 2) {
        throw new Error('CSV file is empty or invalid');
      }

      const headers = rows[0];
      setPreviewData({
        headers,
        rows: rows.slice(1, 6) // First 5 rows for preview
      });

      // Auto-map columns based on header names
      const autoMappings: ICSVColumnMapping[] = headers.map((header): ICSVColumnMapping => {
        const headerLower = header.toLowerCase();
        let companyField: MappableCompanyField | null = null;

        // Map user-friendly names to database fields
        if (headerLower.includes('client') && headerLower.includes('name')) {
          companyField = 'company_name'; // client_name maps to company_name in DB
        } else if (headerLower.includes('company') && headerLower.includes('name')) {
          companyField = 'company_name';
        } else if (headerLower.includes('phone') && !headerLower.includes('location')) {
          companyField = 'phone_no'; // phone_number maps to phone_no in DB
        } else if (headerLower.includes('email') && !headerLower.includes('location')) {
          companyField = 'email';
        } else if (headerLower.includes('website')) {
          companyField = 'url'; // website maps to url in DB
        } else if (headerLower.includes('url')) {
          companyField = 'url';
        } else if (headerLower.includes('client') && headerLower.includes('type')) {
          companyField = 'client_type';
        } else if (headerLower.includes('inactive') && !headerLower.includes('location')) {
          companyField = 'is_inactive';
        } else if (headerLower.includes('notes') && !headerLower.includes('location')) {
          companyField = 'notes';
        } 
        // Location field mappings
        else if (headerLower.includes('location') && headerLower.includes('name')) {
          companyField = 'location_name';
        } else if (headerLower.includes('address') && headerLower.includes('line') && headerLower.includes('1')) {
          companyField = 'address_line1';
        } else if (headerLower.includes('address') && headerLower.includes('line') && headerLower.includes('2')) {
          companyField = 'address_line2';
        } else if (headerLower.includes('address') && headerLower.includes('line') && headerLower.includes('3')) {
          companyField = 'address_line3';
        } else if (headerLower.includes('city')) {
          companyField = 'city';
        } else if (headerLower.includes('state') || headerLower.includes('province')) {
          companyField = 'state_province';
        } else if (headerLower.includes('postal') || headerLower.includes('zip')) {
          companyField = 'postal_code';
        } else if (headerLower.includes('country') && headerLower.includes('code')) {
          companyField = 'country_code';
        } else if (headerLower.includes('country') && headerLower.includes('name')) {
          companyField = 'country_name';
        } else if (headerLower.includes('billing') && headerLower.includes('address')) {
          companyField = 'is_billing_address';
        } else if (headerLower.includes('shipping') && headerLower.includes('address')) {
          companyField = 'is_shipping_address';
        } else if (headerLower.includes('default') && headerLower.includes('location')) {
          companyField = 'is_default';
        } else if (headerLower.includes('location') && headerLower.includes('phone')) {
          companyField = 'location_phone';
        } else if (headerLower.includes('location') && headerLower.includes('fax')) {
          companyField = 'location_fax';
        } else if (headerLower.includes('location') && headerLower.includes('email')) {
          companyField = 'location_email';
        } else if (headerLower.includes('location') && headerLower.includes('notes')) {
          companyField = 'location_notes';
        } else if (headerLower.includes('location') && headerLower.includes('active')) {
          companyField = 'is_location_active';
        } else {
          // Fallback to existing mapping logic
          Object.entries(COMPANY_FIELDS).forEach(([field, label]) => {
            if (headerLower.includes(field.toLowerCase()) || 
                headerLower.includes(label.toLowerCase())) {
              companyField = field as MappableCompanyField;
            }
          });
        }

        return {
          csvHeader: header,
          companyField
        };
      });

      setColumnMappings(autoMappings);
      setStep('mapping');
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'Error reading CSV file']);
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const handleMapColumn = useCallback((csvHeader: string, value: string) => {
    setColumnMappings(prev =>
      prev.map((mapping): ICSVColumnMapping => 
        mapping.csvHeader === csvHeader
          ? { ...mapping, companyField: value === 'unassigned' ? null : value as MappableCompanyField }
          : mapping
      )
    );
  }, []);

  const validateMappings = useCallback(() => {
    const errors: string[] = [];
    const requiredFields: MappableCompanyField[] = ['company_name'];

    for (const requiredField of requiredFields) {
      if (!columnMappings.some(mapping => mapping.companyField === requiredField)) {
        errors.push(`Required field "${COMPANY_FIELDS[requiredField]}" is not mapped`);
      }
    }

    return errors;
  }, [columnMappings]);

  const handlePreview = useCallback(async () => {
    const mappingErrors = validateMappings();
    if (mappingErrors.length > 0) {
      setErrors(mappingErrors);
      return;
    }

    if (previewData) {
      const results = previewData.rows.map((row): ICSVValidationResult => {
        const mappedData: Record<string, any> = {};
        columnMappings.forEach((mapping, index) => {
          if (mapping.companyField) {
            mappedData[mapping.companyField] = row[index];
          }
        });

        return validateCompanyData(mappedData);
      });

      // Check for existing companies
      const companyNames = results
        .filter(result => result.isValid)
        .map((result): string => result.data.company_name);

      const existingCompanies = await checkExistingCompanies(companyNames);
      const existingCompanyNames = new Set(existingCompanies.map((c): string => c.company_name.toLowerCase()));

      // Mark existing companies in validation results
      const updatedResults = results.map((result): ICSVValidationResult => ({
        ...result,
        isExisting: existingCompanyNames.has(result.data.company_name.toLowerCase())
      }));

      const existingCount = updatedResults.filter(result => result.isExisting).length;

      if (existingCount > 0) {
        setExistingCompaniesCount(existingCount);
        setShowUpdateConfirmation(true);
      }

      setValidationResults(updatedResults);
      setStep('preview');
    }
  }, [previewData, columnMappings, validateCompanyData, validateMappings]);

  const handleImport = useCallback(async () => {
    if (isProcessing) return;

    try {
      setIsProcessing(true);
      const validCompanies = validationResults
        .filter(result => result.isValid || importOptions.skipInvalid)
        .map((result): ICompany => result.data as ICompany);

      await importCompaniesFromCSV(validCompanies, importOptions.updateExisting);
      await onImportComplete(validCompanies, importOptions.updateExisting);
      setStep('complete');
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'Error importing companies']);
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, validationResults, importOptions, onImportComplete]);

  const handleClose = useCallback(() => {
    if (!isProcessing) {
      setStep('upload');
      setFile(null);
      setPreviewData(null);
      setColumnMappings([]);
      setValidationResults([]);
      setErrors([]);
      setImportOptions({
        updateExisting: false,
        skipInvalid: false
      });
      setShowUpdateConfirmation(false);
      setExistingCompaniesCount(0);
      setShowOptionalFields(false);
      onClose();
    }
  }, [isProcessing, onClose]);

  return (
    <>
      <Dialog
        isOpen={isOpen} 
        onClose={handleClose} 
        title="Import Companies"
      >
        <DialogContent>
          {errors.length > 0 && (
            <div className="mb-4 p-4 border border-red-300 bg-red-50 rounded-md">
              <div className="flex items-center gap-2 text-red-800">
                <AlertTriangle className="h-4 w-4" />
                <ul>
                  {errors.map((error, index): JSX.Element => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {step === 'upload' && (
            <div className="text-center p-8 border-2 border-dashed border-gray-300 rounded-lg">
              <Upload className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-2 text-sm text-gray-600">Upload a CSV file with company data</p>
              <p className="mt-1 text-xs text-gray-500">
                Required fields: client_name<br />
                Optional fields: email, phone_number, website, client_type (company/individual), is_inactive, notes<br />
                Location fields: location_name, address_line1, address_line2, address_line3, city, state_province, postal_code, country_code, country_name, is_billing_address, is_shipping_address, is_default, location_phone, location_fax, location_email, location_notes, is_location_active
              </p>
              <div className="mt-4 space-y-3">
                <Input
                  id="company-csv-upload"
                  type="file"
                  accept=".csv"
                  onChange={handleFileUpload}
                  disabled={isProcessing}
                />
                <div className="flex items-center justify-center gap-2">
                  <span className="text-xs text-gray-500">Need a template?</span>
                  <Button
                    id="download-company-template"
                    variant="outline"
                    size="sm"
                    onClick={handleDownloadTemplate}
                    className="text-xs"
                    disabled={isProcessing}
                  >
                    <Download size={14} className="mr-1" />
                    Download Template
                  </Button>
                </div>
              </div>
            </div>
          )}

          {step === 'mapping' && previewData && (
            <div>
              <h3 className="text-lg font-medium mb-4">Map CSV Columns</h3>
              <div className="max-h-[60vh] overflow-y-auto pr-2">
                <div className="mb-6">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Required Fields</h4>
                  {columnMappings
                    .filter(mapping => mapping.csvHeader.toLowerCase().includes('name'))
                    .map((mapping, index): JSX.Element => (
                      <div key={index} className="flex items-center gap-4 mb-4">
                        <span className="w-1/3">{mapping.csvHeader}</span>
                        <CustomSelect
                          options={getFieldOptions()}
                          value={mapping.companyField || 'unassigned'}
                          onValueChange={(value) => handleMapColumn(mapping.csvHeader, value)}
                          className="w-2/3"
                        />
                      </div>
                    ))}
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Optional Fields</h4>
                  {columnMappings
                    .filter(mapping => !mapping.csvHeader.toLowerCase().includes('name'))
                    .map((mapping, index): JSX.Element => (
                      <div key={index} className="flex items-center gap-4 mb-4">
                        <span className="w-1/3">{mapping.csvHeader}</span>
                        <CustomSelect
                          options={getFieldOptions()}
                          value={mapping.companyField || 'unassigned'}
                          onValueChange={(value) => handleMapColumn(mapping.csvHeader, value)}
                          className="w-2/3"
                        />
                      </div>
                    ))}
                </div>
              </div>
              <div className="mt-4">
                <DialogFooter>
                  <Button id="mapping-back-btn" variant="outline" onClick={() => setStep('upload')}>Back</Button>
                  <Button id="mapping-preview-btn" onClick={handlePreview}>Preview</Button>
                </DialogFooter>
              </div>
            </div>
          )}

          {step === 'preview' && validationResults.length > 0 && (
            <div>
              <h3 className="text-lg font-medium mb-4">Preview Import</h3>
              <div className="mb-6 space-y-4">
                <div className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-gray-900 font-medium">Update existing companies</div>
                    <div className="text-sm text-gray-500">Replace data for existing companies</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-700">
                      {importOptions.updateExisting ? 'Yes' : 'No'}
                    </span>
                    <Switch
                      checked={importOptions.updateExisting}
                      onCheckedChange={(checked) =>
                        setImportOptions(prev => ({ ...prev, updateExisting: checked }))
                      }
                      className="data-[state=checked]:bg-primary-500"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-gray-900 font-medium">Skip invalid records</div>
                    <div className="text-sm text-gray-500">Continue import even if some records have validation errors</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-700">
                      {importOptions.skipInvalid ? 'Yes' : 'No'}
                    </span>
                    <Switch
                      checked={importOptions.skipInvalid}
                      onCheckedChange={(checked) =>
                        setImportOptions(prev => ({ ...prev, skipInvalid: checked }))
                      }
                      className="data-[state=checked]:bg-primary-500"
                    />
                  </div>
                </div>
              </div>
              <div className="max-h-96 overflow-y-auto">
                <DataTable
                  data={validationResults.map((result, index): Record<string, any> => ({
                    status: result.isValid,
                    company_name: result.data.company_name,
                    email: result.data.email,
                    phone_no: result.data.phone_no,
                    exists: result.isExisting ? 'Yes' : 'No',
                    issues: [...result.errors, ...result.warnings].join(', ')
                  }))}
                  columns={[
                    {
                      title: 'Status',
                      dataIndex: 'status',
                      render: (value: boolean) => value ? (
                        <Check className="h-5 w-5 text-green-500" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 text-red-500" />
                      ),
                    },
                    {
                      title: 'Company Name',
                      dataIndex: 'company_name',
                    },
                    {
                      title: 'Email',
                      dataIndex: 'email',
                    },
                    {
                      title: 'Phone',
                      dataIndex: 'phone_no',
                    },
                    {
                      title: 'Exists',
                      dataIndex: 'exists',
                    },
                    {
                      title: 'Issues',
                      dataIndex: 'issues',
                    }
                  ] as ColumnDefinition<any>[]}
                  pagination={true}
                />
              </div>
              <div className="mt-4">
                <DialogFooter>
                  <Button 
                    id="preview-back-btn"
                    variant="outline" 
                    onClick={() => setStep('mapping')}
                    disabled={isProcessing}
                  >
                    Back
                  </Button>
                  <Button
                    id="preview-import-btn"
                    onClick={handleImport}
                    disabled={validationResults.every(result => !result.isValid) || isProcessing}
                  >
                    {isProcessing ? 'Importing...' : 'Import'}
                  </Button>
                </DialogFooter>
              </div>
            </div>
          )}

          {step === 'complete' && (
            <div className="text-center">
              <Check className="h-12 w-12 text-green-500 mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">Import Complete</h3>
              <p className="text-gray-600 mb-4">
                Successfully imported {validationResults.filter(r => r.isValid).length} companies
              </p>
              <DialogFooter>
                <Button id="complete-close-btn" onClick={handleClose}>Close</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        isOpen={showUpdateConfirmation}
        onClose={() => setShowUpdateConfirmation(false)}
        onConfirm={() => {
          setShowUpdateConfirmation(false);
          setImportOptions(prev => ({ ...prev, updateExisting: true }));
          setStep('preview');
        }}
        title="Update Existing Companies"
        message={`${existingCompaniesCount} companies already exist. Do you want to update them with the new data?`}
        confirmLabel="Update"
        cancelLabel="Cancel"
      />
    </>
  );
};

export default CompaniesImportDialog;
