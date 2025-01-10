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
import { ICSVColumnMapping, ICSVPreviewData, ICSVValidationResult, IContact, MappableField, ICSVImportOptions, ImportContactResult } from '@/interfaces/contact.interfaces';
import { importContactsFromCSV, checkExistingEmails } from '@/lib/actions/contact-actions/contactActions';
import { X, Upload, AlertTriangle, Check, Download } from 'lucide-react';
import { parseCSV, unparseCSV, validateCSVHeaders } from '@/lib/utils/csvParser';

interface ContactsImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: (contacts: IContact[]) => void;
  companies: { company_id: string; company_name: string; }[];
}

const CONTACT_FIELDS = {
  full_name: 'Name',
  email: 'Email',
  phone_number: 'Phone Number',
  company_name: 'Company',
  tags: 'Tags',
  date_of_birth: 'Date of Birth',
  role: 'Role',
  notes: 'Notes'
} as const;

interface ImportOptionsProps {
  importOptions: ICSVImportOptions;
  onOptionsChange: (options: ICSVImportOptions) => void;
}

interface FieldOption {
  value: string;
  label: string;
}

const ContactsImportDialog: React.FC<ContactsImportDialogProps> = ({
  isOpen,
  onClose,
  onImportComplete,
  companies
}) => {
  const [step, setStep] = useState<'upload' | 'mapping' | 'preview' | 'importing' | 'results' | 'complete'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<ICSVPreviewData | null>(null);
  const [columnMappings, setColumnMappings] = useState<ICSVColumnMapping[]>([]);
  const [validationResults, setValidationResults] = useState<ICSVValidationResult[]>([]);
  const [importProgress, setImportProgress] = useState<number>(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [importOptions, setImportOptions] = useState<ICSVImportOptions>({
    updateExisting: false,
    skipInvalid: false,
    dryRun: false
  });
  const [importResults, setImportResults] = useState<ImportContactResult[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [showUpdateConfirmation, setShowUpdateConfirmation] = useState(false);
  const [existingContactsCount, setExistingContactsCount] = useState(0);
  const [processingDetails, setProcessingDetails] = useState<{
    current: number;
    total: number;
    currentItem?: string;
  }>({ current: 0, total: 0 });
  const [failedRecords, setFailedRecords] = useState<ImportContactResult[]>([]);

  const getFieldOptions = () => {
    return [
      { value: 'unassigned', label: 'Select field' },
      ...Object.entries(CONTACT_FIELDS).map(([value, label]: [string, string]): FieldOption => ({
        value,
        label,
      })),
    ];
  };

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = event.target.files?.[0];
    if (!uploadedFile) return;

    setFile(uploadedFile);
    setErrors([]);

    try {
      const text = await uploadedFile.text();
      const rows = parseCSV(text);
      
      if (rows.length < 2) {
        throw new Error('CSV file is empty or invalid');
      }

      const headers = rows[0];
      const dataRows = rows.slice(1);

      setPreviewData({
        headers,
        rows: dataRows.slice(0, 5)
      });

      const autoMappings: ICSVColumnMapping[] = headers.map((header: string): ICSVColumnMapping => {
        const headerLower = header.toLowerCase();
        let contactField: MappableField | null = null;

        if (headerLower.includes('name')) contactField = 'full_name';
        else if (headerLower.includes('email')) contactField = 'email';
        else if (headerLower.includes('phone')) contactField = 'phone_number';
        else if (headerLower.includes('company')) contactField = 'company_name';
        else if (headerLower.includes('tag')) contactField = 'tags';
        else if (headerLower.includes('birth')) contactField = 'date_of_birth';
        else if (headerLower.includes('role')) contactField = 'role';
        else if (headerLower.includes('note')) contactField = 'notes';

        return {
          csvHeader: header,
          contactField,
        };
      });

      setColumnMappings(autoMappings);
      setStep('mapping');
    } catch (error) {
      setErrors([`Error reading CSV file: ${error instanceof Error ? error.message : 'Unknown error'}`]);
    }
  }, []);

  const handleMapColumn = (csvHeader: string, value: string) => {
    setColumnMappings(prev =>
      prev.map((mapping: ICSVColumnMapping): ICSVColumnMapping =>
        mapping.csvHeader === csvHeader
          ? { ...mapping, contactField: value === 'unassigned' ? null : value as MappableField }  // Convert 'unassigned' to null
          : mapping
      )
    );
  };

  const validateMappings = () => {
    const errors: string[] = [];
    const requiredFields: MappableField[] = ['full_name', 'email'];

    for (const requiredField of requiredFields) {
      if (!columnMappings.some((mapping: ICSVColumnMapping): boolean => mapping.contactField === requiredField)) {
        errors.push(`Required field "${CONTACT_FIELDS[requiredField]}" is not mapped`);
      }
    }

    return errors;
  };
  
  const handlePreview = async () => {
    const mappingErrors = validateMappings();
    if (mappingErrors.length > 0) {
      setErrors(mappingErrors);
      return;
    }

    if (previewData) {
      const results = previewData.rows.map((row: string[]): ICSVValidationResult => {
        const mappedData: Record<MappableField, string> = {} as Record<MappableField, string>;
        const errors: string[] = [];
        const warnings: string[] = [];

        columnMappings.forEach((mapping, index) => {
          if (mapping.contactField !== null) {
            mappedData[mapping.contactField] = row[index];
          }
        });

        if (!mappedData.full_name) errors.push('Name is required');
        if (!mappedData.email) {
          errors.push('Email is required');
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mappedData.email)) {
          errors.push('Invalid email format');
        }

        return {
          isValid: errors.length === 0,
          errors,
          warnings,
          data: mappedData
        };
      });

      setValidationResults(results);
      setStep('preview');
    }
  };

  const checkExistingContacts = async (data: Array<Record<MappableField, string>>) => {
    const emails = data
      .filter((contact): contact is Record<MappableField, string> & { email: string } =>
        typeof contact.email === 'string' && contact.email.length > 0
      )
      .map((contact: Record<MappableField, string> & { email: string }): string => contact.email);

    const existing = await checkExistingEmails(emails);
    return existing.length;
  };

  const transformDataForImport = (data: Array<Record<MappableField, string>>): Array<Partial<IContact>> => {
    return data.map((record): Partial<IContact> => {
      // Find company ID from company name
      const company = companies.find(c => c.company_name === record.company_name);
      
      return {
        full_name: record.full_name,
        email: record.email,
        phone_number: record.phone_number,
        company_id: company?.company_id || null,
        date_of_birth: record.date_of_birth || undefined,
        role: record.role,
        notes: record.notes,
        is_inactive: false
      };
    });
  };

  const processImport = async (data: Array<Record<MappableField, string>>) => {
    setIsImporting(true);
    setProcessingDetails({ current: 0, total: data.length });
    
    try {
      const transformedData = transformDataForImport(data);
      const results = await importContactsFromCSV(
        transformedData,
        importOptions.updateExisting
      );

      setImportResults(results);
      setProcessingDetails(prev => ({
        ...prev,
        current: prev.current + 1,
        currentItem: results[results.length - 1]?.originalData.email
      }));

      const failedResults = results.filter(r => !r.success);
      setFailedRecords(failedResults);

      if (failedResults.length === 0) {
        setStep('complete');
        const successfulContacts = results
          .filter(r => r.success && r.contact)
          .map((r): IContact => r.contact!);
        onImportComplete(successfulContacts);
      } else {
        setStep('results');
      }
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'Import failed']);
    } finally {
      setIsImporting(false);
    }
  };

  const handleImport = async () => {
    const validData = validationResults
      .filter((result: ICSVValidationResult): boolean => result.isValid || importOptions.skipInvalid)
      .map((result: ICSVValidationResult): Record<MappableField, string> => {
        const data: Record<MappableField, string> = {
          full_name: result.data.full_name || '',
          email: result.data.email || '',
          phone_number: result.data.phone_number || '',
          company_name: result.data.company_name || '',
          tags: result.data.tags || '',
          date_of_birth: result.data.date_of_birth || '',
          role: result.data.role || '',
          notes: result.data.notes || ''
        };
        return data;
      });

    if (importOptions.updateExisting) {
      const existingCount = await checkExistingContacts(validData);
      if (existingCount > 0) {
        setExistingContactsCount(existingCount);
        setShowUpdateConfirmation(true);
        return;
      }
    }

    await processImport(validData);
  };

  const handleDownloadFailedRecords = () => {
    const fields = Object.keys(CONTACT_FIELDS);
    const csvContent = unparseCSV(
      failedRecords.map((record): Record<string, string> => record.originalData),
      fields
    );

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'failed_contacts.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const ImportOptions: React.FC<ImportOptionsProps> = ({ importOptions, onOptionsChange }) => (
    <div className="mb-6 space-y-4">
      <div className="flex items-center justify-between py-3">
        <div>
          <div className="text-gray-900 font-medium">Update existing contacts</div>
          <div className="text-sm text-gray-500">Replace data for existing contacts</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-700">
            {importOptions.updateExisting ? 'Yes' : 'No'}
          </span>
          <Switch
            checked={importOptions.updateExisting}
            onCheckedChange={(checked) =>
              onOptionsChange({ ...importOptions, updateExisting: checked })
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
              onOptionsChange({ ...importOptions, skipInvalid: checked })
            }
            className="data-[state=checked]:bg-primary-500"
          />
        </div>
      </div>
    </div>
  );

  const ResultsView = () => (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-medium">Import Results</h3>
        {failedRecords.length > 0 && (
          <Button
            id="download-failed-records"
            variant="outline"
            onClick={handleDownloadFailedRecords}
            className="flex items-center gap-2"
          >
            <Download size={16} />
            Download Failed Records
          </Button>
        )}
      </div>
      <DataTable
        data={importResults}
        columns={[
          {
            title: 'Status',
            dataIndex: 'success',
            render: (value: boolean) => value ? (
              <Check className="h-5 w-5 text-green-500" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-red-500" />
            ),
          },
          {
            title: 'Name',
            dataIndex: 'originalData',
            render: (value: Record<string, string>) => value.full_name,
          },
          {
            title: 'Email',
            dataIndex: 'originalData',
            render: (value: Record<string, string>) => value.email,
          },
          {
            title: 'Message',
            dataIndex: 'message',
          },
        ] as ColumnDefinition<ImportContactResult>[]}
        pagination={true}
      />
      <DialogFooter>
        <Button id='close-import-dialog' onClick={onClose}>Close</Button>
      </DialogFooter>
    </div>
  );

  return (
    <>
      <Dialog
        isOpen={isOpen}
        onClose={onClose}
      >
        <DialogHeader>
          <DialogTitle>Import Contacts</DialogTitle>
        </DialogHeader>
        <DialogContent>
          {errors.length > 0 && (
            <div className="mb-4 p-4 border border-red-300 bg-red-50 rounded-md">
              <div className="flex items-center gap-2 text-red-800">
                <AlertTriangle className="h-4 w-4" />
                <ul>
                  {errors.map((error: string, index: number): JSX.Element => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {step === 'upload' && (
            <div className="text-center p-8 border-2 border-dashed border-gray-300 rounded-lg">
              <Upload className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-2 text-sm text-gray-600">Upload a CSV file with contact data</p>
              <Input
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="mt-4"
              />
            </div>
          )}

          {step === 'mapping' && previewData && (
            <div>
              <h3 className="text-lg font-medium mb-4">Map CSV Columns</h3>
              <div className="space-y-4">
                {columnMappings.map((mapping: ICSVColumnMapping, index: number): JSX.Element => (
                  <div key={index} className="flex items-center gap-4">
                    <span className="w-1/3">{mapping.csvHeader}</span>
                    <CustomSelect
                      options={getFieldOptions()}
                      value={mapping.contactField || 'unassigned'}
                      onValueChange={(value) => handleMapColumn(mapping.csvHeader, value)}
                      className="w-2/3"
                    />
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button id='back-to-upload' variant="outline" onClick={() => setStep('upload')}>Back</Button>
                <Button id='preview-import' onClick={handlePreview}>Preview</Button>
              </DialogFooter>
            </div>
          )}

          {step === 'preview' && validationResults.length > 0 && (
            <div>
              <h3 className="text-lg font-medium mb-4">Preview Import</h3>
              <ImportOptions
                importOptions={importOptions}
                onOptionsChange={setImportOptions}
              />
              <div className="max-h-96 overflow-y-auto">
                <DataTable
                  data={validationResults.map((result: ICSVValidationResult, index: number): Record<MappableField | 'status' | 'issues', string | boolean> => {
                    const acc: Record<MappableField, string> = (previewData?.rows[index] || []).reduce((
                      acc: Record<MappableField, string>,
                      cell: string,
                      idx: number
                    ): Record<MappableField, string> => {
                      const mapping = columnMappings[idx];
                      if (mapping.contactField) {
                        acc[mapping.contactField] = cell;
                      }
                      return acc;
                    }, {} as Record<MappableField, string>);

                    return {
                      status: result.isValid,
                      ...acc,
                      issues: result.errors.concat(result.warnings).join(', ')
                    };
                  })}
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
                    ...columnMappings
                      .filter((mapping): mapping is ICSVColumnMapping & { contactField: NonNullable<ICSVColumnMapping['contactField']> } =>
                        mapping.contactField !== null
                      )
                      .map((mapping): ColumnDefinition<any> => ({
                        title: CONTACT_FIELDS[mapping.contactField],
                        dataIndex: mapping.contactField,
                      })),
                    {
                      title: 'Issues',
                      dataIndex: 'issues',
                    }
                  ]}
                  pagination={true}
                />
              </div>
              <DialogFooter>
                <Button id='back-to-mapping' variant="outline" onClick={() => setStep('mapping')}>Back</Button>
                <Button
                  id='import-contacts'
                  onClick={handleImport}
                  disabled={validationResults.every(result => !result.isValid)}
                >
                  Import
                </Button>
              </DialogFooter>
            </div>
          )}

          {step === 'importing' && (
            <div>
              <h3 className="text-lg font-medium mb-4">Importing Contacts</h3>
              <div className="mb-4">
                <div className="flex justify-between text-sm text-gray-600 mb-1">
                  <span>Processing: {processingDetails.current} of {processingDetails.total}</span>
                  <span>{Math.round((processingDetails.current / processingDetails.total) * 100)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div
                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                    style={{ width: `${(processingDetails.current / processingDetails.total) * 100}%` }}
                  />
                </div>
              </div>
              {processingDetails.currentItem && (
                <p className="text-sm text-gray-600">
                  Currently processing: {processingDetails.currentItem}
                </p>
              )}
            </div>
          )}

          {step === 'results' && <ResultsView />}

          {step === 'complete' && (
            <div className="text-center">
              <Check className="h-12 w-12 text-green-500 mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">Import Complete</h3>
              <p className="text-gray-600 mb-4">
                Successfully imported {importResults.filter((r: ImportContactResult): boolean => r.success).length} contacts
              </p>
              <DialogFooter>
                <Button id='close-import-complete' onClick={onClose}>Close</Button>
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
          const validData = validationResults
            .filter((result: ICSVValidationResult): boolean => result.isValid || importOptions.skipInvalid)
            .map((result: ICSVValidationResult): Record<MappableField, string> => ({
              full_name: result.data.full_name || '',
              email: result.data.email || '',
              phone_number: result.data.phone_number || '',
              company_name: result.data.company_name || '',
              tags: result.data.tags || '',
              date_of_birth: result.data.date_of_birth || '',
              role: result.data.role || '',
              notes: result.data.notes || ''
            }));
          processImport(validData);
        }}
        title="Update Existing Contacts"
        message={`${existingContactsCount} contacts already exist. Do you want to update them with the new data?`}
        confirmLabel="Update"
        cancelLabel="Cancel"
      />
    </>
  );
};

export default ContactsImportDialog;
