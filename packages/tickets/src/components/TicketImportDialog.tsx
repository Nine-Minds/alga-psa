'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Switch } from '@alga-psa/ui/components/Switch';
import { RadioGroup } from '@alga-psa/ui/components/RadioGroup';
import type { ColumnDefinition } from '@alga-psa/types';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import type { IUser, IBoard, IClient } from '@alga-psa/types';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { Upload, AlertTriangle, Check, Download } from 'lucide-react';
import { parseCSV } from '@alga-psa/core';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import {
  generateTicketCSVTemplate,
  getTicketImportReferenceData,
  importTickets,
} from '../actions/ticketImportActions';
import {
  validateTicketImportData,
  processTicketRows,
} from '../lib/ticketImportUtils';
import {
  MappableTicketField,
  TICKET_IMPORT_FIELDS,
  TICKET_FIELD_ALIASES,
  ICSVTicketColumnMapping,
  ICSVTicketPreviewData,
  ITicketImportRow,
  ITicketImportValidationResult,
  ITicketImportReferenceData,
  ITicketImportResult,
  IUnmatchedEntityInfo,
  IClientResolution,
  ClientResolutionAction,
  ITicketAgentResolution,
  TicketAgentResolutionAction,
  ITicketStatusResolution,
  TicketStatusResolutionAction,
  IPriorityResolution,
  PriorityResolutionAction,
  ICategoryResolution,
  CategoryResolutionAction,
  IContactResolution,
  ContactResolutionAction,
  ITeamResolution,
  TeamResolutionAction,
  IDateFormatGroup,
  IDateFormatResolution,
  DateFormatInterpretation,
  MAX_TICKET_IMPORT_ROWS,
  LARGE_TICKET_IMPORT_THRESHOLD,
} from '@alga-psa/types';

interface TicketImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialBoards: IBoard[];
  initialClients: IClient[];
  initialUsers?: IUser[];
  onImportComplete: () => void;
}

type ImportStep =
  | 'upload'
  | 'board_selection'
  | 'mapping'
  | 'preview'
  | 'resolve_data'
  | 'importing'
  | 'complete';

const TicketImportDialog: React.FC<TicketImportDialogProps> = ({
  isOpen,
  onClose,
  initialBoards,
  initialClients,
  initialUsers,
  onImportComplete,
}) => {
  // Core state
  const [step, setStep] = useState<ImportStep>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<ICSVTicketPreviewData | null>(null);
  const [fullCSVData, setFullCSVData] = useState<string[][] | null>(null);
  const [columnMappings, setColumnMappings] = useState<ICSVTicketColumnMapping[]>([]);
  const [validationResults, setValidationResults] = useState<ITicketImportValidationResult[]>([]);
  const [importResult, setImportResult] = useState<ITicketImportResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // Board selection
  const [defaultBoardId, setDefaultBoardId] = useState<string>(() => {
    const defaultBoard = initialBoards.find(b => b.is_default);
    if (defaultBoard?.board_id) return defaultBoard.board_id;
    if (initialBoards.length > 0 && initialBoards[0].board_id) return initialBoards[0].board_id;
    return '';
  });
  // Reference data
  const [referenceData, setReferenceData] = useState<ITicketImportReferenceData | null>(null);

  // Mapped rows (built from CSV + column mappings)
  const [mappedRows, setMappedRows] = useState<ITicketImportRow[]>([]);

  // Resolution state — all entity types
  const [unmatchedClients, setUnmatchedClients] = useState<string[]>([]);
  const [unmatchedClientInfo, setUnmatchedClientInfo] = useState<IUnmatchedEntityInfo[]>([]);
  const [clientResolutions, setClientResolutions] = useState<IClientResolution[]>([]);

  const [unmatchedAgents, setUnmatchedAgents] = useState<string[]>([]);
  const [unmatchedAgentInfo, setUnmatchedAgentInfo] = useState<IUnmatchedEntityInfo[]>([]);
  const [agentResolutions, setAgentResolutions] = useState<ITicketAgentResolution[]>([]);

  const [unmatchedStatuses, setUnmatchedStatuses] = useState<string[]>([]);
  const [unmatchedStatusInfo, setUnmatchedStatusInfo] = useState<IUnmatchedEntityInfo[]>([]);
  const [statusResolutions, setStatusResolutions] = useState<ITicketStatusResolution[]>([]);

  const [unmatchedPriorities, setUnmatchedPriorities] = useState<string[]>([]);
  const [unmatchedPriorityInfo, setUnmatchedPriorityInfo] = useState<IUnmatchedEntityInfo[]>([]);
  const [priorityResolutions, setPriorityResolutions] = useState<IPriorityResolution[]>([]);

  const [unmatchedCategories, setUnmatchedCategories] = useState<string[]>([]);
  const [unmatchedCategoryInfo, setUnmatchedCategoryInfo] = useState<IUnmatchedEntityInfo[]>([]);
  const [categoryResolutions, setCategoryResolutions] = useState<ICategoryResolution[]>([]);

  const [unmatchedContacts, setUnmatchedContacts] = useState<string[]>([]);
  const [unmatchedContactInfo, setUnmatchedContactInfo] = useState<IUnmatchedEntityInfo[]>([]);
  const [contactResolutions, setContactResolutions] = useState<IContactResolution[]>([]);

  const [unmatchedTeams, setUnmatchedTeams] = useState<string[]>([]);
  const [unmatchedTeamInfo, setUnmatchedTeamInfo] = useState<IUnmatchedEntityInfo[]>([]);
  const [teamResolutions, setTeamResolutions] = useState<ITeamResolution[]>([]);

  const [unparsableDateGroups, setUnparsableDateGroups] = useState<IDateFormatGroup[]>([]);
  const [dateFormatResolutions, setDateFormatResolutions] = useState<IDateFormatResolution[]>([]);

  // Expanded sections in resolve_data step
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  // Import options
  const [importOptions, setImportOptions] = useState({ skipInvalidRows: false });
  const [importConfirmed, setImportConfirmed] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Row truncation
  const [rowsTruncated, setRowsTruncated] = useState<{ original: number; kept: number } | null>(null);

  // -------------------------------------------------------------------------
  // Step 1: Upload
  // -------------------------------------------------------------------------

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

      if (dataRows.length > MAX_TICKET_IMPORT_ROWS) {
        setRowsTruncated({ original: dataRows.length, kept: MAX_TICKET_IMPORT_ROWS });
        dataRows = dataRows.slice(0, MAX_TICKET_IMPORT_ROWS);
      } else {
        setRowsTruncated(null);
      }

      setFullCSVData(dataRows);
      setPreviewData({
        headers,
        rows: dataRows.slice(0, 5),
      });

      // Auto-map columns using alias table
      const usedFields = new Set<MappableTicketField>();
      const autoMappings: ICSVTicketColumnMapping[] = headers.map((header): ICSVTicketColumnMapping => {
        const normalized = header.toLowerCase().replace(/[_\s\-.*]/g, '');
        let ticketField: MappableTicketField | null = null;

        // Look up in alias table (skip 'board' — all tickets go to the selected board)
        const aliasMatch = TICKET_FIELD_ALIASES[normalized];
        if (aliasMatch && aliasMatch !== 'board' && aliasMatch !== 'subcategory' && !usedFields.has(aliasMatch)) {
          ticketField = aliasMatch;
          usedFields.add(aliasMatch);
        }

        // Fallback: try matching against field keys directly
        if (!ticketField) {
          for (const [fieldKey] of Object.entries(TICKET_IMPORT_FIELDS)) {
            if (fieldKey === 'board' || fieldKey === 'subcategory') continue;
            const fieldNorm = fieldKey.toLowerCase().replace(/[_\s\-]/g, '');
            if (!usedFields.has(fieldKey as MappableTicketField) && normalized === fieldNorm) {
              ticketField = fieldKey as MappableTicketField;
              usedFields.add(ticketField);
              break;
            }
          }
        }

        return {
          csvHeader: header,
          ticketField,
        };
      });

      setColumnMappings(autoMappings);

      setStep('board_selection');
    } catch (error) {
      setFile(null);
      setErrors([error instanceof Error ? error.message : 'Error reading CSV file']);
    } finally {
      setIsProcessing(false);
    }
  }, []);

  // -------------------------------------------------------------------------
  // Step 2: Board Selection
  // -------------------------------------------------------------------------

  const handleBoardNext = useCallback(() => {
    if (!defaultBoardId) {
      setErrors(['Please select a default board']);
      return;
    }
    setErrors([]);
    setStep('mapping');
  }, [defaultBoardId]);

  // -------------------------------------------------------------------------
  // Step 3: Column Mapping
  // -------------------------------------------------------------------------

  const validateMappings = useCallback(() => {
    const errors: string[] = [];
    const requiredFields: MappableTicketField[] = ['title', 'client'];
    for (const requiredField of requiredFields) {
      if (!columnMappings.some(mapping => mapping.ticketField === requiredField)) {
        errors.push(`Required field "${TICKET_IMPORT_FIELDS[requiredField].label}" is not mapped`);
      }
    }
    return errors;
  }, [columnMappings]);

  // -------------------------------------------------------------------------
  // Step 4: Preview & Validation
  // -------------------------------------------------------------------------

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
      // Map CSV data to ITicketImportRow objects
      const rows: ITicketImportRow[] = fullCSVData.map((row) => {
        const mapped: ITicketImportRow = {};
        columnMappings.forEach((mapping, index) => {
          if (mapping.ticketField && mapping.ticketField !== 'board' && mapping.ticketField !== 'subcategory') {
            (mapped as Record<string, string>)[mapping.ticketField] = row[index] || '';
          }
        });
        return mapped;
      });
      setMappedRows(rows);

      // Fetch reference data
      const refData = await getTicketImportReferenceData(defaultBoardId);
      setReferenceData(refData);

      // Validate
      const validation = await validateTicketImportData(rows, refData, defaultBoardId);
      setValidationResults(validation.validationResults);

      setUnmatchedClients(validation.unmatchedClients);
      setUnmatchedAgents(validation.unmatchedAgents);
      setUnmatchedStatuses(validation.unmatchedStatuses);

      // Build unmatched entity info for display
      const buildEntityInfo = (
        unmatchedNames: string[],
        fieldExtractor: (row: ITicketImportRow) => string | undefined,
        results: typeof validation.validationResults
      ): IUnmatchedEntityInfo[] => {
        const infoMap = new Map<string, IUnmatchedEntityInfo>();
        results.forEach(result => {
          const value = fieldExtractor(result.data)?.trim();
          if (value && unmatchedNames.some(n => n.toLowerCase() === value.toLowerCase())) {
            const key = value.toLowerCase();
            if (!infoMap.has(key)) {
              infoMap.set(key, { name: value, ticketCount: 0, ticketTitles: [] });
            }
            const info = infoMap.get(key)!;
            info.ticketCount++;
            if (info.ticketTitles.length < 3) {
              info.ticketTitles.push(result.data.title || 'Untitled');
            }
          }
        });
        return Array.from(infoMap.values());
      };

      setUnmatchedClientInfo(buildEntityInfo(validation.unmatchedClients, r => r.client, validation.validationResults));
      setUnmatchedAgentInfo(buildEntityInfo(validation.unmatchedAgents, r => r.assigned_to, validation.validationResults));
      setUnmatchedStatusInfo(buildEntityInfo(validation.unmatchedStatuses, r => r.status, validation.validationResults));
      setUnmatchedPriorities(validation.unmatchedPriorities);
      setUnmatchedPriorityInfo(buildEntityInfo(validation.unmatchedPriorities, r => r.priority, validation.validationResults));
      setUnmatchedCategories(validation.unmatchedCategories);
      setUnmatchedCategoryInfo(buildEntityInfo(validation.unmatchedCategories, r => r.category, validation.validationResults));
      setUnmatchedContacts(validation.unmatchedContacts);
      setUnmatchedContactInfo(buildEntityInfo(validation.unmatchedContacts, r => r.contact, validation.validationResults));
      setUnmatchedTeams(validation.unmatchedTeams);
      setUnmatchedTeamInfo(buildEntityInfo(validation.unmatchedTeams, r => r.assigned_team, validation.validationResults));

      // Initialize resolutions with sensible defaults
      setClientResolutions(validation.unmatchedClients.map(name => ({
        originalClientName: name, action: 'create' as ClientResolutionAction,
      })));
      setAgentResolutions(validation.unmatchedAgents.map(name => ({
        originalAgentName: name, action: 'skip' as TicketAgentResolutionAction,
      })));
      setStatusResolutions(validation.unmatchedStatuses.map(name => ({
        originalStatusName: name, boardId: defaultBoardId, action: 'create' as TicketStatusResolutionAction,
      })));
      setPriorityResolutions(validation.unmatchedPriorities.map(name => ({
        originalPriorityName: name, action: 'create' as PriorityResolutionAction,
      })));
      setCategoryResolutions([
        ...validation.unmatchedCategories.map(name => ({
          originalCategoryName: name, boardId: defaultBoardId, action: 'create' as CategoryResolutionAction,
        })),
      ]);
      setContactResolutions(validation.unmatchedContacts.map(name => ({
        originalContactName: name, action: 'skip' as ContactResolutionAction,
      })));
      setTeamResolutions(validation.unmatchedTeams.map(name => ({
        originalTeamName: name, action: 'skip' as TeamResolutionAction,
      })));
      setUnparsableDateGroups(validation.unparsableDateGroups);
      setDateFormatResolutions(validation.unparsableDateGroups.map(g => ({
        patternKey: g.patternKey,
        selectedFormat: g.possibleFormats[0] || 'skip',
      })));

      // Auto-expand sections that have unmatched items
      const sections = new Set<string>();
      if (validation.unmatchedClients.length > 0) sections.add('clients');
      if (validation.unmatchedPriorities.length > 0) sections.add('priorities');
      if (validation.unmatchedStatuses.length > 0) sections.add('statuses');
      if (validation.unmatchedCategories.length > 0) sections.add('categories');
      if (validation.unmatchedAgents.length > 0) sections.add('agents');
      if (validation.unmatchedTeams.length > 0) sections.add('teams');
      if (validation.unmatchedContacts.length > 0) sections.add('contacts');
      if (validation.unparsableDateGroups.length > 0) sections.add('dates');
      setExpandedSections(sections);

      setStep('preview');
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'Error processing CSV data']);
    } finally {
      setIsProcessing(false);
    }
  }, [fullCSVData, columnMappings, validateMappings, defaultBoardId]);

  // -------------------------------------------------------------------------
  // Resolution handlers
  // -------------------------------------------------------------------------

  const handleClientResolutionChange = useCallback((clientName: string, action: ClientResolutionAction, mappedClientId?: string) => {
    setClientResolutions(prev => prev.map(r => r.originalClientName === clientName ? { ...r, action, mappedClientId } : r));
  }, []);

  const handleAgentResolutionChange = useCallback((agentName: string, action: TicketAgentResolutionAction, mappedUserId?: string) => {
    setAgentResolutions(prev => prev.map(r => r.originalAgentName === agentName ? { ...r, action, mappedUserId } : r));
  }, []);

  const handleStatusResolutionChange = useCallback((statusName: string, action: TicketStatusResolutionAction, mappedStatusId?: string) => {
    setStatusResolutions(prev => prev.map(r => r.originalStatusName === statusName ? { ...r, action, mappedStatusId } : r));
  }, []);

  const handlePriorityResolutionChange = useCallback((prioName: string, action: PriorityResolutionAction, mappedPriorityId?: string) => {
    setPriorityResolutions(prev => prev.map(r => r.originalPriorityName === prioName ? { ...r, action, mappedPriorityId } : r));
  }, []);

  const handleCategoryResolutionChange = useCallback((catName: string, action: CategoryResolutionAction, mappedCategoryId?: string) => {
    setCategoryResolutions(prev => prev.map(r => r.originalCategoryName === catName ? { ...r, action, mappedCategoryId } : r));
  }, []);

  const handleContactResolutionChange = useCallback((contactName: string, action: ContactResolutionAction, mappedContactId?: string) => {
    setContactResolutions(prev => prev.map(r => r.originalContactName === contactName ? { ...r, action, mappedContactId } : r));
  }, []);

  const handleTeamResolutionChange = useCallback((teamName: string, action: TeamResolutionAction, mappedTeamId?: string) => {
    setTeamResolutions(prev => prev.map(r => r.originalTeamName === teamName ? { ...r, action, mappedTeamId } : r));
  }, []);

  const handleDateFormatChange = useCallback((patternKey: string, selectedFormat: DateFormatInterpretation) => {
    setDateFormatResolutions(prev => prev.map(r => r.patternKey === patternKey ? { ...r, selectedFormat } : r));
  }, []);

  const toggleSection = useCallback((section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section); else next.add(section);
      return next;
    });
  }, []);

  // -------------------------------------------------------------------------
  // Step navigation
  // -------------------------------------------------------------------------

  const hasAnyUnmatched = useMemo(() => {
    return unmatchedClients.length > 0 || unmatchedPriorities.length > 0 ||
      unmatchedStatuses.length > 0 || unmatchedCategories.length > 0 ||
      unmatchedAgents.length > 0 || unmatchedTeams.length > 0 || unmatchedContacts.length > 0 ||
      unparsableDateGroups.length > 0;
  }, [unmatchedClients, unmatchedPriorities, unmatchedStatuses, unmatchedCategories, unmatchedAgents, unmatchedTeams, unmatchedContacts, unparsableDateGroups]);

  // -------------------------------------------------------------------------
  // Import
  // -------------------------------------------------------------------------

  const handleImport = useCallback(async () => {
    if (isProcessing || !referenceData || mappedRows.length === 0) return;

    setIsProcessing(true);
    setStep('importing');
    setErrors([]);

    try {
      const processed = processTicketRows(
        mappedRows,
        referenceData,
        defaultBoardId,
        clientResolutions,
        agentResolutions,
        statusResolutions,
        priorityResolutions,
        categoryResolutions,
        contactResolutions,
        teamResolutions,
        dateFormatResolutions,
        importOptions.skipInvalidRows
      );

      const result = await importTickets(
        processed, statusResolutions, clientResolutions,
        priorityResolutions, categoryResolutions, defaultBoardId
      );
      setImportResult(result);
      setStep('complete');
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'Error importing tickets']);
      setStep('preview');
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, referenceData, mappedRows, defaultBoardId, clientResolutions, agentResolutions, statusResolutions, priorityResolutions, categoryResolutions, contactResolutions, teamResolutions, dateFormatResolutions, importOptions.skipInvalidRows]);

  const handleProceedFromPreview = useCallback(() => {
    if (hasAnyUnmatched) {
      setStep('resolve_data');
    } else {
      handleImport();
    }
  }, [hasAnyUnmatched, handleImport]);

  // -------------------------------------------------------------------------
  // Close
  // -------------------------------------------------------------------------

  const handleClose = useCallback(() => {
    if (isProcessing) return;
    if (step === 'complete') {
      onImportComplete();
    }
    onClose();
  }, [isProcessing, step, onImportComplete, onClose]);

  // -------------------------------------------------------------------------
  // Computed values
  // -------------------------------------------------------------------------

  const { validCount, invalidCount } = useMemo(() => ({
    validCount: validationResults.filter(r => r.isValid).length,
    invalidCount: validationResults.filter(r => !r.isValid).length,
  }), [validationResults]);

  const totalTickets = importOptions.skipInvalidRows ? validCount : validationResults.length;
  const requiresConfirmation = totalTickets >= LARGE_TICKET_IMPORT_THRESHOLD;
  const canProceedWithImport = !requiresConfirmation || importConfirmed;

  // (individual hasIncomplete* removed — consolidated into hasIncompleteMappings below)

  // Count how many tickets will be skipped due to client skip resolutions
  const skippedDueToClients = useMemo(() => {
    const skippedClientNames = new Set(
      clientResolutions.filter(r => r.action === 'skip').map(r => r.originalClientName.toLowerCase())
    );
    if (skippedClientNames.size === 0) return 0;
    return validationResults.filter(r =>
      r.data.client?.trim() && skippedClientNames.has(r.data.client.trim().toLowerCase())
    ).length;
  }, [clientResolutions, validationResults]);

  // Next step label for preview
  const nextStepLabel = useMemo(() => {
    if (hasAnyUnmatched) return 'Resolve Unmatched Data';
    return `Import ${totalTickets} Ticket${totalTickets === 1 ? '' : 's'}`;
  }, [hasAnyUnmatched, totalTickets]);

  // Check for incomplete mappings across all resolution types
  const hasIncompleteMappings = useMemo(() => {
    return clientResolutions.some(r => r.action === 'map_to_existing' && !r.mappedClientId) ||
      agentResolutions.some(r => r.action === 'map_to_existing' && !r.mappedUserId) ||
      statusResolutions.some(r => r.action === 'map_to_existing' && !r.mappedStatusId) ||
      priorityResolutions.some(r => r.action === 'map_to_existing' && !r.mappedPriorityId) ||
      categoryResolutions.some(r => r.action === 'map_to_existing' && !r.mappedCategoryId) ||
      contactResolutions.some(r => r.action === 'map_to_existing' && !r.mappedContactId) ||
      teamResolutions.some(r => r.action === 'map_to_existing' && !r.mappedTeamId);
  }, [clientResolutions, agentResolutions, statusResolutions, priorityResolutions, categoryResolutions, contactResolutions, teamResolutions]);

  // Total unmatched count for the resolve step header
  const totalUnmatchedCount = unmatchedClients.length + unmatchedPriorities.length +
    unmatchedStatuses.length + unmatchedCategories.length + unmatchedAgents.length +
    unmatchedTeams.length + unmatchedContacts.length + unparsableDateGroups.length;

  // Board categories for category resolution
  const boardCategories = useMemo(() => {
    if (!referenceData || !defaultBoardId) return [];
    return referenceData.categoriesByBoard[defaultBoardId] || referenceData.categoriesByBoard['_global'] || [];
  }, [referenceData, defaultBoardId]);

  // Board options for dropdown
  const boardOptions = useMemo(() => {
    return initialBoards
      .filter(b => !b.is_inactive && b.board_id)
      .map(b => ({
        value: b.board_id!,
        label: (b.board_name || 'Unnamed Board') + (b.is_default ? ' (default)' : ''),
      }));
  }, [initialBoards]);

  // Available statuses for the selected default board (for status resolution)
  const boardStatuses = useMemo(() => {
    if (!referenceData || !defaultBoardId) return [];
    return referenceData.statusesByBoard[defaultBoardId] || referenceData.statusesByBoard['_global'] || [];
  }, [referenceData, defaultBoardId]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title="Import Tickets"
      className="max-w-5xl"
      disableFocusTrap
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

        {/* ============================================================= */}
        {/* Step 1: Upload                                                 */}
        {/* ============================================================= */}
        {step === 'upload' && (
          <div className="text-center p-8 border-2 border-dashed border-gray-300 dark:border-[rgb(var(--color-border-200))] rounded-lg">
            <Upload className="mx-auto h-12 w-12 text-gray-400 dark:text-[rgb(var(--color-text-500))]" />
            <p className="mt-2 text-sm text-gray-600 dark:text-[rgb(var(--color-text-400))]">
              Upload a CSV file with ticket data
            </p>
            <p className="mt-1 text-xs text-gray-500 dark:text-[rgb(var(--color-text-500))]">
              <strong>Required:</strong> title, client<br />
              <strong>Optional:</strong> description, status, priority, category, contact, assigned_to, assigned_team, due_date, entered_at, closed_at, is_closed, tags<br />
              <strong>Tip:</strong> Column names from other PSAs (ConnectWise, Autotask, HaloPSA, Zendesk, Freshdesk) are auto-detected
            </p>
            <div className="mt-4 space-y-3">
              <Input
                id="ticket-csv-upload"
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                disabled={isProcessing}
              />
              <Button
                id="download-ticket-template-btn"
                variant="outline"
                onClick={async () => {
                  const template = await generateTicketCSVTemplate();
                  const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' });
                  const link = document.createElement('a');
                  const url = URL.createObjectURL(blob);
                  link.setAttribute('href', url);
                  link.setAttribute('download', 'ticket_import_template.csv');
                  link.style.visibility = 'hidden';
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  URL.revokeObjectURL(url);
                }}
                className="w-full"
              >
                <Download className="h-4 w-4 mr-2" />
                Download CSV Template
              </Button>
            </div>
          </div>
        )}

        {/* ============================================================= */}
        {/* Step 2: Board Selection                                        */}
        {/* ============================================================= */}
        {step === 'board_selection' && (
          <div>
            <h3 className="text-lg font-medium mb-2 text-gray-900 dark:text-[rgb(var(--color-text-100))]">
              Select Board
            </h3>
            <p className="text-sm text-gray-600 dark:text-[rgb(var(--color-text-400))] mb-4">
              All tickets will be imported to this board. Statuses and categories are board-specific, so this determines which are available.
            </p>

            <div className="mb-6">
              <CustomSelect
                options={boardOptions}
                value={defaultBoardId}
                onValueChange={(value) => setDefaultBoardId(value)}
                placeholder="Select a board..."
              />
            </div>

            <DialogFooter>
              <Button
                id="board-back-btn"
                variant="outline"
                onClick={() => setStep('upload')}
              >
                Back
              </Button>
              <Button
                id="board-next-btn"
                onClick={handleBoardNext}
                disabled={!defaultBoardId}
              >
                Next
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* ============================================================= */}
        {/* Step 3: Column Mapping                                         */}
        {/* ============================================================= */}
        {step === 'mapping' && previewData && (
          <div>
            <h3 className="text-lg font-medium mb-4 text-gray-900 dark:text-[rgb(var(--color-text-100))]">
              Map Ticket Fields to CSV Columns
            </h3>
            <p className="text-sm text-gray-600 dark:text-[rgb(var(--color-text-400))] mb-4">
              Select which CSV column contains the data for each field. Fields marked with * are required.
            </p>
            <div className="max-h-[60vh] overflow-y-auto pr-2">
              <div className="mb-2 flex items-center gap-4 text-sm font-semibold text-gray-700 dark:text-[rgb(var(--color-text-200))]">
                <span className="w-1/3">Field</span>
                <span className="w-2/3">Select CSV Column</span>
              </div>
              <div className="border-t dark:border-[rgb(var(--color-border-200))] pt-4 space-y-3">
                {Object.entries(TICKET_IMPORT_FIELDS).filter(([fieldKey]) => fieldKey !== 'board' && fieldKey !== 'subcategory').map(([fieldKey, { label, required }]) => {
                  const currentMapping = columnMappings.find(m => m.ticketField === fieldKey);
                  const csvHeader = currentMapping?.csvHeader || 'unassigned';

                  // Get already mapped CSV headers (excluding current field)
                  const mappedHeaders = columnMappings
                    .filter(m => m.ticketField && m.ticketField !== fieldKey)
                    .map(m => m.csvHeader);

                  const isUnmapped = csvHeader === 'unassigned';
                  return (
                    <div key={fieldKey} className={`flex items-center gap-4 px-3 py-1.5 rounded-md ${isUnmapped && required ? 'bg-destructive/5 ring-1 ring-destructive/20' : ''}`}>
                      <span className={`w-1/3 text-sm font-medium flex items-center gap-2 ${isUnmapped && required ? 'text-destructive' : 'text-gray-900 dark:text-[rgb(var(--color-text-100))]'}`}>
                        {isUnmapped && required && <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
                        {!isUnmapped && <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" />}
                        {label}
                      </span>
                      <span className="text-gray-400 dark:text-[rgb(var(--color-text-500))]">&#8592;</span>
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
                          setColumnMappings(prev =>
                            prev.map((m): ICSVTicketColumnMapping => {
                              if (currentMapping && m.csvHeader === currentMapping.csvHeader) {
                                return { ...m, ticketField: null };
                              }
                              if (value !== 'unassigned' && m.csvHeader === value) {
                                return { ...m, ticketField: fieldKey as MappableTicketField };
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

            <div className="mt-4">
              <DialogFooter>
                <Button
                  id="mapping-back-btn"
                  variant="outline"
                  onClick={() => setStep('board_selection')}
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

        {/* ============================================================= */}
        {/* Step 4: Preview & Validation                                   */}
        {/* ============================================================= */}
        {step === 'preview' && validationResults.length > 0 && (
          <div>
            <h3 className="text-lg font-medium mb-4 text-gray-900 dark:text-[rgb(var(--color-text-100))]">
              Preview Import
            </h3>
            <Alert variant="info" className="mb-4">
              <AlertDescription>
                <strong>Total rows:</strong> {validationResults.length} |
                <strong className="ml-2">Valid:</strong> {validCount} |
                <strong className="ml-2">Invalid:</strong> {invalidCount}
              </AlertDescription>
            </Alert>

            {/* Import Options */}
            {invalidCount > 0 && (
              <div className="mb-4">
                <div className="flex items-center justify-between py-3 border-b dark:border-[rgb(var(--color-border-200))]">
                  <div>
                    <div className="text-gray-900 dark:text-[rgb(var(--color-text-100))] font-medium">Skip invalid rows</div>
                    <div className="text-sm text-gray-500 dark:text-[rgb(var(--color-text-500))]">Continue import even if some rows have validation errors</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-700 dark:text-[rgb(var(--color-text-300))]">
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
            )}

            {/* Validation Results Table */}
            <div className="max-h-64 overflow-x-auto overflow-y-auto">
              <DataTable
                key={`${currentPage}-${pageSize}`}
                id="ticket-import-preview-table"
                pagination={true}
                currentPage={currentPage}
                onPageChange={setCurrentPage}
                pageSize={pageSize}
                onItemsPerPageChange={(newSize) => { setPageSize(newSize); setCurrentPage(1); }}
                data={validationResults.map((result) => ({
                  status: result.isValid,
                  rowNumber: result.rowNumber,
                  title: result.data.title,
                  client: result.data.client,
                  priority: result.data.priority,
                  errors: result.errors,
                  warnings: result.warnings,
                }))}
                columns={[
                  {
                    title: '',
                    dataIndex: 'status',
                    render: (value: boolean) =>
                      value ? (
                        <div className="flex justify-center">
                          <Tooltip content="Valid">
                            <Check className="h-4 w-4 text-green-600 cursor-help" />
                          </Tooltip>
                        </div>
                      ) : (
                        <div className="flex justify-center">
                          <Tooltip content="Has errors">
                            <AlertTriangle className="h-4 w-4 text-destructive cursor-help" />
                          </Tooltip>
                        </div>
                      ),
                  },
                  { title: 'Row', dataIndex: 'rowNumber' },
                  { title: 'Title', dataIndex: 'title' },
                  { title: 'Client', dataIndex: 'client' },
                  {
                    title: 'Issues',
                    dataIndex: 'issues',
                    width: '35%',
                    render: (_value: unknown, record: Record<string, unknown>) => {
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
                                <div key={`e-${i}`} className="break-words">&#8226; {error}</div>
                              ))}
                            </div>
                          )}
                          {recordWarnings.length > 0 && (
                            <div className="text-gray-500 dark:text-[rgb(var(--color-text-500))]">
                              {recordWarnings.map((warning: string, i: number) => (
                                <div key={`w-${i}`} className="break-words">&#8226; {warning}</div>
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

            {/* Unmatched data alert */}
            {hasAnyUnmatched && (
              <Alert variant="info" className="mt-4">
                <AlertDescription>
                  <strong>{totalUnmatchedCount} value(s)</strong> from your CSV don&apos;t match existing data
                  ({[
                    unmatchedClients.length > 0 && `${unmatchedClients.length} client${unmatchedClients.length > 1 ? 's' : ''}`,
                    unmatchedPriorities.length > 0 && `${unmatchedPriorities.length} priorit${unmatchedPriorities.length > 1 ? 'ies' : 'y'}`,
                    unmatchedStatuses.length > 0 && `${unmatchedStatuses.length} status${unmatchedStatuses.length > 1 ? 'es' : ''}`,
                    unmatchedCategories.length > 0 && `${unmatchedCategories.length} categor${unmatchedCategories.length > 1 ? 'ies' : 'y'}`,
                    unmatchedAgents.length > 0 && `${unmatchedAgents.length} agent${unmatchedAgents.length > 1 ? 's' : ''}`,
                    unmatchedTeams.length > 0 && `${unmatchedTeams.length} team${unmatchedTeams.length > 1 ? 's' : ''}`,
                    unmatchedContacts.length > 0 && `${unmatchedContacts.length} contact${unmatchedContacts.length > 1 ? 's' : ''}`,
                    unparsableDateGroups.length > 0 && `${unparsableDateGroups.length} date format${unparsableDateGroups.length > 1 ? 's' : ''}`,
                  ].filter(Boolean).join(', ')}).
                  You&apos;ll resolve these in the next step.
                </AlertDescription>
              </Alert>
            )}


            {invalidCount > 0 && !importOptions.skipInvalidRows && (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>
                  <strong>{invalidCount} row(s)</strong> have validation errors.
                  Enable "Skip invalid rows" to proceed, or go back and fix your CSV.
                </AlertDescription>
              </Alert>
            )}

            {/* Large import confirmation (only when going directly to import) */}
            {!hasAnyUnmatched && requiresConfirmation && (
              <Alert variant="warning" className="mt-4">
                <AlertDescription>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={importConfirmed}
                      onChange={(e) => setImportConfirmed(e.target.checked)}
                      className="mt-1 text-primary-500"
                    />
                    <div>
                      <span className="font-medium">
                        Confirm large import ({totalTickets} tickets)
                      </span>
                      <p className="text-sm mt-1">
                        I understand this will create {totalTickets} ticket(s). This may take a while.
                      </p>
                    </div>
                  </label>
                </AlertDescription>
              </Alert>
            )}

            <div className="mt-4">
              <DialogFooter>
                <Button
                  id="preview-back-btn"
                  variant="outline"
                  onClick={() => setStep('mapping')}
                >
                  Back
                </Button>
                <Button
                  id="preview-next-btn"
                  onClick={handleProceedFromPreview}
                  disabled={
                    (invalidCount > 0 && !importOptions.skipInvalidRows) ||
                    (!hasAnyUnmatched && !canProceedWithImport)
                  }
                >
                  {nextStepLabel}
                </Button>
              </DialogFooter>
            </div>
          </div>
        )}

        {/* ============================================================= */}
        {/* Step 5: Consolidated Resolve Data                              */}
        {/* ============================================================= */}
        {step === 'resolve_data' && (
          <div>
            <h3 className="text-lg font-medium mb-2 text-gray-900 dark:text-[rgb(var(--color-text-100))]">
              Resolve Unmatched Data
            </h3>
            <p className="text-sm text-gray-600 dark:text-[rgb(var(--color-text-400))] mb-4">
              {totalUnmatchedCount} value{totalUnmatchedCount === 1 ? '' : 's'} from your CSV couldn&apos;t be automatically matched.
              Choose how to handle each one below.
            </p>

            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
              {/* --- Clients Section --- */}
              {unmatchedClients.length > 0 && (
                <div className="border rounded-lg dark:border-[rgb(var(--color-border-200))]">
                  <button type="button" onClick={() => toggleSection('clients')} className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-[rgb(var(--color-border-100))]">
                    <span className="font-medium text-gray-900 dark:text-[rgb(var(--color-text-100))]">Clients ({unmatchedClients.length} unmatched)</span>
                    <span className="text-xs text-red-500 font-medium">Required</span>
                  </button>
                  {expandedSections.has('clients') && (
                    <div className="px-4 pb-4 space-y-3 border-t dark:border-[rgb(var(--color-border-200))]">
                      {unmatchedClientInfo.map(info => {
                        const res = clientResolutions.find(r => r.originalClientName.toLowerCase() === info.name.toLowerCase());
                        if (!res) return null;
                        return (
                          <div key={info.name} className="pt-3 space-y-2">
                            <div><span className="font-medium text-sm">&quot;{info.name}&quot;</span> <span className="text-xs text-gray-500">({info.ticketCount} ticket{info.ticketCount === 1 ? '' : 's'})</span></div>
                            <RadioGroup
                              name={`client-${info.name}`}
                              value={res.action}
                              onChange={(value) => handleClientResolutionChange(info.name, value as ClientResolutionAction)}
                              orientation="horizontal"
                              size="sm"
                              options={[
                                { value: 'create', label: 'Create new' },
                                { value: 'map_to_existing', label: 'Map to existing' },
                                { value: 'skip', label: `Skip (${info.ticketCount} ticket${info.ticketCount === 1 ? '' : 's'} dropped)` },
                              ]}
                            />
                            {res.action === 'map_to_existing' && (
                              <div className="ml-1">
                                <ClientPicker id={`client-res-${info.name}`} clients={initialClients} onSelect={(id) => handleClientResolutionChange(info.name, 'map_to_existing', id || undefined)} selectedClientId={res.mappedClientId || null} filterState="active" onFilterStateChange={() => {}} clientTypeFilter="all" onClientTypeFilterChange={() => {}} placeholder="Select client..." fitContent />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* --- Priorities Section --- */}
              {unmatchedPriorities.length > 0 && (
                <div className="border rounded-lg dark:border-[rgb(var(--color-border-200))]">
                  <button type="button" onClick={() => toggleSection('priorities')} className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-[rgb(var(--color-border-100))]">
                    <span className="font-medium text-gray-900 dark:text-[rgb(var(--color-text-100))]">Priorities ({unmatchedPriorities.length} unmatched)</span>
                  </button>
                  {expandedSections.has('priorities') && (
                    <div className="px-4 pb-4 space-y-3 border-t dark:border-[rgb(var(--color-border-200))]">
                      {unmatchedPriorityInfo.map(info => {
                        const res = priorityResolutions.find(r => r.originalPriorityName.toLowerCase() === info.name.toLowerCase());
                        if (!res) return null;
                        return (
                          <div key={info.name} className="pt-3 space-y-2">
                            <div><span className="font-medium text-sm">&quot;{info.name}&quot;</span> <span className="text-xs text-gray-500">({info.ticketCount} ticket{info.ticketCount === 1 ? '' : 's'})</span></div>
                            <RadioGroup
                              name={`prio-${info.name}`}
                              value={res.action}
                              onChange={(value) => handlePriorityResolutionChange(info.name, value as PriorityResolutionAction)}
                              orientation="horizontal"
                              size="sm"
                              options={[
                                { value: 'create', label: 'Create new' },
                                { value: 'map_to_existing', label: 'Map to existing' },
                                { value: 'use_default', label: 'Use default' },
                              ]}
                            />
                            {res.action === 'map_to_existing' && referenceData && (
                              <div className="ml-1"><CustomSelect options={referenceData.priorities.map(p => ({ value: p.priority_id, label: p.priority_name }))} value={res.mappedPriorityId || ''} onValueChange={(v) => handlePriorityResolutionChange(info.name, 'map_to_existing', v)} placeholder="Select priority..." /></div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* --- Statuses Section --- */}
              {unmatchedStatuses.length > 0 && (
                <div className="border rounded-lg dark:border-[rgb(var(--color-border-200))]">
                  <button type="button" onClick={() => toggleSection('statuses')} className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-[rgb(var(--color-border-100))]">
                    <span className="font-medium text-gray-900 dark:text-[rgb(var(--color-text-100))]">Statuses ({unmatchedStatuses.length} unmatched)</span>
                  </button>
                  {expandedSections.has('statuses') && (
                    <div className="px-4 pb-4 space-y-3 border-t dark:border-[rgb(var(--color-border-200))]">
                      {unmatchedStatusInfo.map(info => {
                        const res = statusResolutions.find(r => r.originalStatusName.toLowerCase() === info.name.toLowerCase());
                        if (!res) return null;
                        return (
                          <div key={info.name} className="pt-3 space-y-2">
                            <div><span className="font-medium text-sm">&quot;{info.name}&quot;</span> <span className="text-xs text-gray-500">({info.ticketCount} ticket{info.ticketCount === 1 ? '' : 's'})</span></div>
                            <RadioGroup
                              name={`status-${info.name}`}
                              value={res.action}
                              onChange={(value) => handleStatusResolutionChange(info.name, value as TicketStatusResolutionAction)}
                              orientation="horizontal"
                              size="sm"
                              options={[
                                { value: 'create', label: 'Create new' },
                                { value: 'map_to_existing', label: 'Map to existing' },
                                { value: 'use_default', label: 'Use board default' },
                              ]}
                            />
                            {res.action === 'map_to_existing' && (
                              <div className="ml-1"><CustomSelect options={boardStatuses.map(s => ({ value: s.status_id, label: s.name + (s.is_closed ? ' (closed)' : '') }))} value={res.mappedStatusId || ''} onValueChange={(v) => handleStatusResolutionChange(info.name, 'map_to_existing', v)} placeholder="Select status..." /></div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* --- Categories Section --- */}
              {unmatchedCategories.length > 0 && (
                <div className="border rounded-lg dark:border-[rgb(var(--color-border-200))]">
                  <button type="button" onClick={() => toggleSection('categories')} className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-[rgb(var(--color-border-100))]">
                    <span className="font-medium text-gray-900 dark:text-[rgb(var(--color-text-100))]">Categories ({unmatchedCategories.length} unmatched)</span>
                  </button>
                  {expandedSections.has('categories') && (
                    <div className="px-4 pb-4 space-y-3 border-t dark:border-[rgb(var(--color-border-200))]">
                      {unmatchedCategoryInfo.map(info => {
                        const res = categoryResolutions.find(r => r.originalCategoryName.toLowerCase() === info.name.toLowerCase());
                        if (!res) return null;
                        return (
                          <div key={info.name} className="pt-3 space-y-2">
                            <div><span className="font-medium text-sm">&quot;{info.name}&quot;</span> <span className="text-xs text-gray-500">({info.ticketCount} ticket{info.ticketCount === 1 ? '' : 's'})</span></div>
                            <RadioGroup
                              name={`cat-${info.name}`}
                              value={res.action}
                              onChange={(value) => handleCategoryResolutionChange(info.name, value as CategoryResolutionAction)}
                              orientation="horizontal"
                              size="sm"
                              options={[
                                { value: 'create', label: 'Create new' },
                                { value: 'map_to_existing', label: 'Map to existing' },
                                { value: 'skip', label: 'Skip (leave uncategorized)' },
                              ]}
                            />
                            {res.action === 'map_to_existing' && (
                              <div className="ml-1"><CustomSelect options={boardCategories.filter(c => !c.parent_category).map(c => ({ value: c.category_id, label: c.category_name }))} value={res.mappedCategoryId || ''} onValueChange={(v) => handleCategoryResolutionChange(info.name, 'map_to_existing', v)} placeholder="Select category..." /></div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* --- Agents Section --- */}
              {unmatchedAgents.length > 0 && (
                <div className="border rounded-lg dark:border-[rgb(var(--color-border-200))]">
                  <button type="button" onClick={() => toggleSection('agents')} className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-[rgb(var(--color-border-100))]">
                    <span className="font-medium text-gray-900 dark:text-[rgb(var(--color-text-100))]">Agents ({unmatchedAgents.length} unmatched)</span>
                  </button>
                  {expandedSections.has('agents') && (
                    <div className="px-4 pb-4 space-y-3 border-t dark:border-[rgb(var(--color-border-200))]">
                      {unmatchedAgentInfo.map(info => {
                        const res = agentResolutions.find(r => r.originalAgentName.toLowerCase() === info.name.toLowerCase());
                        if (!res) return null;
                        return (
                          <div key={info.name} className="pt-3 space-y-2">
                            <div><span className="font-medium text-sm">&quot;{info.name}&quot;</span> <span className="text-xs text-gray-500">({info.ticketCount} ticket{info.ticketCount === 1 ? '' : 's'})</span></div>
                            <RadioGroup
                              name={`agent-${info.name}`}
                              value={res.action}
                              onChange={(value) => handleAgentResolutionChange(info.name, value as TicketAgentResolutionAction)}
                              orientation="horizontal"
                              size="sm"
                              options={[
                                { value: 'skip', label: 'Skip (leave unassigned)' },
                                { value: 'map_to_existing', label: 'Map to existing' },
                              ]}
                            />
                            {res.action === 'map_to_existing' && (
                              <div className="ml-1">
                                <UserPicker value={res.mappedUserId || ''} onValueChange={(v) => handleAgentResolutionChange(info.name, 'map_to_existing', v)} users={initialUsers || (referenceData?.users || []).map(u => ({ ...u, is_inactive: u.is_inactive ?? false })) as IUser[]} size="sm" getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction} />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* --- Teams Section --- */}
              {unmatchedTeams.length > 0 && (
                <div className="border rounded-lg dark:border-[rgb(var(--color-border-200))]">
                  <button type="button" onClick={() => toggleSection('teams')} className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-[rgb(var(--color-border-100))]">
                    <span className="font-medium text-gray-900 dark:text-[rgb(var(--color-text-100))]">Teams ({unmatchedTeams.length} unmatched)</span>
                  </button>
                  {expandedSections.has('teams') && (
                    <div className="px-4 pb-4 space-y-3 border-t dark:border-[rgb(var(--color-border-200))]">
                      {unmatchedTeamInfo.map(info => {
                        const res = teamResolutions.find(r => r.originalTeamName.toLowerCase() === info.name.toLowerCase());
                        if (!res) return null;
                        return (
                          <div key={info.name} className="pt-3 space-y-2">
                            <div><span className="font-medium text-sm">&quot;{info.name}&quot;</span> <span className="text-xs text-gray-500">({info.ticketCount} ticket{info.ticketCount === 1 ? '' : 's'})</span></div>
                            <RadioGroup
                              name={`team-${info.name}`}
                              value={res.action}
                              onChange={(value) => handleTeamResolutionChange(info.name, value as TeamResolutionAction)}
                              orientation="horizontal"
                              size="sm"
                              options={[
                                { value: 'skip', label: 'Skip (no team assigned)' },
                                { value: 'map_to_existing', label: 'Map to existing' },
                              ]}
                            />
                            {res.action === 'map_to_existing' && referenceData && (
                              <div className="ml-1"><CustomSelect options={referenceData.teams.map(t => ({ value: t.team_id, label: t.team_name }))} value={res.mappedTeamId || ''} onValueChange={(v) => handleTeamResolutionChange(info.name, 'map_to_existing', v)} placeholder="Select team..." /></div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* --- Contacts Section --- */}
              {unmatchedContacts.length > 0 && (
                <div className="border rounded-lg dark:border-[rgb(var(--color-border-200))]">
                  <button type="button" onClick={() => toggleSection('contacts')} className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-[rgb(var(--color-border-100))]">
                    <span className="font-medium text-gray-900 dark:text-[rgb(var(--color-text-100))]">Contacts ({unmatchedContacts.length} unmatched)</span>
                  </button>
                  {expandedSections.has('contacts') && (
                    <div className="px-4 pb-4 space-y-3 border-t dark:border-[rgb(var(--color-border-200))]">
                      {unmatchedContactInfo.map(info => {
                        const res = contactResolutions.find(r => r.originalContactName.toLowerCase() === info.name.toLowerCase());
                        if (!res) return null;
                        return (
                          <div key={info.name} className="pt-3 space-y-2">
                            <div><span className="font-medium text-sm">&quot;{info.name}&quot;</span> <span className="text-xs text-gray-500">({info.ticketCount} ticket{info.ticketCount === 1 ? '' : 's'})</span></div>
                            <RadioGroup
                              name={`contact-${info.name}`}
                              value={res.action}
                              onChange={(value) => handleContactResolutionChange(info.name, value as ContactResolutionAction)}
                              orientation="horizontal"
                              size="sm"
                              options={[
                                { value: 'skip', label: 'Skip (leave blank)' },
                                { value: 'map_to_existing', label: 'Map to existing' },
                              ]}
                            />
                            {res.action === 'map_to_existing' && referenceData && (
                              <div className="ml-1"><CustomSelect options={referenceData.contacts.map(c => ({ value: c.contact_name_id, label: c.full_name + (c.email ? ` (${c.email})` : '') }))} value={res.mappedContactId || ''} onValueChange={(v) => handleContactResolutionChange(info.name, 'map_to_existing', v)} placeholder="Select contact..." /></div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* --- Dates Section --- */}
              {unparsableDateGroups.length > 0 && (
                <div className="border rounded-lg dark:border-[rgb(var(--color-border-200))]">
                  <button type="button" onClick={() => toggleSection('dates')} className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-[rgb(var(--color-border-100))]">
                    <span className="font-medium text-gray-900 dark:text-[rgb(var(--color-text-100))]">Date Formats ({unparsableDateGroups.length} unrecognized)</span>
                    <span className="text-xs text-amber-600 font-medium">Needs interpretation</span>
                  </button>
                  {expandedSections.has('dates') && (
                    <div className="px-4 pb-4 space-y-4 border-t dark:border-[rgb(var(--color-border-200))]">
                      <p className="text-xs text-gray-500 dark:text-[rgb(var(--color-text-500))] pt-2">
                        Some dates in your CSV couldn&apos;t be automatically read. Tell us how to interpret them.
                      </p>
                      {unparsableDateGroups.map(group => {
                        const res = dateFormatResolutions.find(r => r.patternKey === group.patternKey);
                        return (
                          <div key={group.patternKey} className="pt-3 space-y-2 border-t dark:border-[rgb(var(--color-border-200))] first:border-t-0">
                            <div className="text-sm">
                              <span className="text-gray-500 dark:text-[rgb(var(--color-text-500))]">Your dates look like:</span>
                              <span className="ml-2 font-medium text-gray-900 dark:text-[rgb(var(--color-text-100))]">
                                {group.sampleValues.slice(0, 3).join(', ')}
                              </span>
                              {group.sampleValues.length > 3 && <span className="text-gray-400"> ...</span>}
                              <span className="text-xs text-gray-500 ml-2">({group.totalCount} total)</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-gray-600 dark:text-[rgb(var(--color-text-400))] shrink-0">This means:</span>
                              <CustomSelect
                                options={group.possibleFormats.map(f => ({
                                  value: f,
                                  label: f === 'skip' ? 'Skip these dates' :
                                    f === 'MM/DD/YYYY' ? 'Month/Day/Year (US)' :
                                    f === 'DD/MM/YYYY' ? 'Day/Month/Year (International)' :
                                    f === 'MM/DD/YY' ? 'Month/Day/Year (2-digit year, US)' :
                                    f === 'DD/MM/YY' ? 'Day/Month/Year (2-digit year, International)' :
                                    f === 'MM-DD-YYYY' ? 'Month-Day-Year (US)' :
                                    f === 'DD-MM-YYYY' ? 'Day-Month-Year (International)' :
                                    f === 'YYYY.MM.DD' ? 'Year.Month.Day' :
                                    f === 'DD.MM.YYYY' ? 'Day.Month.Year' :
                                    f,
                                }))}
                                value={res?.selectedFormat || group.possibleFormats[0]}
                                onValueChange={(v) => handleDateFormatChange(group.patternKey, v as DateFormatInterpretation)}
                                placeholder="Select format..."
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {skippedDueToClients > 0 && (
              <Alert variant="warning" className="mt-4">
                <AlertDescription>
                  <strong>{skippedDueToClients} ticket(s)</strong> will be skipped due to skipped client resolutions.
                </AlertDescription>
              </Alert>
            )}

            {requiresConfirmation && (
              <Alert variant="warning" className="mt-4">
                <AlertDescription>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={importConfirmed} onChange={(e) => setImportConfirmed(e.target.checked)} className="mt-1 text-primary-500" />
                    <div>
                      <span className="font-medium">Confirm large import ({totalTickets} tickets)</span>
                      <p className="text-sm mt-1">I understand this will create up to {totalTickets} ticket(s). This may take a while.</p>
                    </div>
                  </label>
                </AlertDescription>
              </Alert>
            )}

            <div className="mt-4">
              <DialogFooter>
                <Button id="resolve-back-btn" variant="outline" onClick={() => setStep('preview')}>Back</Button>
                <Button id="resolve-import-btn" onClick={handleImport} disabled={hasIncompleteMappings || !canProceedWithImport}>
                  Import Tickets
                </Button>
              </DialogFooter>
            </div>
          </div>
        )}

        {/* ============================================================= */}
        {/* Step 8: Importing                                              */}
        {/* ============================================================= */}
        {step === 'importing' && (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto mb-4" />
            <p className="text-gray-600 dark:text-[rgb(var(--color-text-400))]">Importing tickets...</p>
            <p className="text-sm text-gray-400 dark:text-[rgb(var(--color-text-600))] mt-2">
              This may take a moment for large imports.
            </p>
          </div>
        )}

        {/* ============================================================= */}
        {/* Step 9: Complete                                               */}
        {/* ============================================================= */}
        {step === 'complete' && importResult && (
          <div className="text-center py-8">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100 dark:bg-green-900/30 mb-4">
              <Check className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <h3 className="text-lg font-medium mb-2 text-gray-900 dark:text-[rgb(var(--color-text-100))]">
              Import Complete
            </h3>
            <p className="text-gray-600 dark:text-[rgb(var(--color-text-400))]">
              Successfully created <strong>{importResult.ticketsCreated}</strong> ticket{importResult.ticketsCreated === 1 ? '' : 's'}.
              {importResult.ticketsSkipped > 0 && (
                <> <strong>{importResult.ticketsSkipped}</strong> ticket{importResult.ticketsSkipped === 1 ? ' was' : 's were'} skipped.</>
              )}
            </p>

            {importResult.errors.length > 0 && (
              <div className="mt-4 text-left">
                <Alert variant={importResult.ticketsCreated > 0 ? 'warning' : 'destructive'}>
                  <AlertDescription>
                    <p className="font-medium mb-2">{importResult.errors.length} issue(s) during import:</p>
                    <div className="max-h-40 overflow-y-auto text-sm">
                      {importResult.errors.slice(0, 20).map((error, i) => (
                        <div key={i} className="mb-1">&#8226; {error}</div>
                      ))}
                      {importResult.errors.length > 20 && (
                        <div className="text-gray-500 mt-1">... and {importResult.errors.length - 20} more</div>
                      )}
                    </div>
                  </AlertDescription>
                </Alert>
              </div>
            )}

            <DialogFooter className="mt-6">
              <Button id="import-done-btn" onClick={handleClose}>
                Done
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default TicketImportDialog;
