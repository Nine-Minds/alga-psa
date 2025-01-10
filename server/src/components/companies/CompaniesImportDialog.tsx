'use client';

import React, { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import CustomSelect from '@/components/ui/CustomSelect';
import { DataTable } from '@/components/ui/DataTable';
import { Switch } from '@/components/ui/Switch';
import { ColumnDefinition } from '@/interfaces/dataTable.interfaces';
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog';
import { ICompany } from '@/interfaces/company.interfaces';
import { Upload, AlertTriangle, Check } from 'lucide-react';
import { parseCSV } from '@/lib/utils/csvParser';
import { checkExistingCompanies, importCompaniesFromCSV } from '@/lib/actions/companyActions';

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
  | 'is_tax_exempt'
  | 'tax_id_number'
  | 'payment_terms'
  | 'billing_cycle'
  | 'credit_limit'
  | 'preferred_payment_method'
  | 'auto_invoice'
  | 'invoice_delivery_method'
  | 'tax_region';

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
  is_tax_exempt: 'Is Tax Exempt',
  tax_id_number: 'Tax ID',
  payment_terms: 'Payment Terms',
  billing_cycle: 'Billing Cycle',
  credit_limit: 'Credit Limit',
  preferred_payment_method: 'Payment Method',
  auto_invoice: 'Auto Invoice',
  invoice_delivery_method: 'Invoice Delivery Method',
  tax_region: 'Tax Region'
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

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      data: {
        ...mappedData,
        tenant: 'default',
        is_inactive: mappedData.is_inactive === 'true',
        is_tax_exempt: mappedData.is_tax_exempt === 'true',
        auto_invoice: mappedData.auto_invoice === 'true',
        credit_limit: mappedData.credit_limit ? Number(mappedData.credit_limit) : undefined
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

        Object.entries(COMPANY_FIELDS).forEach(([field, label]) => {
          if (headerLower.includes(field.toLowerCase()) || 
              headerLower.includes(label.toLowerCase())) {
            companyField = field as MappableCompanyField;
          }
        });

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
      <Dialog isOpen={isOpen} onClose={handleClose}>
        <DialogHeader>
          <DialogTitle>Import Companies</DialogTitle>
        </DialogHeader>
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
                Required fields: company_name<br />
                Optional fields: phone_no, email, url, address, client_type, is_inactive, is_tax_exempt, etc.
              </p>
              <Input
                id="company-csv-upload"
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="mt-4"
                disabled={isProcessing}
              />
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
