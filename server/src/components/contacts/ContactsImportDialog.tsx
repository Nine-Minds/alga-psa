'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { DataTable } from 'server/src/components/ui/DataTable';
import { Switch } from 'server/src/components/ui/Switch';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { Tooltip } from 'server/src/components/ui/Tooltip';
import { ICSVColumnMapping, ICSVPreviewData, ICSVValidationResult, IContact, MappableField, ICSVImportOptions, ImportContactResult } from 'server/src/interfaces/contact.interfaces';
import { importContactsFromCSV, checkExistingEmails, generateContactCSVTemplate } from '@product/actions/contact-actions/contactActions';
import { X, Upload, AlertTriangle, Check, Download } from 'lucide-react';
import { parseCSV, unparseCSV, validateCSVHeaders } from 'server/src/lib/utils/csvParser';

interface ContactsImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: (contacts: IContact[]) => void;
  clients: { client_id: string; client_name: string; }[];
}

const CONTACT_FIELDS = {
  full_name: 'Name *',
  email: 'Email *',
  phone_number: 'Phone Number',
  client: 'Client',
  tags: 'Tags',
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
  clients
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

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setStep('upload');
      setFile(null);
      setPreviewData(null);
      setColumnMappings([]);
      setValidationResults([]);
      setImportProgress(0);
      setErrors([]);
      setImportOptions({
        updateExisting: false,
        skipInvalid: false,
        dryRun: false
      });
      setImportResults([]);
      setIsImporting(false);
      setShowUpdateConfirmation(false);
      setExistingContactsCount(0);
      setProcessingDetails({ current: 0, total: 0 });
      setFailedRecords([]);
    }
  }, [isOpen]);

  const getFieldOptions = useCallback((currentMappingValue: string | null) => {
    // Get all currently mapped fields except the current one
    const mappedFields = columnMappings
      .filter(m => m.contactField && m.contactField !== currentMappingValue)
      .map(m => m.contactField);
    
    return [
      { value: 'unassigned', label: 'Select field' },
      ...Object.entries(CONTACT_FIELDS)
        .filter(([value]) => !mappedFields.includes(value as MappableField))
        .map(([value, label]: [string, string]): FieldOption => ({
          value,
          label,
        })),
    ];
  }, [columnMappings]);

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

        // Check more specific patterns first
        if (headerLower === 'client' || headerLower === 'client_name' || headerLower === 'client name') contactField = 'client';
        else if (headerLower === 'full_name' || headerLower === 'full name' || headerLower === 'name') contactField = 'full_name';
        else if (headerLower.includes('client')) contactField = 'client';
        else if (headerLower.includes('email')) contactField = 'email';
        else if (headerLower.includes('phone')) contactField = 'phone_number';
        else if (headerLower.includes('tag')) contactField = 'tags';
        else if (headerLower.includes('role')) contactField = 'role';
        else if (headerLower.includes('note')) contactField = 'notes';
        else if (headerLower.includes('name')) contactField = 'full_name';

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

      // Check for existing emails
      const emails = results
        .map(r => r.data.email)
        .filter((email): email is string => !!email);
      
      const existingEmails = await checkExistingEmails(emails);
      const existingEmailSet = new Set(existingEmails.map(e => e.toLowerCase()));
      
      // Add isExisting property to results
      const resultsWithExisting = results.map(result => ({
        ...result,
        isExisting: result.data.email ? existingEmailSet.has(result.data.email.toLowerCase()) : false
      }));
      
      setValidationResults(resultsWithExisting);
      
      // Count existing contacts
      const existingCount = resultsWithExisting.filter(r => r.isExisting).length;
      if (existingCount > 0 && !importOptions.updateExisting) {
        setExistingContactsCount(existingCount);
        setShowUpdateConfirmation(true);
      } else {
        setStep('preview');
      }
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

  const transformDataForImport = (data: Array<Record<MappableField, string>>): Array<Partial<IContact> & { tags?: string }> => {
    return data.map((record): Partial<IContact> & { tags?: string } => {
      // Find client ID from client name
      const client = clients.find(c => c.client_name === record.client);
      
      const contactData: Partial<IContact> & { tags?: string } = {
        full_name: record.full_name,
        email: record.email,
        phone_number: record.phone_number,
        client_id: client?.client_id || null,
        role: record.role,
        notes: record.notes,
        is_inactive: false
      };
      
      // Add tags as a separate property (not part of IContact)
      if (record.tags) {
        (contactData as any).tags = record.tags;
      }
      
      return contactData;
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
          client: result.data.client || '',
          tags: result.data.tags || '',
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
              <div className="flex justify-center">
                <Tooltip content="Import successful">
                  <Check className="h-5 w-5 text-green-500 cursor-help" />
                </Tooltip>
              </div>
            ) : (
              <div className="flex justify-center">
                <Tooltip content="Import failed">
                  <AlertTriangle className="h-5 w-5 text-red-500 cursor-help" />
                </Tooltip>
              </div>
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
            width: '40%',
            render: (value: string) => (
              <div className="whitespace-normal break-words text-sm min-w-0">
                {value}
              </div>
            ),
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
        title="Import Contacts"
        className="max-w-5xl"
      >
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
            <div>
              <div className="text-center p-8 border-2 border-dashed border-gray-300 rounded-lg">
                <Upload className="mx-auto h-12 w-12 text-gray-400" />
                <p className="mt-2 text-sm text-gray-600">Upload a CSV file with contact data</p>
                <p className="mt-1 text-xs text-gray-500">
                  <strong>Required:</strong> full_name, email<br />
                  <strong>Contact fields:</strong> phone_number, role, notes, tags<br />
                  <strong>Client field:</strong> client (matches existing clients by name)<br />
                  <strong>Note:</strong> Tags should be comma-separated values
                </p>
                <Input
                  type="file"
                  accept=".csv"
                  onChange={handleFileUpload}
                  className="mt-4"
                />
              </div>
              <div className="mt-4">
                <Button
                  id="download-template-btn"
                  variant="outline"
                  onClick={async () => {
                    const template = await generateContactCSVTemplate();
                    const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' });
                    const link = document.createElement('a');
                    const url = URL.createObjectURL(blob);
                    link.setAttribute('href', url);
                    link.setAttribute('download', 'contact_import_template.csv');
                    link.style.visibility = 'hidden';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                  }}
                  className="w-full"
                >
                  Download CSV Template
                </Button>
              </div>
            </div>
          )}

          {step === 'mapping' && previewData && (
            <div>
              <h3 className="text-lg font-medium mb-4">Map Contact Fields to CSV Columns</h3>
              <p className="text-sm text-gray-600 mb-4">
                Select which CSV column contains the data for each contact field. Fields marked with * are required.
              </p>
              <div className="max-h-[60vh] overflow-y-auto pr-2">
                <div className="mb-2 flex items-center gap-4 text-sm font-semibold text-gray-700">
                  <span className="w-1/3">Contact Field</span>
                  <span className="w-2/3">Select CSV Column</span>
                </div>
                <div className="border-t pt-4 space-y-3">
                  {Object.entries(CONTACT_FIELDS).map(([fieldKey, fieldLabel]: [string, string]): JSX.Element => {
                    const currentMapping = columnMappings.find(m => m.contactField === fieldKey);
                    const csvHeader = currentMapping?.csvHeader || 'unassigned';
                    
                    // Get already mapped CSV headers (excluding current field's mapping)
                    const mappedHeaders = columnMappings
                      .filter(m => m.contactField && m.contactField !== fieldKey)
                      .map(m => m.csvHeader);
                    
                    return (
                      <div key={fieldKey} className="flex items-center gap-4">
                        <span className="w-1/3 text-sm font-medium">{fieldLabel}</span>
                        <span className="text-gray-400">←</span>
                        <CustomSelect
                          options={[
                            { value: 'unassigned', label: 'Not mapped' },
                            ...previewData.headers
                              .filter(header => !mappedHeaders.includes(header))
                              .map(header => ({
                                value: header,
                                label: header
                              }))
                          ]}
                          value={csvHeader}
                          onValueChange={(value) => {
                            if (value === 'unassigned') {
                              // Clear the mapping for this field
                              if (currentMapping) {
                                handleMapColumn(currentMapping.csvHeader, 'unassigned');
                              }
                            } else {
                              // Clear any existing mapping for this CSV column
                              setColumnMappings(prev => prev.map(m => 
                                m.csvHeader === value ? { ...m, contactField: null } : m
                              ));
                              
                              // Find the mapping for the selected CSV column and update it
                              const targetMapping = columnMappings.find(m => m.csvHeader === value);
                              if (targetMapping) {
                                handleMapColumn(value, fieldKey);
                              }
                            }
                          }}
                          className="w-2/3"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="mt-6 text-xs text-gray-500">
                <p>* Required fields must be mapped for import to proceed</p>
              </div>
              <div className="mt-4">
                <DialogFooter>
                  <Button id='back-to-upload' variant="outline" onClick={() => setStep('upload')}>Back</Button>
                  <Button id='preview-import' onClick={handlePreview}>Preview</Button>
                </DialogFooter>
              </div>
            </div>
          )}

          {step === 'preview' && validationResults.length > 0 && (
            <div>
              <h3 className="text-lg font-medium mb-4">Preview Import</h3>
              <ImportOptions
                importOptions={importOptions}
                onOptionsChange={setImportOptions}
              />
              <div className="max-h-96 overflow-x-auto overflow-y-auto">
                <DataTable
                  data={validationResults.map((result: ICSVValidationResult, index: number): Record<string, any> => {
                    const rowData = (previewData?.rows[index] || []).reduce((
                      acc: Record<string, string>,
                      cell: string,
                      idx: number
                    ): Record<string, string> => {
                      const mapping = columnMappings[idx];
                      if (mapping.contactField) {
                        acc[mapping.contactField] = cell;
                      }
                      return acc;
                    }, {});

                    return {
                      status: result.isValid,
                      full_name: rowData.full_name || '',
                      email: rowData.email || '',
                      exists: (result as any).isExisting ? 'Yes' : 'No',
                      errors: result.errors,
                      warnings: result.warnings
                    };
                  })}
                  columns={[
                    {
                      title: 'Status',
                      dataIndex: 'status',
                      render: (value: boolean) => value ? (
                        <div className="flex justify-center">
                          <Tooltip content="Valid - Ready to import">
                            <Check className="h-5 w-5 text-green-500 cursor-help" />
                          </Tooltip>
                        </div>
                      ) : (
                        <div className="flex justify-center">
                          <Tooltip content="Invalid - Has errors">
                            <AlertTriangle className="h-5 w-5 text-red-500 cursor-help" />
                          </Tooltip>
                        </div>
                      ),
                    },
                    {
                      title: 'Name',
                      dataIndex: 'full_name',
                    },
                    {
                      title: 'Email',
                      dataIndex: 'email',
                    },
                    {
                      title: 'Exists',
                      dataIndex: 'exists',
                    },
                    {
                      title: 'Issues',
                      dataIndex: 'issues',
                      width: '40%',
                      render: (value: any, record: any) => {
                        const errors = record.errors || [];
                        const warnings = record.warnings || [];
                        
                        if (errors.length === 0 && warnings.length === 0) {
                          return <span className="text-gray-400">-</span>;
                        }
                        
                        return (
                          <div className="whitespace-normal break-words text-sm space-y-1 min-w-0">
                            {errors.length > 0 && (
                              <div className="text-red-600">
                                {errors.map((error: string, i: number) => (
                                  <div key={`error-${i}`} className="break-words">• {error}</div>
                                ))}
                              </div>
                            )}
                            {warnings.length > 0 && (
                              <div className="text-yellow-600">
                                {warnings.map((warning: string, i: number) => (
                                  <div key={`warning-${i}`} className="break-words">• {warning}</div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      },
                    }
                  ] as ColumnDefinition<any>[]}
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
              client: result.data.client || '',
              tags: result.data.tags || '',
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
