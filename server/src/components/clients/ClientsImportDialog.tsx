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
import { IClient } from 'server/src/interfaces/client.interfaces';
import { Upload, AlertTriangle, Check } from 'lucide-react';
import { parseCSV } from 'server/src/lib/utils/csvParser';
import { checkExistingClients, importClientsFromCSV, generateClientCSVTemplate } from 'server/src/lib/actions/client-actions/clientActions';
import { Tooltip } from 'server/src/components/ui/Tooltip';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';

interface ClientsImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: (clients: IClient[], updateExisting: boolean) => void;
}

type MappableClientField = 
  | 'client_name'
  | 'email'
  | 'phone_number'
  | 'website'
  | 'client_type'
  | 'is_inactive'
  | 'notes'
  | 'tags'
  | 'location_name'
  | 'address_line1'
  | 'address_line2'
  | 'city'
  | 'state_province'
  | 'postal_code'
  | 'country';

interface ICSVColumnMapping {
  csvHeader: string;
  clientField: MappableClientField | null;
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

const COMPANY_FIELDS: Record<MappableClientField, string> = {
  client_name: 'Client Name *',
  email: 'Email',
  phone_number: 'Phone Number',
  website: 'Website',
  client_type: 'Client Type',
  is_inactive: 'Is Inactive',
  notes: 'Notes',
  tags: 'Tags',
  location_name: 'Location Name',
  address_line1: 'Address Line 1',
  address_line2: 'Address Line 2',
  city: 'City',
  state_province: 'State/Province',
  postal_code: 'Postal Code',
  country: 'Country'
} as const;

const ClientsImportDialog: React.FC<ClientsImportDialogProps> = ({
  isOpen,
  onClose,
  onImportComplete,
}) => {
  const [step, setStep] = useState<'upload' | 'mapping' | 'preview' | 'importing' | 'complete'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<ICSVPreviewData | null>(null);
  const [fullCSVData, setFullCSVData] = useState<string[][] | null>(null);
  const [columnMappings, setColumnMappings] = useState<ICSVColumnMapping[]>([]);
  const [validationResults, setValidationResults] = useState<ICSVValidationResult[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [importOptions, setImportOptions] = useState<ImportOptions>({
    updateExisting: false,
    skipInvalid: false
  });
  const [showUpdateConfirmation, setShowUpdateConfirmation] = useState(false);
  const [existingClientsCount, setExistingClientsCount] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showOptionalFields, setShowOptionalFields] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Handle page size change - reset to page 1
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setStep('upload');
      setFile(null);
      setPreviewData(null);
      setFullCSVData(null);
      setColumnMappings([]);
      setValidationResults([]);
      setErrors([]);
      setImportOptions({
        updateExisting: false,
        skipInvalid: false
      });
      setShowUpdateConfirmation(false);
      setExistingClientsCount(0);
      setIsProcessing(false);
      setShowOptionalFields(false);
      setCurrentPage(1);
      setPageSize(10);
    }
  }, [isOpen]);

  const getFieldOptions = useCallback((currentMappingValue: string | null) => {
    // Get all currently mapped fields except the current one
    const mappedFields = columnMappings
      .filter(m => m.clientField && m.clientField !== currentMappingValue)
      .map(m => m.clientField);
    
    return [
      { value: 'unassigned', label: 'Select field' },
      ...Object.entries(COMPANY_FIELDS)
        .filter(([value]) => !mappedFields.includes(value as MappableClientField))
        .map(([value, label]): { value: string; label: string } => ({
          value,
          label,
        })),
    ];
  }, [columnMappings]);

  const validateClientData = useCallback((mappedData: Record<string, any>): ICSVValidationResult => {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!mappedData.client_name) {
      errors.push('Client name is required');
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

    if (mappedData.is_inactive && mappedData.is_inactive.toLowerCase() !== 'true' && mappedData.is_inactive.toLowerCase() !== 'false') {
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
        client_name: mappedData.client_name,
        tenant: 'default',
        is_inactive: mappedData.is_inactive ? mappedData.is_inactive.toLowerCase() === 'true' : false,
        is_tax_exempt: mappedData.is_tax_exempt ? mappedData.is_tax_exempt.toLowerCase() === 'true' : false,
        auto_invoice: mappedData.auto_invoice ? mappedData.auto_invoice.toLowerCase() === 'true' : false,
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
      const dataRows = rows.slice(1); // All data rows (excluding header)

      setFullCSVData(dataRows); // Store all rows for import
      setPreviewData({
        headers,
        rows: dataRows.slice(0, 5) // First 5 rows for preview only
      });

      // Auto-map columns based on header names
      const autoMappings: ICSVColumnMapping[] = headers.map((header): ICSVColumnMapping => {
        const headerLower = header.toLowerCase();
        let clientField: MappableClientField | null = null;

        Object.entries(COMPANY_FIELDS).forEach(([field, label]) => {
          if (headerLower.includes(field.toLowerCase()) || 
              headerLower.includes(label.toLowerCase())) {
            clientField = field as MappableClientField;
          }
        });

        return {
          csvHeader: header,
          clientField
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
          ? { ...mapping, clientField: value === 'unassigned' ? null : value as MappableClientField }
          : mapping
      )
    );
  }, []);

  const validateMappings = useCallback(() => {
    const errors: string[] = [];
    const requiredFields: MappableClientField[] = ['client_name'];

    for (const requiredField of requiredFields) {
      if (!columnMappings.some(mapping => mapping.clientField === requiredField)) {
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

    if (fullCSVData) {
      setIsProcessing(true);
      setErrors([]);

      try {
        // Process ALL rows from fullCSVData, not just preview rows
        const results = fullCSVData.map((row): ICSVValidationResult => {
          const mappedData: Record<string, any> = {};
          columnMappings.forEach((mapping, index) => {
            if (mapping.clientField) {
              mappedData[mapping.clientField] = row[index];
            }
          });

          return validateClientData(mappedData);
        });

        // Check for existing clients
        const clientNames = results
          .filter(result => result.isValid && result.data.client_name)
          .map((result): string => result.data.client_name);

        const existingClients = await checkExistingClients(clientNames);
        const existingClientNames = new Set(existingClients.map((c): string => c.client_name.toLowerCase()));

        // Mark existing clients in validation results
        const updatedResults = results.map((result): ICSVValidationResult => ({
          ...result,
          isExisting: result.data.client_name ? existingClientNames.has(result.data.client_name.toLowerCase()) : false
        }));

        const existingCount = updatedResults.filter(result => result.isExisting).length;

        if (existingCount > 0) {
          setExistingClientsCount(existingCount);
          setShowUpdateConfirmation(true);
        }

        setValidationResults(updatedResults);
        setStep('preview');
      } catch (error) {
        setErrors([error instanceof Error ? error.message : 'Error processing CSV data']);
      } finally {
        setIsProcessing(false);
      }
    }
  }, [fullCSVData, columnMappings, validateClientData, validateMappings]);

  const handleImport = useCallback(async () => {
    if (isProcessing) return;

    try {
      setIsProcessing(true);
      const validClients = validationResults
        .filter(result => result.isValid || importOptions.skipInvalid)
        .map((result): IClient => result.data as IClient);

      await importClientsFromCSV(validClients, importOptions.updateExisting);
      await onImportComplete(validClients, importOptions.updateExisting);
      setStep('complete');
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'Error importing clients']);
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, validationResults, importOptions, onImportComplete]);

  const handleClose = useCallback(() => {
    if (!isProcessing) {
      setStep('upload');
      setFile(null);
      setPreviewData(null);
      setFullCSVData(null);
      setColumnMappings([]);
      setValidationResults([]);
      setErrors([]);
      setImportOptions({
        updateExisting: false,
        skipInvalid: false
      });
      setShowUpdateConfirmation(false);
      setExistingClientsCount(0);
      setShowOptionalFields(false);
      onClose();
    }
  }, [isProcessing, onClose]);

  return (
    <>
      <Dialog
        isOpen={isOpen} 
        onClose={handleClose} 
        title="Import Clients"
        className="max-w-5xl"
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
              <p className="mt-2 text-sm text-gray-600">Upload a CSV file with client data</p>
              <p className="mt-1 text-xs text-gray-500">
                <strong>Required:</strong> client_name<br />
                <strong>Client fields:</strong> website, client_type, is_inactive, notes, tags<br />
                <strong>Location fields:</strong> location_name, email, phone_number, address_line1, address_line2, city, state_province, postal_code, country<br />
                <strong>Note:</strong> is_inactive should be 'true' or 'false' (case-insensitive)
              </p>
              <div className="mt-4 space-y-3">
                <Input
                  id="client-csv-upload"
                  type="file"
                  accept=".csv"
                  onChange={handleFileUpload}
                  disabled={isProcessing}
                />
                <Button
                  id="download-template-btn"
                  variant="outline"
                  onClick={async () => {
                    const template = await generateClientCSVTemplate();
                    const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' });
                    const link = document.createElement('a');
                    const url = URL.createObjectURL(blob);
                    link.setAttribute('href', url);
                    link.setAttribute('download', 'client_import_template.csv');
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
              <h3 className="text-lg font-medium mb-4">Map Client Fields to CSV Columns</h3>
              <p className="text-sm text-gray-600 mb-4">
                Select which CSV column contains the data for each client field. Fields marked with * are required.
              </p>
              <div className="max-h-[60vh] overflow-y-auto pr-2">
                <div className="mb-2 flex items-center gap-4 text-sm font-semibold text-gray-700">
                  <span className="w-1/3">Client Field</span>
                  <span className="w-2/3">Select CSV Column</span>
                </div>
                <div className="border-t pt-4 space-y-3">
                  {Object.entries(COMPANY_FIELDS).map(([fieldKey, fieldLabel]: [string, string]): JSX.Element => {
                    const currentMapping = columnMappings.find(m => m.clientField === fieldKey);
                    const csvHeader = currentMapping?.csvHeader || 'unassigned';
                    
                    // Get already mapped CSV headers (excluding current field's mapping)
                    const mappedHeaders = columnMappings
                      .filter(m => m.clientField && m.clientField !== fieldKey)
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
                            // Clear any existing mapping for this CSV column
                            if (value !== 'unassigned') {
                              setColumnMappings(prev => prev.map(m => 
                                m.csvHeader === value ? { ...m, clientField: null } : m
                              ));
                            }
                            // Update the mapping for this field
                            if (currentMapping) {
                              handleMapColumn(currentMapping.csvHeader, value !== 'unassigned' ? fieldKey as MappableClientField : 'unassigned');
                            } else if (value !== 'unassigned') {
                              // Find the mapping for the selected CSV column and update it
                              const targetMapping = columnMappings.find(m => m.csvHeader === value);
                              if (targetMapping) {
                                handleMapColumn(value, fieldKey as MappableClientField);
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
                <p className="mt-1">Note: is_inactive should be 'true' or 'false' (case-insensitive)</p>
              </div>
              {fullCSVData && fullCSVData.length > 100 && (
                <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                  <p className="text-sm text-yellow-800">
                    <AlertTriangle className="inline h-4 w-4 mr-1" />
                    You are importing {fullCSVData.length} records. Processing may take a moment.
                  </p>
                </div>
              )}
              <div className="mt-4">
                <DialogFooter>
                  <Button id="mapping-back-btn" variant="outline" onClick={() => setStep('upload')} disabled={isProcessing}>Back</Button>
                  <Button id="mapping-preview-btn" onClick={handlePreview} disabled={isProcessing}>
                    {isProcessing ? 'Processing...' : 'Preview'}
                  </Button>
                </DialogFooter>
              </div>
            </div>
          )}

          {step === 'preview' && validationResults.length > 0 && (
            <div>
              <h3 className="text-lg font-medium mb-4">Preview Import</h3>
              <Alert variant="info" className="mb-4">
                <AlertDescription>
                  <strong>Total records:</strong> {validationResults.length} |
                  <strong className="ml-2">Valid:</strong> {validationResults.filter(r => r.isValid).length} |
                  <strong className="ml-2">Invalid:</strong> {validationResults.filter(r => !r.isValid).length}
                </AlertDescription>
              </Alert>
              <div className="mb-6 space-y-4">
                <div className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-gray-900 font-medium">Update existing clients</div>
                    <div className="text-sm text-gray-500">Replace data for existing clients</div>
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
              <div className="max-h-96 overflow-x-auto overflow-y-auto">
                <DataTable
                  key={`${currentPage}-${pageSize}`}
                  id="clients-import-preview-table"
                  pagination={true}
                  currentPage={currentPage}
                  onPageChange={setCurrentPage}
                  pageSize={pageSize}
                  onItemsPerPageChange={handlePageSizeChange}
                  data={validationResults.map((result, index): Record<string, any> => ({
                    status: result.isValid,
                    client_name: result.data.client_name,
                    email: result.data.email,
                    exists: result.isExisting ? 'Yes' : 'No',
                    errors: result.errors,
                    warnings: result.warnings
                  }))}
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
                      title: 'Client Name',
                      dataIndex: 'client_name',
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
                Successfully imported {validationResults.filter(r => r.isValid).length} clients
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
        title="Update Existing Clients"
        message={`${existingClientsCount} clients already exist. Do you want to update them with the new data?`}
        confirmLabel="Update"
        cancelLabel="Cancel"
      />
    </>
  );
};

export default ClientsImportDialog;
