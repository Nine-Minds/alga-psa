'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import UserPicker from 'server/src/components/ui/UserPicker';
import { IUser } from '@shared/interfaces/user.interfaces';
import { DataTable } from 'server/src/components/ui/DataTable';
import { Switch } from 'server/src/components/ui/Switch';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { Upload, AlertTriangle, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { parseCSV } from 'server/src/lib/utils/csvParser';
import { Tooltip } from 'server/src/components/ui/Tooltip';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import {
  generatePhaseTaskCSVTemplate,
  getImportReferenceData,
  validatePhaseTaskImportDataWithReferenceData,
  importPhasesAndTasks,
  groupRowsIntoPhases,
} from 'server/src/lib/actions/project-actions/phaseTaskImportActions';
import {
  MappableTaskField,
  ICSVTaskColumnMapping,
  ICSVTaskPreviewData,
  ITaskImportRow,
  ITaskImportValidationResult,
  IGroupedPhaseData,
  IPhaseTaskImportResult,
  IImportReferenceData,
  IStatusResolution,
  IUnmatchedStatusInfo,
  StatusResolutionAction,
  IAgentResolution,
  IUnmatchedAgentInfo,
  AgentResolutionAction,
  TASK_IMPORT_FIELDS,
  DEFAULT_PHASE_NAME,
} from 'server/src/interfaces/phaseTaskImport.interfaces';
import { IProjectStatusMapping } from 'server/src/interfaces/project.interfaces';

interface PhaseTaskImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  onImportComplete: (result: IPhaseTaskImportResult) => void;
}

type ImportStep = 'upload' | 'mapping' | 'preview' | 'agent_resolution' | 'status_resolution' | 'importing' | 'complete';

interface ImportOptions {
  skipInvalidRows: boolean;
}

// Maximum number of rows to import at once to prevent memory issues
const MAX_IMPORT_ROWS = 5000;

// Threshold for showing confirmation before import
const LARGE_IMPORT_THRESHOLD = 100;

const PhaseTaskImportDialog: React.FC<PhaseTaskImportDialogProps> = ({
  isOpen,
  onClose,
  projectId,
  onImportComplete,
}) => {
  const [step, setStep] = useState<ImportStep>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<ICSVTaskPreviewData | null>(null);
  const [fullCSVData, setFullCSVData] = useState<string[][] | null>(null);
  const [columnMappings, setColumnMappings] = useState<ICSVTaskColumnMapping[]>([]);
  const [validationResults, setValidationResults] = useState<ITaskImportValidationResult[]>([]);
  const [groupedPhases, setGroupedPhases] = useState<IGroupedPhaseData[]>([]);
  const [importResult, setImportResult] = useState<IPhaseTaskImportResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [importOptions, setImportOptions] = useState<ImportOptions>({
    skipInvalidRows: false,
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Lookup maps from validation
  const [userLookup, setUserLookup] = useState<Record<string, string>>({});
  const [priorityLookup, setPriorityLookup] = useState<Record<string, string>>({});
  const [serviceLookup, setServiceLookup] = useState<Record<string, string>>({});
  const [statusLookup, setStatusLookup] = useState<Record<string, string>>({});

  // Status resolution state
  const [unmatchedStatuses, setUnmatchedStatuses] = useState<string[]>([]);
  const [unmatchedStatusInfo, setUnmatchedStatusInfo] = useState<IUnmatchedStatusInfo[]>([]);
  const [statusResolutions, setStatusResolutions] = useState<IStatusResolution[]>([]);
  const [projectStatusMappings, setProjectStatusMappings] = useState<IProjectStatusMapping[]>([]);

  // Agent resolution state
  const [unmatchedAgents, setUnmatchedAgents] = useState<string[]>([]);
  const [unmatchedAgentInfo, setUnmatchedAgentInfo] = useState<IUnmatchedAgentInfo[]>([]);
  const [agentResolutions, setAgentResolutions] = useState<IAgentResolution[]>([]);
  const [availableUsers, setAvailableUsers] = useState<IImportReferenceData['users']>([]);

  // Track if rows were truncated due to limit
  const [rowsTruncated, setRowsTruncated] = useState<{ original: number; kept: number } | null>(null);

  // Confirmation state for large imports
  const [importConfirmed, setImportConfirmed] = useState(false);

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
      setGroupedPhases([]);
      setImportResult(null);
      setErrors([]);
      setImportOptions({ skipInvalidRows: false });
      setIsProcessing(false);
      setExpandedPhases(new Set());
      setCurrentPage(1);
      setPageSize(10);
      setUserLookup({});
      setPriorityLookup({});
      setServiceLookup({});
      setStatusLookup({});
      setUnmatchedStatuses([]);
      setUnmatchedStatusInfo([]);
      setStatusResolutions([]);
      setProjectStatusMappings([]);
      setUnmatchedAgents([]);
      setUnmatchedAgentInfo([]);
      setAgentResolutions([]);
      setAvailableUsers([]);
      setRowsTruncated(null);
      setImportConfirmed(false);
    }
  }, [isOpen]);

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = event.target.files?.[0];
    if (!uploadedFile) return;

    setFile(uploadedFile);
    setErrors([]);
    setIsProcessing(true);

    try {
      const text = await uploadedFile.text();
      const rows = parseCSV(text) as string[][];

      if (rows.length < 2) {
        throw new Error('CSV file is empty or has no data rows');
      }

      const headers = rows[0];
      let dataRows = rows.slice(1);

      // Check if we need to truncate for memory safety
      if (dataRows.length > MAX_IMPORT_ROWS) {
        setRowsTruncated({ original: dataRows.length, kept: MAX_IMPORT_ROWS });
        dataRows = dataRows.slice(0, MAX_IMPORT_ROWS);
      } else {
        setRowsTruncated(null);
      }

      setFullCSVData(dataRows);
      setPreviewData({
        headers,
        rows: dataRows.slice(0, 5),
      });

      // Auto-map columns based on header names
      const autoMappings: ICSVTaskColumnMapping[] = headers.map((header): ICSVTaskColumnMapping => {
        const headerLower = header.toLowerCase().replace(/[_\s-]/g, '');
        let taskField: MappableTaskField | null = null;

        // Try to match header to field
        Object.entries(TASK_IMPORT_FIELDS).forEach(([field, { label }]) => {
          const fieldLower = field.toLowerCase().replace(/[_\s-]/g, '');
          const labelLower = label.toLowerCase().replace(/[_\s-*]/g, '');

          if (headerLower === fieldLower || headerLower === labelLower ||
              headerLower.includes(fieldLower) || fieldLower.includes(headerLower)) {
            taskField = field as MappableTaskField;
          }
        });

        return {
          csvHeader: header,
          taskField,
        };
      });

      setColumnMappings(autoMappings);
      setStep('mapping');
    } catch (error) {
      setFile(null);
      setErrors([error instanceof Error ? error.message : 'Error reading CSV file']);
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const handleMapColumn = useCallback((csvHeader: string, fieldKey: string) => {
    setColumnMappings(prev =>
      prev.map((mapping): ICSVTaskColumnMapping =>
        mapping.csvHeader === csvHeader
          ? { ...mapping, taskField: fieldKey === 'unassigned' ? null : fieldKey as MappableTaskField }
          : mapping
      )
    );
  }, []);

  const validateMappings = useCallback(() => {
    const errors: string[] = [];
    const requiredFields: MappableTaskField[] = ['task_name'];

    for (const requiredField of requiredFields) {
      if (!columnMappings.some(mapping => mapping.taskField === requiredField)) {
        errors.push(`Required field "${TASK_IMPORT_FIELDS[requiredField].label}" is not mapped`);
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

    if (!fullCSVData) return;

    setIsProcessing(true);
    setErrors([]);

    try {
      // Map CSV data to ITaskImportRow objects
      const mappedRows: ITaskImportRow[] = fullCSVData.map((row) => {
        const mappedData: ITaskImportRow = {};
        columnMappings.forEach((mapping, index) => {
          if (mapping.taskField) {
            (mappedData as Record<string, string>)[mapping.taskField] = row[index] || '';
          }
        });
        return mappedData;
      });

      // Fetch all reference data in a single transaction
      const referenceData = await getImportReferenceData(projectId);

      // Validate the data using the pre-fetched reference data (pure function)
      const validationResponse = await validatePhaseTaskImportDataWithReferenceData(mappedRows, referenceData);

      setValidationResults(validationResponse.validationResults);
      setUserLookup(validationResponse.userLookup);
      setPriorityLookup(validationResponse.priorityLookup);
      setServiceLookup(validationResponse.serviceLookup);
      setStatusLookup(validationResponse.statusLookup);
      setUnmatchedStatuses(validationResponse.unmatchedStatuses);
      setUnmatchedAgents(validationResponse.unmatchedAgents);

      // Use reference data for dropdowns (no additional fetches needed)
      setProjectStatusMappings(referenceData.statusMappings as IProjectStatusMapping[]);
      setAvailableUsers(referenceData.users);

      // Compute unmatched status info (which tasks have each unmatched status)
      const statusInfoMap = new Map<string, IUnmatchedStatusInfo>();
      validationResponse.validationResults.forEach(result => {
        const statusName = result.data.status?.trim();
        if (statusName && validationResponse.unmatchedStatuses.includes(statusName)) {
          if (!statusInfoMap.has(statusName)) {
            statusInfoMap.set(statusName, {
              statusName,
              taskCount: 0,
              taskNames: [],
            });
          }
          const info = statusInfoMap.get(statusName)!;
          info.taskCount++;
          if (info.taskNames.length < 3) {
            info.taskNames.push(result.data.task_name || 'Unnamed task');
          }
        }
      });
      setUnmatchedStatusInfo(Array.from(statusInfoMap.values()));

      // Initialize status resolutions with default action
      setStatusResolutions(
        validationResponse.unmatchedStatuses.map(statusName => ({
          originalStatusName: statusName,
          action: 'use_default' as StatusResolutionAction,
        }))
      );

      // Compute unmatched agent info (which tasks have each unmatched agent)
      const agentInfoMap = new Map<string, IUnmatchedAgentInfo>();
      validationResponse.validationResults.forEach(result => {
        if (result.data.assigned_to?.trim()) {
          const agentNames = result.data.assigned_to.split(',').map(name => name.trim()).filter(name => name);
          agentNames.forEach((agentName, index) => {
            if (validationResponse.unmatchedAgents.includes(agentName)) {
              if (!agentInfoMap.has(agentName)) {
                agentInfoMap.set(agentName, {
                  agentName,
                  taskCount: 0,
                  taskNames: [],
                  isPrimaryAgent: false,
                });
              }
              const info = agentInfoMap.get(agentName)!;
              info.taskCount++;
              if (info.taskNames.length < 3) {
                info.taskNames.push(result.data.task_name || 'Unnamed task');
              }
              // Mark as primary if this agent is first in the list
              if (index === 0) {
                info.isPrimaryAgent = true;
              }
            }
          });
        }
      });
      setUnmatchedAgentInfo(Array.from(agentInfoMap.values()));

      // Initialize agent resolutions with default action (skip)
      setAgentResolutions(
        validationResponse.unmatchedAgents.map(agentName => ({
          originalAgentName: agentName,
          action: 'skip' as AgentResolutionAction,
        }))
      );

      // Group valid rows into phases
      const validRows = validationResponse.validationResults
        .filter(r => r.isValid)
        .map(r => r.data);

      const grouped = await groupRowsIntoPhases(
        validRows,
        validationResponse.userLookup,
        validationResponse.priorityLookup,
        validationResponse.serviceLookup,
        validationResponse.statusLookup
      );
      setGroupedPhases(grouped);

      // Expand all phases by default
      setExpandedPhases(new Set(grouped.map(p => p.phase_name)));

      setStep('preview');
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'Error processing CSV data']);
    } finally {
      setIsProcessing(false);
    }
  }, [fullCSVData, columnMappings, validateMappings, projectId]);

  const handleImport = useCallback(async () => {
    if (isProcessing || groupedPhases.length === 0) return;

    setIsProcessing(true);
    setStep('importing');
    setErrors([]);

    try {
      const result = await importPhasesAndTasks(projectId, groupedPhases, statusResolutions);
      setImportResult(result);
      onImportComplete(result);
      setStep('complete');
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'Error importing data']);
      setStep('preview');
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, groupedPhases, projectId, onImportComplete, statusResolutions]);

  // Handle status resolution changes
  const handleStatusResolutionChange = useCallback((
    statusName: string,
    action: StatusResolutionAction,
    mappedStatusId?: string
  ) => {
    setStatusResolutions(prev =>
      prev.map(resolution =>
        resolution.originalStatusName === statusName
          ? { ...resolution, action, mappedStatusId }
          : resolution
      )
    );
  }, []);

  // Handle agent resolution changes
  const handleAgentResolutionChange = useCallback((
    agentName: string,
    action: AgentResolutionAction,
    mappedUserId?: string
  ) => {
    setAgentResolutions(prev =>
      prev.map(resolution =>
        resolution.originalAgentName === agentName
          ? { ...resolution, action, mappedUserId }
          : resolution
      )
    );
  }, []);

  // Proceed from preview to next step (agent resolution -> status resolution -> import)
  const handleProceedFromPreview = useCallback(() => {
    if (unmatchedAgents.length > 0) {
      setStep('agent_resolution');
    } else if (unmatchedStatuses.length > 0) {
      setStep('status_resolution');
    } else {
      handleImport();
    }
  }, [unmatchedAgents, unmatchedStatuses, handleImport]);

  // Proceed from agent resolution to next step (status resolution if needed, or import)
  const handleProceedFromAgentResolution = useCallback(async () => {
    // Re-group phases with agent resolutions applied
    const validRows = validationResults
      .filter(r => r.isValid)
      .map(r => r.data);

    const grouped = await groupRowsIntoPhases(
      validRows,
      userLookup,
      priorityLookup,
      serviceLookup,
      statusLookup,
      agentResolutions
    );
    setGroupedPhases(grouped);

    if (unmatchedStatuses.length > 0) {
      setStep('status_resolution');
    } else {
      handleImport();
    }
  }, [validationResults, userLookup, priorityLookup, serviceLookup, statusLookup, agentResolutions, unmatchedStatuses, handleImport]);

  const handleClose = useCallback(() => {
    if (!isProcessing) {
      setStep('upload');
      setFile(null);
      setPreviewData(null);
      setFullCSVData(null);
      setColumnMappings([]);
      setValidationResults([]);
      setGroupedPhases([]);
      setImportResult(null);
      setErrors([]);
      setStatusLookup({});
      setUnmatchedStatuses([]);
      setUnmatchedStatusInfo([]);
      setStatusResolutions([]);
      setProjectStatusMappings([]);
      setUnmatchedAgents([]);
      setUnmatchedAgentInfo([]);
      setAgentResolutions([]);
      setAvailableUsers([]);
      onClose();
    }
  }, [isProcessing, onClose]);

  const togglePhaseExpanded = (phaseName: string) => {
    setExpandedPhases(prev => {
      const newSet = new Set(prev);
      if (newSet.has(phaseName)) {
        newSet.delete(phaseName);
      } else {
        newSet.add(phaseName);
      }
      return newSet;
    });
  };

  // Calculate summary stats using useMemo to avoid recalculation on every render
  const { validCount, invalidCount, totalTasks } = useMemo(() => ({
    validCount: validationResults.filter(r => r.isValid).length,
    invalidCount: validationResults.filter(r => !r.isValid).length,
    totalTasks: groupedPhases.reduce((sum, phase) => sum + phase.tasks.length, 0),
  }), [validationResults, groupedPhases]);

  // Check if all map_to_existing resolutions have a valid selection
  const hasIncompleteStatusMappings = useMemo(() => {
    return statusResolutions.some(
      r => r.action === 'map_to_existing' && !r.mappedStatusId
    );
  }, [statusResolutions]);

  const hasIncompleteAgentMappings = useMemo(() => {
    return agentResolutions.some(
      r => r.action === 'map_to_existing' && !r.mappedUserId
    );
  }, [agentResolutions]);

  // Check if this is a large import requiring confirmation
  const requiresConfirmation = totalTasks >= LARGE_IMPORT_THRESHOLD;
  const canProceedWithImport = !requiresConfirmation || importConfirmed;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title="Import Phases & Tasks"
      className="max-w-5xl"
    >
      <DialogContent>
        {errors.length > 0 && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>
              <ul className="list-none">
                {errors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {/* Step 1: Upload */}
        {step === 'upload' && (
          <div className="text-center p-8 border-2 border-dashed border-gray-300 rounded-lg">
            <Upload className="mx-auto h-12 w-12 text-gray-400" />
            <p className="mt-2 text-sm text-gray-600">Upload a CSV file with phase and task data</p>
            <p className="mt-1 text-xs text-gray-500">
              <strong>Required:</strong> task_name<br />
              <strong>Optional:</strong> phase_name, task_description, assigned_to, estimated_hours, actual_hours, due_date, priority, service, task_type, status, tags<br />
              <strong>Note:</strong> Tasks without a phase_name will be grouped into "{DEFAULT_PHASE_NAME}"
            </p>
            <div className="mt-4 space-y-3">
              <Input
                id="phase-task-csv-upload"
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                disabled={isProcessing}
              />
              <Button
                id="download-template-btn"
                variant="outline"
                onClick={async () => {
                  const template = await generatePhaseTaskCSVTemplate();
                  const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' });
                  const link = document.createElement('a');
                  const url = URL.createObjectURL(blob);
                  link.setAttribute('href', url);
                  link.setAttribute('download', 'phase_task_import_template.csv');
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

        {/* Step 2: Mapping */}
        {step === 'mapping' && previewData && (
          <div>
            <h3 className="text-lg font-medium mb-4">Map Task Fields to CSV Columns</h3>
            <p className="text-sm text-gray-600 mb-4">
              Select which CSV column contains the data for each field. Fields marked with * are required.
            </p>
            <div className="max-h-[60vh] overflow-y-auto pr-2">
              <div className="mb-2 flex items-center gap-4 text-sm font-semibold text-gray-700">
                <span className="w-1/3">Field</span>
                <span className="w-2/3">Select CSV Column</span>
              </div>
              <div className="border-t pt-4 space-y-3">
                {Object.entries(TASK_IMPORT_FIELDS).map(([fieldKey, { label }]) => {
                  const currentMapping = columnMappings.find(m => m.taskField === fieldKey);
                  const csvHeader = currentMapping?.csvHeader || 'unassigned';

                  // Get already mapped CSV headers (excluding current field's mapping)
                  const mappedHeaders = columnMappings
                    .filter(m => m.taskField && m.taskField !== fieldKey)
                    .map(m => m.csvHeader);

                  return (
                    <div key={fieldKey} className="flex items-center gap-4">
                      <span className="w-1/3 text-sm font-medium">{label}</span>
                      <span className="text-gray-400">←</span>
                      <CustomSelect
                        options={[
                          { value: 'unassigned', label: 'Not mapped' },
                          ...previewData.headers
                            .filter(header => !mappedHeaders.includes(header))
                            .map(header => ({
                              value: header,
                              label: header,
                            })),
                        ]}
                        value={csvHeader}
                        onValueChange={(value) => {
                          // Handle all mapping updates in a single state update
                          setColumnMappings(prev =>
                            prev.map((m): ICSVTaskColumnMapping => {
                              // Clear the existing mapping for this field (if any)
                              if (currentMapping && m.csvHeader === currentMapping.csvHeader) {
                                return { ...m, taskField: null };
                              }
                              // Set the new column to this field (if not unassigned)
                              if (value !== 'unassigned' && m.csvHeader === value) {
                                return { ...m, taskField: fieldKey as MappableTaskField };
                              }
                              return m;
                            })
                          );
                        }}
                        className="w-2/3"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            {rowsTruncated && (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>
                  <strong>Row limit exceeded:</strong> Your CSV has {rowsTruncated.original.toLocaleString()} rows,
                  but only the first {rowsTruncated.kept.toLocaleString()} rows will be imported.
                  Please split your file into smaller batches for the remaining rows.
                </AlertDescription>
              </Alert>
            )}
            {fullCSVData && fullCSVData.length > 100 && !rowsTruncated && (
              <Alert variant="info" className="mt-4">
                <AlertDescription>
                  You are importing {fullCSVData.length} tasks. Processing may take a moment.
                </AlertDescription>
              </Alert>
            )}
            <div className="mt-4">
              <DialogFooter>
                <Button
                  id="mapping-back-btn"
                  variant="outline"
                  onClick={() => setStep('upload')}
                  disabled={isProcessing}
                >
                  Back
                </Button>
                <Button id="mapping-preview-btn" onClick={handlePreview} disabled={isProcessing}>
                  {isProcessing ? 'Processing...' : 'Preview'}
                </Button>
              </DialogFooter>
            </div>
          </div>
        )}

        {/* Step 3: Preview */}
        {step === 'preview' && validationResults.length > 0 && (
          <div>
            <h3 className="text-lg font-medium mb-4">Preview Import</h3>
            <Alert variant="info" className="mb-4">
              <AlertDescription>
                <strong>Total rows:</strong> {validationResults.length} |
                <strong className="ml-2">Valid:</strong> {validCount} |
                <strong className="ml-2">Invalid:</strong> {invalidCount} |
                <strong className="ml-2">Phases:</strong> {groupedPhases.length} |
                <strong className="ml-2">Tasks:</strong> {totalTasks}
              </AlertDescription>
            </Alert>

            {/* Import Options */}
            <div className="mb-4">
              <div className="flex items-center justify-between py-3 border-b">
                <div>
                  <div className="text-gray-900 font-medium">Skip invalid rows</div>
                  <div className="text-sm text-gray-500">Continue import even if some rows have validation errors</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-700">
                    {importOptions.skipInvalidRows ? 'Yes' : 'No'}
                  </span>
                  <Switch
                    checked={importOptions.skipInvalidRows}
                    onCheckedChange={(checked) =>
                      setImportOptions(prev => ({ ...prev, skipInvalidRows: checked }))
                    }
                    className="data-[state=checked]:bg-primary-500"
                  />
                </div>
              </div>
            </div>

            {/* Grouped Preview */}
            <div className="mb-4">
              <h4 className="text-sm font-medium text-gray-700 mb-2">Import Structure</h4>
              <div className="border rounded-lg max-h-64 overflow-y-auto">
                {groupedPhases.map((phase) => (
                  <div key={phase.phase_name} className="border-b last:border-b-0">
                    <button
                      type="button"
                      onClick={() => togglePhaseExpanded(phase.phase_name)}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-left"
                    >
                      {expandedPhases.has(phase.phase_name) ? (
                        <ChevronDown className="h-4 w-4 text-gray-500" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-gray-500" />
                      )}
                      <span className="font-medium">{phase.phase_name}</span>
                      <span className="text-sm text-gray-500">({phase.tasks.length} tasks)</span>
                    </button>
                    {expandedPhases.has(phase.phase_name) && (
                      <div className="pl-9 pb-2">
                        {phase.tasks.map((task, index) => (
                          <div key={`${phase.phase_name}-${index}`} className="flex items-center gap-2 py-1 text-sm">
                            <span className="text-gray-400">•</span>
                            <span>{task.task_name}</span>
                            {task.estimated_hours && (
                              <span className="text-gray-500">({task.estimated_hours}h)</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Validation Results Table */}
            <div className="max-h-64 overflow-x-auto overflow-y-auto">
              <DataTable
                key={`${currentPage}-${pageSize}`}
                id="phase-task-import-preview-table"
                pagination={true}
                currentPage={currentPage}
                onPageChange={setCurrentPage}
                pageSize={pageSize}
                onItemsPerPageChange={handlePageSizeChange}
                data={validationResults.map((result) => ({
                  status: result.isValid,
                  rowNumber: result.rowNumber,
                  phase_name: result.data.phase_name || DEFAULT_PHASE_NAME,
                  task_name: result.data.task_name,
                  assigned_to: result.data.assigned_to,
                  estimated_hours: result.data.estimated_hours,
                  errors: result.errors,
                  warnings: result.warnings,
                }))}
                columns={[
                  {
                    title: 'Status',
                    dataIndex: 'status',
                    render: (value: boolean) =>
                      value ? (
                        <div className="flex justify-center">
                          <Tooltip content="Valid - Ready to import">
                            <Check className="h-5 w-5 text-green-600 cursor-help" />
                          </Tooltip>
                        </div>
                      ) : (
                        <div className="flex justify-center">
                          <Tooltip content="Invalid - Has errors">
                            <AlertTriangle className="h-5 w-5 text-destructive cursor-help" />
                          </Tooltip>
                        </div>
                      ),
                  },
                  {
                    title: 'Row',
                    dataIndex: 'rowNumber',
                  },
                  {
                    title: 'Phase',
                    dataIndex: 'phase_name',
                  },
                  {
                    title: 'Task',
                    dataIndex: 'task_name',
                  },
                  {
                    title: 'Issues',
                    dataIndex: 'issues',
                    width: '30%',
                    render: (value: unknown, record: Record<string, unknown>) => {
                      const recordErrors = (record.errors || []) as string[];
                      const recordWarnings = (record.warnings || []) as string[];

                      if (recordErrors.length === 0 && recordWarnings.length === 0) {
                        return <span className="text-gray-400">-</span>;
                      }

                      return (
                        <div className="whitespace-normal break-words text-sm space-y-1 min-w-0">
                          {recordErrors.length > 0 && (
                            <div className="text-destructive">
                              {recordErrors.map((error: string, i: number) => (
                                <div key={`error-${i}`} className="break-words">
                                  • {error}
                                </div>
                              ))}
                            </div>
                          )}
                          {recordWarnings.length > 0 && (
                            <div className="text-gray-500 dark:text-gray-400">
                              {recordWarnings.map((warning: string, i: number) => (
                                <div key={`warning-${i}`} className="break-words">
                                  • {warning}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    },
                  },
                ] as ColumnDefinition<Record<string, unknown>>[]}
              />
            </div>
            {/* Show warning if there are unmatched agents */}
            {unmatchedAgents.length > 0 && (
              <Alert variant="info" className="mt-4">
                <AlertDescription>
                  <strong>{unmatchedAgents.length} agent(s)</strong> from your CSV don't match existing users.
                  You'll be asked to map these in the next step.
                </AlertDescription>
              </Alert>
            )}

            {/* Show warning if there are unmatched statuses */}
            {unmatchedStatuses.length > 0 && (
              <Alert variant="info" className="mt-4">
                <AlertDescription>
                  <strong>{unmatchedStatuses.length} status(es)</strong> from your CSV don't match existing project statuses.
                  You'll be asked to resolve these {unmatchedAgents.length > 0 ? 'after mapping agents' : 'in the next step'}.
                </AlertDescription>
              </Alert>
            )}

            {/* Show error if there are invalid rows and skip is disabled */}
            {invalidCount > 0 && !importOptions.skipInvalidRows && (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>
                  <strong>{invalidCount} row(s)</strong> have validation errors.
                  Enable "Skip invalid rows" to proceed with only the valid rows, or go back and fix your CSV.
                </AlertDescription>
              </Alert>
            )}

            {/* Show confirmation for large imports when going directly to import (no agent or status resolution) */}
            {unmatchedAgents.length === 0 && unmatchedStatuses.length === 0 && requiresConfirmation && (
              <div className="mt-4 p-4 border rounded-lg bg-amber-50 border-amber-200">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={importConfirmed}
                    onChange={(e) => setImportConfirmed(e.target.checked)}
                    className="mt-1 text-primary-500"
                  />
                  <div>
                    <span className="font-medium text-amber-800">
                      Confirm large import ({totalTasks} tasks)
                    </span>
                    <p className="text-sm text-amber-700 mt-1">
                      I understand this will create {groupedPhases.length} phase(s) and {totalTasks} task(s).
                      This action may take a while to complete.
                    </p>
                  </div>
                </label>
              </div>
            )}

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
                  onClick={handleProceedFromPreview}
                  disabled={
                    groupedPhases.length === 0 ||
                    isProcessing ||
                    (invalidCount > 0 && !importOptions.skipInvalidRows) ||
                    (unmatchedAgents.length === 0 && unmatchedStatuses.length === 0 && !canProceedWithImport)
                  }
                >
                  {isProcessing
                    ? 'Processing...'
                    : unmatchedAgents.length > 0
                      ? 'Next: Map Agents'
                      : unmatchedStatuses.length > 0
                        ? 'Next: Resolve Statuses'
                        : `Import ${totalTasks} Tasks`}
                </Button>
              </DialogFooter>
            </div>
          </div>
        )}

        {/* Step 4: Agent Resolution */}
        {step === 'agent_resolution' && unmatchedAgentInfo.length > 0 && (
          <div>
            <h3 className="text-lg font-medium mb-4">Map Unmatched Agents</h3>
            <Alert variant="info" className="mb-4">
              <AlertDescription>
                The following agent names from your CSV don't match any existing users.
                Choose how to handle each one. The first agent in a comma-separated list becomes the primary assignee,
                and additional agents become task resources.
              </AlertDescription>
            </Alert>

            <div className="space-y-4 max-h-96 overflow-y-auto">
              {unmatchedAgentInfo.map((agentInfo) => {
                const resolution = agentResolutions.find(
                  r => r.originalAgentName === agentInfo.agentName
                );

                return (
                  <div
                    key={agentInfo.agentName}
                    className="border rounded-lg p-4 bg-gray-50"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <span className="font-medium text-gray-900">"{agentInfo.agentName}"</span>
                        <span className="ml-2 text-sm text-gray-500">
                          ({agentInfo.taskCount} task{agentInfo.taskCount !== 1 ? 's' : ''})
                        </span>
                        {agentInfo.isPrimaryAgent && (
                          <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                            Primary agent
                          </span>
                        )}
                        <div className="text-sm text-gray-500 mt-1">
                          Tasks: {agentInfo.taskNames.join(', ')}
                          {agentInfo.taskCount > 3 && ` and ${agentInfo.taskCount - 3} more...`}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name={`agent-${agentInfo.agentName}`}
                            checked={resolution?.action === 'skip'}
                            onChange={() => handleAgentResolutionChange(agentInfo.agentName, 'skip')}
                            className="text-primary-500"
                          />
                          <span className="text-sm">
                            Skip this agent
                          </span>
                        </label>
                        {resolution?.action === 'skip' && (
                          <p className="ml-6 text-xs text-gray-500 mt-1">
                            {agentInfo.isPrimaryAgent
                              ? 'Tasks where this is the primary agent will be imported without an assignee.'
                              : 'This additional agent will not be added to the affected tasks.'}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name={`agent-${agentInfo.agentName}`}
                            checked={resolution?.action === 'map_to_existing'}
                            onChange={() => {
                              const firstUser = availableUsers[0]?.user_id;
                              handleAgentResolutionChange(agentInfo.agentName, 'map_to_existing', firstUser);
                            }}
                            className="text-primary-500"
                          />
                          <span className="text-sm">Map to existing user:</span>
                        </label>
                        <UserPicker
                          id={`agent-mapping-${agentInfo.agentName}`}
                          users={availableUsers as IUser[]}
                          value={resolution?.mappedUserId || ''}
                          onValueChange={(value) =>
                            handleAgentResolutionChange(agentInfo.agentName, 'map_to_existing', value)
                          }
                          disabled={resolution?.action !== 'map_to_existing'}
                          placeholder="Select user..."
                          labelStyle="none"
                          buttonWidth="fit"
                          size="sm"
                          className="min-w-[200px]"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {hasIncompleteAgentMappings && (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>
                  Please select a target user for all "Map to existing user" resolutions before proceeding.
                </AlertDescription>
              </Alert>
            )}

            {/* Show confirmation for large imports when going directly to import (no status resolution) */}
            {unmatchedStatuses.length === 0 && requiresConfirmation && (
              <div className="mt-4 p-4 border rounded-lg bg-amber-50 border-amber-200">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={importConfirmed}
                    onChange={(e) => setImportConfirmed(e.target.checked)}
                    className="mt-1 text-primary-500"
                  />
                  <div>
                    <span className="font-medium text-amber-800">
                      Confirm large import ({totalTasks} tasks)
                    </span>
                    <p className="text-sm text-amber-700 mt-1">
                      I understand this will create {groupedPhases.length} phase(s) and {totalTasks} task(s).
                      This action may take a while to complete.
                    </p>
                  </div>
                </label>
              </div>
            )}

            <div className="mt-4">
              <DialogFooter>
                <Button
                  id="agent-resolution-back-btn"
                  variant="outline"
                  onClick={() => setStep('preview')}
                  disabled={isProcessing}
                >
                  Back
                </Button>
                <Button
                  id="agent-resolution-next-btn"
                  onClick={handleProceedFromAgentResolution}
                  disabled={isProcessing || hasIncompleteAgentMappings || (unmatchedStatuses.length === 0 && !canProceedWithImport)}
                >
                  {isProcessing
                    ? 'Processing...'
                    : unmatchedStatuses.length > 0
                      ? 'Next: Resolve Statuses'
                      : `Import ${totalTasks} Tasks`}
                </Button>
              </DialogFooter>
            </div>
          </div>
        )}

        {/* Step 5: Status Resolution */}
        {step === 'status_resolution' && unmatchedStatusInfo.length > 0 && (
          <div>
            <h3 className="text-lg font-medium mb-4">Resolve Unmatched Statuses</h3>
            <Alert variant="info" className="mb-4">
              <AlertDescription>
                The following statuses from your CSV don't match any existing project statuses.
                Choose how to handle each one:
              </AlertDescription>
            </Alert>

            <div className="space-y-4 max-h-96 overflow-y-auto">
              {unmatchedStatusInfo.map((statusInfo) => {
                const resolution = statusResolutions.find(
                  r => r.originalStatusName === statusInfo.statusName
                );

                return (
                  <div
                    key={statusInfo.statusName}
                    className="border rounded-lg p-4 bg-gray-50"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <span className="font-medium text-gray-900">"{statusInfo.statusName}"</span>
                        <span className="ml-2 text-sm text-gray-500">
                          ({statusInfo.taskCount} task{statusInfo.taskCount !== 1 ? 's' : ''})
                        </span>
                        <div className="text-sm text-gray-500 mt-1">
                          Tasks: {statusInfo.taskNames.join(', ')}
                          {statusInfo.taskCount > 3 && ` and ${statusInfo.taskCount - 3} more...`}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name={`status-${statusInfo.statusName}`}
                          checked={resolution?.action === 'create'}
                          onChange={() => handleStatusResolutionChange(statusInfo.statusName, 'create')}
                          className="text-primary-500"
                        />
                        <span className="text-sm">
                          Create new status column "{statusInfo.statusName}"
                        </span>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name={`status-${statusInfo.statusName}`}
                          checked={resolution?.action === 'use_default'}
                          onChange={() => handleStatusResolutionChange(statusInfo.statusName, 'use_default')}
                          className="text-primary-500"
                        />
                        <span className="text-sm">
                          Use "No Status Specified" column (will be created if needed)
                        </span>
                      </label>

                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name={`status-${statusInfo.statusName}`}
                            checked={resolution?.action === 'map_to_existing'}
                            onChange={() => {
                              const firstStatus = projectStatusMappings[0]?.project_status_mapping_id;
                              handleStatusResolutionChange(statusInfo.statusName, 'map_to_existing', firstStatus);
                            }}
                            className="text-primary-500"
                          />
                          <span className="text-sm">Map to existing:</span>
                        </label>
                        <CustomSelect
                          options={projectStatusMappings.map(mapping => ({
                            value: mapping.project_status_mapping_id,
                            label: mapping.custom_name || mapping.status_name || mapping.name || 'Unnamed',
                          }))}
                          value={resolution?.mappedStatusId || ''}
                          onValueChange={(value) =>
                            handleStatusResolutionChange(statusInfo.statusName, 'map_to_existing', value)
                          }
                          disabled={resolution?.action !== 'map_to_existing'}
                          className="w-48"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {hasIncompleteStatusMappings && (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>
                  Please select a target status for all "Map to existing" resolutions before importing.
                </AlertDescription>
              </Alert>
            )}

            {requiresConfirmation && (
              <div className="mt-4 p-4 border rounded-lg bg-amber-50 border-amber-200">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={importConfirmed}
                    onChange={(e) => setImportConfirmed(e.target.checked)}
                    className="mt-1 text-primary-500"
                  />
                  <div>
                    <span className="font-medium text-amber-800">
                      Confirm large import ({totalTasks} tasks)
                    </span>
                    <p className="text-sm text-amber-700 mt-1">
                      I understand this will create {groupedPhases.length} phase(s) and {totalTasks} task(s).
                      This action may take a while to complete.
                    </p>
                  </div>
                </label>
              </div>
            )}

            <div className="mt-4">
              <DialogFooter>
                <Button
                  id="status-resolution-back-btn"
                  variant="outline"
                  onClick={() => setStep(unmatchedAgents.length > 0 ? 'agent_resolution' : 'preview')}
                  disabled={isProcessing}
                >
                  Back
                </Button>
                <Button
                  id="status-resolution-import-btn"
                  onClick={handleImport}
                  disabled={isProcessing || hasIncompleteStatusMappings || !canProceedWithImport}
                >
                  {isProcessing ? 'Importing...' : `Import ${totalTasks} Tasks`}
                </Button>
              </DialogFooter>
            </div>
          </div>
        )}

        {/* Step 6: Importing (spinner) */}
        {step === 'importing' && (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto mb-4"></div>
            <p className="text-gray-600">Importing phases and tasks...</p>
          </div>
        )}

        {/* Step 7: Complete */}
        {step === 'complete' && importResult && (
          <div className="text-center">
            {importResult.success ? (
              <>
                <Check className="h-12 w-12 text-green-600 mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-2">Import Complete</h3>
                <p className="text-gray-600 mb-4">
                  Successfully created {importResult.phasesCreated} phases and {importResult.tasksCreated} tasks
                </p>
              </>
            ) : (
              <>
                <AlertTriangle className="h-12 w-12 text-primary-500 mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-2">Import Completed with Issues</h3>
                <p className="text-gray-600 mb-2">
                  Created {importResult.phasesCreated} phases and {importResult.tasksCreated} tasks
                </p>
                {importResult.errors.length > 0 && (
                  <Alert variant="destructive" className="text-left mt-4">
                    <AlertDescription>
                      <p className="font-medium mb-2">Errors:</p>
                      <ul className="list-disc list-inside">
                        {importResult.errors.map((error, index) => (
                          <li key={index}>{error}</li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}
              </>
            )}
            <DialogFooter>
              <Button id="complete-close-btn" onClick={handleClose}>
                Close
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default PhaseTaskImportDialog;
