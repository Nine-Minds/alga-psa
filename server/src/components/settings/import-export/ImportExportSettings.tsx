import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from 'server/src/components/ui/Table';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import CustomTabs, { TabContent } from 'server/src/components/ui/CustomTabs';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { useImportActions } from './hooks/useImportActions';

const ImportExportSettings = (): JSX.Element => {

  const {
    isLoading,
    error,
    sources,
    history,
    preview,
    fieldDefinitions,
    selectedSourceId,
    setSelectedSourceId,
    fieldMapping,
    setFieldMapping,
    createPreview,
  } = useImportActions();

  const [file, setFile] = useState<File | null>(null);
  const [persistTemplate, setPersistTemplate] = useState(true);

  const sourceOptions = useMemo(
    () =>
      sources.map((source) => ({
        value: source.import_source_id,
        label: source.name,
      })),
    [sources]
  );

  const handleMappingChange = (field: string, value: string) => {
    setFieldMapping((prev) => {
      const next = { ...prev };

      // Remove existing mapping referencing this target
      Object.entries(next).forEach(([sourceField, definition]) => {
        if (definition.target === field) {
          delete next[sourceField];
        }
      });

      if (value.trim().length > 0) {
        next[value.trim()] = { target: field };
      }

      return next;
    });
  };

  const getSourceValueForField = (field: string) => {
    const entry = Object.entries(fieldMapping).find(([, definition]) => definition.target === field);
    return entry ? entry[0] : '';
  };

  const handleSubmit = async () => {
    if (!selectedSourceId) {
      alert('Select an import source to continue.');
      return;
    }

    if (!file) {
      alert('Choose a CSV or XLSX file to continue.');
      return;
    }

    await createPreview({
      importSourceId: selectedSourceId,
      mapping: fieldMapping,
      file,
      persistTemplate,
    });
  };

  const tabs: TabContent[] = useMemo(() => [
    {
      label: 'Asset Import',
      content: (
        <div className="space-y-6">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="import-source">Import source</Label>
              <CustomSelect
                id="import-source"
                options={sourceOptions}
                value={selectedSourceId ?? ''}
                onValueChange={(value) => setSelectedSourceId(value || null)}
                placeholder={sources.length === 0 ? 'No import sources available' : 'Select an import source'}
                disabled={isLoading || sourceOptions.length === 0}
                className="h-10 !border-border/60 text-sm"
                customStyles={{
                  trigger: '!border-border/60 hover:bg-primary-500/5',
                }}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="import-file">Upload file</Label>
              <Input
                id="import-file"
                type="file"
                className="h-13 !border-border/60 !focus:ring-primary-400 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary-500/10 file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-700"
                accept=".csv,.tsv,.txt,.xls,.xlsx"
                onChange={(event) => {
                  const nextFile = event.target.files?.[0] ?? null;
                  setFile(nextFile);
                }}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="persist-template"
              checked={persistTemplate}
              onChange={(event) => setPersistTemplate(event.currentTarget.checked)}
            />
            <Label htmlFor="persist-template" className="text-sm font-normal">
              Remember this mapping for future imports
            </Label>
          </div>

          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-medium text-foreground">Field mapping</h3>
              <p className="text-sm text-muted-foreground">
                Enter the column names from your file that correspond to each required asset field. Leave optional fields blank to skip them.
              </p>
            </div>

            <div className="grid gap-3">
              {fieldDefinitions.map((definition) => (
                <div key={definition.field} className="grid gap-1">
                  <div className="flex items-center justify-between">
                    <Label htmlFor={`field-${definition.field}`}>
                      {definition.label}
                      {definition.required && <span className="text-destructive"> *</span>}
                    </Label>
                    {definition.example && (
                      <span className="text-xs text-muted-foreground">e.g. {definition.example}</span>
                    )}
                  </div>
                  <Input
                    id={`field-${definition.field}`}
                    placeholder="Source column name"
                    value={getSourceValueForField(definition.field)}
                    onChange={(event) => handleMappingChange(definition.field, event.target.value)}
                    disabled={isLoading}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button id="start-import-button" onClick={handleSubmit} disabled={isLoading || !file || !selectedSourceId}>
              {isLoading ? 'Preparing Preview…' : 'Generate Preview'}
            </Button>
          </div>

          {preview && (
            <Card className="border border-muted">
              <CardHeader>
                <CardTitle className="text-lg">Import Preview</CardTitle>
                <CardDescription>
                  Showing up to the first 10 rows from {preview.preview.summary.totalRows} total records.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <PreviewStat label="Total" value={preview.preview.summary.totalRows} />
                  <PreviewStat label="Valid" value={preview.preview.summary.validRows} />
                  <PreviewStat label="Duplicates" value={preview.preview.summary.duplicateRows} />
                  <PreviewStat label="Errors" value={preview.preview.summary.errorRows} variant="destructive" />
                </div>

                {preview.errorSummary && preview.errorSummary.topErrors?.length > 0 && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      <span className="font-medium text-foreground">Validation issues detected.</span>
                      <ul className="list-disc pl-5 mt-2 space-y-1 text-sm">
                        {preview.errorSummary.topErrors.map((issue: any) => (
                          <li key={issue.field}>
                            <span className="font-medium">{issue.field}</span>: {issue.sampleMessage} ({issue.count} occurrences)
                          </li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">Row</TableHead>
                      <TableHead>Values</TableHead>
                      <TableHead>Issues</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.preview.rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-6">
                          No preview rows available.
                        </TableCell>
                      </TableRow>
                    ) : (
                      preview.preview.rows.map((row: any) => (
                        <TableRow key={row.rowNumber}>
                          <TableCell>{row.rowNumber}</TableCell>
                          <TableCell>
                            <div className="grid gap-1 text-sm">
                              {Object.entries(row.values ?? {}).map(([key, value]) => (
                                <div key={key} className="flex gap-2">
                                  <span className="font-medium text-foreground w-32 truncate">{key}</span>
                                  <span className="text-muted-foreground flex-1 truncate">{String(value ?? '')}</span>
                                </div>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1 text-sm text-muted-foreground">
                              {(row.validationErrors ?? []).map((issue: any, index: number) => (
                                <div key={`${row.rowNumber}-error-${index}`} className="text-destructive">
                                  {issue.field}: {issue.message}
                                </div>
                              ))}
                              {row.duplicate?.isDuplicate && (
                                <div className="text-amber-600">
                                  Potential duplicate ({row.duplicate.matchType})
                                </div>
                              )}
                              {!row.validationErrors?.length && !row.duplicate?.isDuplicate && '—'}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      ),
    },
    {
      label: 'Asset Export',
      content: (
        <div className="space-y-4">
          <Alert>
            <AlertDescription>
              Asset export tooling is coming soon. Planned capabilities include exporting filtered asset lists, audit data, and mapping templates directly to CSV/XLSX.
            </AlertDescription>
          </Alert>
        </div>
      ),
    },
    {
      label: 'Templates & Automation',
      content: (
        <div className="space-y-4">
          <Alert>
            <AlertDescription>
              Mapping templates and scheduled imports will live here. Save column mappings, share them across the team, and configure recurring jobs.
            </AlertDescription>
          </Alert>
        </div>
      ),
    },
  ], [createPreview, error, fieldDefinitions, fieldMapping, handleMappingChange, handleSubmit, isLoading, persistTemplate, preview, selectedSourceId, setPersistTemplate, setSelectedSourceId, setFile, sources, getSourceValueForField]);

  return (
    <div className="space-y-6" data-testid="import-export-settings">
      <Card>
        <CardHeader>
          <CardTitle>Import &amp; Export Workspace</CardTitle>
          <CardDescription>
            Configure imports, exports, and automated data flows from a single control centre.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CustomTabs
            tabs={tabs}
            orientation="vertical"
            tabStyles={{
              list: 'border-border/40 dark:border-border/50',
              trigger: 'text-sm font-medium data-[state=active]:bg-primary-500/10 rounded-md transition-colors',
              content: 'min-h-[260px]'
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Import &amp; Export History</CardTitle>
          <CardDescription>Review every import or export job in one place.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Rows</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">
                    No import or export jobs found. Generate a preview to create the first job.
                  </TableCell>
                </TableRow>
              ) : (
                history.map((job) => (
                  <TableRow key={job.import_job_id}>
                    <TableCell>{new Date(job.created_at).toLocaleString()}</TableCell>
                    <TableCell>{job.file_name ?? job.import_source_id}</TableCell>
                    <TableCell className="capitalize">{job.status}</TableCell>
                    <TableCell className="text-right">
                      {job.total_rows} total / {job.processed_rows} processed
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

const PreviewStat = ({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant?: 'default' | 'destructive';
}) => {
  const color = variant === 'destructive' ? 'text-destructive' : 'text-foreground';
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-xl font-semibold ${color}`}>{value}</p>
    </div>
  );
};

export default ImportExportSettings;
