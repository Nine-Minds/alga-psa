'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Switch } from '@alga-psa/ui/components/Switch';
import { ColumnDefinition } from '@alga-psa/types';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { ICSVColumnMapping, ICSVPreviewData, ICSVValidationResult, IContact, MappableField, ICSVImportOptions, ImportContactResult } from '@alga-psa/types';
import { importContactsFromCSV, checkExistingEmails, generateContactCSVTemplate } from '@alga-psa/clients/actions';
import { Upload, AlertTriangle, Check, Download } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { parseCSV, unparseCSV } from '@alga-psa/core';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface ContactsImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: (contacts: IContact[]) => void;
  clients: { client_id: string; client_name: string; }[];
}

interface ImportOptionsProps {
  importOptions: ICSVImportOptions;
  onOptionsChange: (options: ICSVImportOptions) => void;
}

const ContactsImportDialog: React.FC<ContactsImportDialogProps> = ({
  isOpen,
  onClose,
  onImportComplete,
  clients
}) => {
  const { t } = useTranslation('msp/contacts');
  const [step, setStep] = useState<'upload' | 'mapping' | 'preview' | 'importing' | 'results' | 'complete'>('upload');
  const [previewData, setPreviewData] = useState<ICSVPreviewData | null>(null);
  const [fullCSVData, setFullCSVData] = useState<string[][] | null>(null);
  const [columnMappings, setColumnMappings] = useState<ICSVColumnMapping[]>([]);
  const [validationResults, setValidationResults] = useState<ICSVValidationResult[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [importOptions, setImportOptions] = useState<ICSVImportOptions>({
    updateExisting: false,
    skipInvalid: false,
    dryRun: false
  });
  const [importResults, setImportResults] = useState<ImportContactResult[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showUpdateConfirmation, setShowUpdateConfirmation] = useState(false);
  const [existingContactsCount, setExistingContactsCount] = useState(0);
  const [processingDetails, setProcessingDetails] = useState<{
    current: number;
    total: number;
    currentItem?: string;
  }>({ current: 0, total: 0 });
  const [failedRecords, setFailedRecords] = useState<ImportContactResult[]>([]);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const contactFields = useMemo(() => ({
    full_name: t('contactsImportDialog.fields.name', { defaultValue: 'Name *' }),
    email: t('contactsImportDialog.fields.email', { defaultValue: 'Email *' }),
    phone_number: t('contactsImportDialog.fields.defaultPhoneNumber', { defaultValue: 'Default Phone Number' }),
    client: t('contactsImportDialog.fields.client', { defaultValue: 'Client' }),
    tags: t('contactsImportDialog.fields.tags', { defaultValue: 'Tags' }),
    role: t('contactsImportDialog.fields.role', { defaultValue: 'Role' }),
    notes: t('contactsImportDialog.fields.notes', { defaultValue: 'Notes' })
  } as const), [t]);

  // Handle page size change - reset to page 1
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setStep('upload');
      setPreviewData(null);
      setFullCSVData(null);
      setColumnMappings([]);
      setValidationResults([]);
      setErrors([]);
      setImportOptions({
        updateExisting: false,
        skipInvalid: false,
        dryRun: false
      });
      setImportResults([]);
      setIsProcessing(false);
      setShowUpdateConfirmation(false);
      setExistingContactsCount(0);
      setProcessingDetails({ current: 0, total: 0 });
      setFailedRecords([]);
      setCurrentPage(1);
      setPageSize(10);
    }
  }, [isOpen]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = event.target.files?.[0];
    if (!uploadedFile) return;

    setErrors([]);

    try {
      const text = await uploadedFile.text();
      const rows = parseCSV(text) as string[][];
      
      if (rows.length < 2) {
        throw new Error(t('contactsImportDialog.errors.emptyCsv', { defaultValue: 'CSV file is empty or invalid' }));
      }

      const headers = rows[0];
      const dataRows = rows.slice(1); // All data rows (excluding header)

      setFullCSVData(dataRows); // Store all rows for import
      setPreviewData({
        headers,
        rows: dataRows.slice(0, 5) // First 5 rows for preview only
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
      setErrors([t('contactsImportDialog.errors.readingCsv', {
        defaultValue: 'Error reading CSV file: {{message}}',
        message: error instanceof Error ? error.message : t('contactsImportDialog.errors.unknownError', { defaultValue: 'Unknown error' })
      })]);
    }
  };

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
        errors.push(t('contactsImportDialog.errors.requiredFieldNotMapped', {
          defaultValue: `Required field "${contactFields[requiredField]}" is not mapped`,
          field: contactFields[requiredField]
        }));
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

    if (fullCSVData) {
      setIsProcessing(true);
      setErrors([]);

      try {
        // Process ALL rows from fullCSVData, not just preview rows
        const results = fullCSVData.map((row: string[]): ICSVValidationResult => {
          const mappedData: Record<MappableField, string> = {} as Record<MappableField, string>;
          const errors: string[] = [];
          const warnings: string[] = [];

          columnMappings.forEach((mapping, index) => {
            if (mapping.contactField !== null) {
              mappedData[mapping.contactField] = row[index];
            }
          });

          if (!mappedData.full_name) errors.push(t('contactsImportDialog.errors.nameRequired', { defaultValue: 'Name is required' }));
          if (!mappedData.email) {
            errors.push(t('contactsImportDialog.errors.emailRequired', { defaultValue: 'Email is required' }));
          } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mappedData.email)) {
            errors.push(t('contactsImportDialog.errors.invalidEmail', { defaultValue: 'Invalid email format' }));
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

        // Count existing contacts
        const existingCount = resultsWithExisting.filter(r => r.isExisting).length;
        if (existingCount > 0 && !importOptions.updateExisting) {
          setExistingContactsCount(existingCount);
          setShowUpdateConfirmation(true);
        }

        setValidationResults(resultsWithExisting);
        setStep('preview');
      } catch (error) {
        setErrors([error instanceof Error ? error.message : t('contactsImportDialog.errors.processingCsv', { defaultValue: 'Error processing CSV data' })]);
      } finally {
        setIsProcessing(false);
      }
    }
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
    setStep('importing');
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
      setErrors([error instanceof Error ? error.message : t('contactsImportDialog.errors.importFailed', { defaultValue: 'Import failed' })]);
      setStep('results');
    } finally {
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

    await processImport(validData);
  };

  const handleDownloadFailedRecords = () => {
    const fields = ['full_name', 'email', 'phone_number', 'client', 'tags', 'role', 'notes'];
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
          <div className="text-gray-900 font-medium">{t('contactsImportDialog.importOptions.updateExisting.title', { defaultValue: 'Update existing contacts' })}</div>
          <div className="text-sm text-gray-500">{t('contactsImportDialog.importOptions.updateExisting.description', { defaultValue: 'Replace data for existing contacts' })}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-700">
            {importOptions.updateExisting ? t('common.yes', { defaultValue: 'Yes' }) : t('common.no', { defaultValue: 'No' })}
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
          <div className="text-gray-900 font-medium">{t('contactsImportDialog.importOptions.skipInvalid.title', { defaultValue: 'Skip invalid records' })}</div>
          <div className="text-sm text-gray-500">{t('contactsImportDialog.importOptions.skipInvalid.description', { defaultValue: 'Continue import even if some records have validation errors' })}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-700">
            {importOptions.skipInvalid ? t('common.yes', { defaultValue: 'Yes' }) : t('common.no', { defaultValue: 'No' })}
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
        <h3 className="text-lg font-medium">{t('contactsImportDialog.results.title', { defaultValue: 'Import Results' })}</h3>
        {failedRecords.length > 0 && (
          <Button
            id="download-failed-records"
            variant="outline"
            onClick={handleDownloadFailedRecords}
            className="flex items-center gap-2"
          >
            <Download size={16} />
            {t('contactsImportDialog.results.downloadFailedRecords', { defaultValue: 'Download Failed Records' })}
          </Button>
        )}
      </div>
      <DataTable
        key={`${currentPage}-${pageSize}`}
        id="contacts-import-preview-table"
        data={importResults}
        pagination={true}
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        pageSize={pageSize}
        onItemsPerPageChange={handlePageSizeChange}
        columns={[
          {
            title: t('contactsImportDialog.table.status', { defaultValue: 'Status' }),
            dataIndex: 'success',
            render: (value: boolean) => value ? (
              <div className="flex justify-center">
                <Tooltip content={t('contactsImportDialog.tooltips.importSuccessful', { defaultValue: 'Import successful' })}>
                  <Check className="h-5 w-5 text-green-500 cursor-help" />
                </Tooltip>
              </div>
            ) : (
              <div className="flex justify-center">
                <Tooltip content={t('contactsImportDialog.tooltips.importFailed', { defaultValue: 'Import failed' })}>
                  <AlertTriangle className="h-5 w-5 text-red-500 cursor-help" />
                </Tooltip>
              </div>
            ),
          },
          {
            title: t('contactsImportDialog.table.name', { defaultValue: 'Name' }),
            dataIndex: 'originalData',
            render: (value: Record<string, string>) => value.full_name,
          },
          {
            title: t('contactsImportDialog.table.email', { defaultValue: 'Email' }),
            dataIndex: 'originalData',
            render: (value: Record<string, string>) => value.email,
          },
          {
            title: t('contactsImportDialog.table.message', { defaultValue: 'Message' }),
            dataIndex: 'message',
            width: '40%',
            render: (value: string) => (
              <div className="whitespace-normal break-words text-sm min-w-0">
                {value}
              </div>
            ),
          },
        ] as ColumnDefinition<ImportContactResult>[]}
      />
      <DialogFooter>
        <Button id='close-import-dialog' onClick={onClose}>{t('common.actions.close', { defaultValue: 'Close' })}</Button>
      </DialogFooter>
    </div>
  );

  return (
    <>
      <Dialog
        isOpen={isOpen}
        onClose={onClose}
        title={t('contactsImportDialog.title', { defaultValue: 'Import Contacts' })}
        className="max-w-5xl"
      >
        <DialogContent>
          {errors.length > 0 && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>
                <ul>
                  {errors.map((error: string, index: number): React.JSX.Element => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {step === 'upload' && (
            <div>
              <div className="text-center p-8 border-2 border-dashed border-gray-300 rounded-lg">
                <Upload className="mx-auto h-12 w-12 text-gray-400" />
                <p className="mt-2 text-sm text-gray-600">{t('contactsImportDialog.upload.help', { defaultValue: 'Upload a CSV file with contact data' })}</p>
                <p className="mt-1 text-xs text-gray-500">
                  <strong>{t('contactsImportDialog.upload.requiredLabel', { defaultValue: 'Required:' })}</strong> full_name, email<br />
                  <strong>{t('contactsImportDialog.upload.contactFieldsLabel', { defaultValue: 'Contact fields:' })}</strong> {t('contactsImportDialog.upload.contactFieldsDescription', { defaultValue: 'phone_number (imports as the default work phone), role, notes, tags' })}<br />
                  <strong>{t('contactsImportDialog.upload.clientFieldLabel', { defaultValue: 'Client field:' })}</strong> {t('contactsImportDialog.upload.clientFieldDescription', { defaultValue: 'client (matches existing clients by name)' })}<br />
                  <strong>{t('contactsImportDialog.upload.noteLabel', { defaultValue: 'Note:' })}</strong> {t('contactsImportDialog.upload.noteDescription', { defaultValue: 'CSV import/export in v1 handles one default phone number per contact. Tags should be comma-separated values.' })}
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
                  {t('contactsImportDialog.upload.downloadTemplate', { defaultValue: 'Download CSV Template' })}
                </Button>
              </div>
            </div>
          )}

          {step === 'mapping' && previewData && (
            <div>
              <h3 className="text-lg font-medium mb-4">{t('contactsImportDialog.mapping.title', { defaultValue: 'Map Contact Fields to CSV Columns' })}</h3>
              <p className="text-sm text-gray-600 mb-4">
                {t('contactsImportDialog.mapping.description', { defaultValue: 'Select which CSV column contains the data for each contact field. Fields marked with * are required.' })}
              </p>
              <div className="max-h-[60vh] overflow-y-auto pr-2">
                <div className="mb-2 flex items-center gap-4 text-sm font-semibold text-gray-700">
                  <span className="w-1/3">{t('contactsImportDialog.mapping.contactFieldHeader', { defaultValue: 'Contact Field' })}</span>
                  <span className="w-2/3">{t('contactsImportDialog.mapping.csvColumnHeader', { defaultValue: 'Select CSV Column' })}</span>
                </div>
                <div className="border-t pt-4 space-y-3">
                  {Object.entries(contactFields).map(([fieldKey, fieldLabel]: [string, string]): React.JSX.Element => {
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
                            { value: 'unassigned', label: t('contactsImportDialog.mapping.notMapped', { defaultValue: 'Not mapped' }) },
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
                <p>{t('contactsImportDialog.mapping.requiredFieldsNote', { defaultValue: '* Required fields must be mapped for import to proceed' })}</p>
              </div>
              {fullCSVData && fullCSVData.length > 100 && (
                <Alert variant="warning" className="mt-4">
                  <AlertDescription>
                    {t('contactsImportDialog.mapping.largeImportWarning', {
                      defaultValue: 'You are importing {{count}} records. Processing may take a moment.',
                      count: fullCSVData.length
                    })}
                  </AlertDescription>
                </Alert>
              )}
              <div className="mt-4">
                <DialogFooter>
                  <Button id='back-to-upload' variant="outline" onClick={() => setStep('upload')} disabled={isProcessing}>{t('common.actions.back', { defaultValue: 'Back' })}</Button>
                  <Button id='preview-import' onClick={handlePreview} disabled={isProcessing}>
                    {isProcessing ? t('contactsImportDialog.mapping.processing', { defaultValue: 'Processing...' }) : t('contactsImportDialog.mapping.preview', { defaultValue: 'Preview' })}
                  </Button>
                </DialogFooter>
              </div>
            </div>
          )}

          {step === 'preview' && validationResults.length > 0 && (
            <div>
              <h3 className="text-lg font-medium mb-4">{t('contactsImportDialog.preview.title', { defaultValue: 'Preview Import' })}</h3>
              <Alert variant="info" className="mb-4">
                <AlertDescription>
                  <strong>{t('contactsImportDialog.preview.totalRecords', { defaultValue: 'Total records:' })}</strong> {validationResults.length} |
                  <strong className="ml-2">{t('contactsImportDialog.preview.valid', { defaultValue: 'Valid:' })}</strong> {validationResults.filter(r => r.isValid).length} |
                  <strong className="ml-2">{t('contactsImportDialog.preview.invalid', { defaultValue: 'Invalid:' })}</strong> {validationResults.filter(r => !r.isValid).length}
                </AlertDescription>
              </Alert>
              <ImportOptions
                importOptions={importOptions}
                onOptionsChange={setImportOptions}
              />
              <div className="max-h-96 overflow-x-auto overflow-y-auto">
                <DataTable
                  key={`${currentPage}-${pageSize}`}
                  id="contacts-import-preview-table"
                  pagination={true}
                  currentPage={currentPage}
                  onPageChange={setCurrentPage}
                  pageSize={pageSize}
                  onItemsPerPageChange={handlePageSizeChange}
                  data={validationResults.map((result: ICSVValidationResult, index: number): Record<string, any> => {
                    const rowData = (fullCSVData?.[index] || []).reduce((
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
                      exists: (result as any).isExisting ? t('common.yes', { defaultValue: 'Yes' }) : t('common.no', { defaultValue: 'No' }),
                      errors: result.errors,
                      warnings: result.warnings
                    };
                  })}
                  columns={[
                    {
                      title: t('contactsImportDialog.table.status', { defaultValue: 'Status' }),
                      dataIndex: 'status',
                      render: (value: boolean) => value ? (
                        <div className="flex justify-center">
                          <Tooltip content={t('contactsImportDialog.tooltips.validReady', { defaultValue: 'Valid - Ready to import' })}>
                            <Check className="h-5 w-5 text-green-500 cursor-help" />
                          </Tooltip>
                        </div>
                      ) : (
                        <div className="flex justify-center">
                          <Tooltip content={t('contactsImportDialog.tooltips.invalidHasErrors', { defaultValue: 'Invalid - Has errors' })}>
                            <AlertTriangle className="h-5 w-5 text-red-500 cursor-help" />
                          </Tooltip>
                        </div>
                      ),
                    },
                    {
                      title: t('contactsImportDialog.table.name', { defaultValue: 'Name' }),
                      dataIndex: 'full_name',
                    },
                    {
                      title: t('contactsImportDialog.table.email', { defaultValue: 'Email' }),
                      dataIndex: 'email',
                    },
                    {
                      title: t('contactsImportDialog.table.exists', { defaultValue: 'Exists' }),
                      dataIndex: 'exists',
                    },
                    {
                      title: t('contactsImportDialog.table.issues', { defaultValue: 'Issues' }),
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
                />
              </div>
              <DialogFooter>
                <Button id='back-to-mapping' variant="outline" onClick={() => setStep('mapping')}>{t('common.actions.back', { defaultValue: 'Back' })}</Button>
                <Button
                  id='import-contacts'
                  onClick={handleImport}
                  disabled={validationResults.every(result => !result.isValid)}
                >
                  {t('common.actions.import', { defaultValue: 'Import' })}
                </Button>
              </DialogFooter>
            </div>
          )}

          {step === 'importing' && (
            <div>
              <h3 className="text-lg font-medium mb-4">{t('contactsImportDialog.importing.title', { defaultValue: 'Importing Contacts' })}</h3>
              <div className="mb-4">
                <div className="flex justify-between text-sm text-gray-600 mb-1">
                  <span>{t('contactsImportDialog.importing.processing', { defaultValue: 'Processing: {{current}} of {{total}}', current: processingDetails.current, total: processingDetails.total })}</span>
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
                  {t('contactsImportDialog.importing.currentItem', { defaultValue: 'Currently processing: {{item}}', item: processingDetails.currentItem })}
                </p>
              )}
            </div>
          )}

          {step === 'results' && <ResultsView />}

          {step === 'complete' && (
            <div className="text-center">
              <Check className="h-12 w-12 text-green-500 mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">{t('contactsImportDialog.complete.title', { defaultValue: 'Import Complete' })}</h3>
              <p className="text-gray-600 mb-4">
                {t('contactsImportDialog.complete.successMessage', {
                  defaultValue: 'Successfully imported {{count}} contacts',
                  count: importResults.filter((r: ImportContactResult): boolean => r.success).length
                })}
              </p>
              <DialogFooter>
                <Button id='close-import-complete' onClick={onClose}>{t('common.actions.close', { defaultValue: 'Close' })}</Button>
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
        }}
        title={t('contactsImportDialog.confirmUpdate.title', { defaultValue: 'Update Existing Contacts' })}
        message={t('contactsImportDialog.confirmUpdate.message', {
          defaultValue: '{{count}} contacts already exist. Do you want to update them with the new data?',
          count: existingContactsCount
        })}
        confirmLabel={t('common.actions.update', { defaultValue: 'Update' })}
        cancelLabel={t('common.actions.cancel', { defaultValue: 'Cancel' })}
      />
    </>
  );
};

export default ContactsImportDialog;
