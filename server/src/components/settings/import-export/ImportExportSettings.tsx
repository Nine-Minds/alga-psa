import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from 'server/src/components/ui/Table';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Checkbox } from 'server/src/components/ui/Checkbox';
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

  return (
    <div className="space-y-6" data-testid="import-export-settings">
      <Card>
        <CardHeader>
          <CardTitle>New Asset Import</CardTitle>
          <CardDescription>
            Upload asset data from CSV or XLSX files, review validation results, and push records into your environment.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="import-source">Import source</Label>
              <select
                id="import-source"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={isLoading || sources.length === 0}
                value={selectedSourceId ?? ''}
                onChange={(event) => setSelectedSourceId(event.target.value)}
              >
                {sources.length === 0 ? (
                  <option value="">No import sources available</option>
                ) : (
                  sources.map((source) => (
                    <option key={source.import_source_id} value={source.import_source_id}>
                      {source.name}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="import-file">Upload file</Label>
              <Input
                id="import-file"
                type="file"
                accept=".csv,.tsv,.txt,.xls,.xlsx"
                onChange={(event) => {
                  const nextFile = event.target.files?.[0] ?? null;
                  setFile(nextFile);
                }}
              />
            </div>
          </div>

          <div className="grid gap-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="persist-template"
                checked={persistTemplate}
                onCheckedChange={(value) => setPersistTemplate(Boolean(value))}
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Import History</CardTitle>
          <CardDescription>Review previous imports, their progress, and results.</CardDescription>
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
                    No import jobs found. Generate a preview to create the first job.
                  </TableCell>
                </TableRow>
              ) : (
                history.map((job) => (
                  <TableRow key={job.import_job_id}>
                    <TableCell>{new Date(job.created_at).toLocaleString()}</TableCell>
                    <TableCell>{job.file_name ?? '—'}</TableCell>
                    <TableCell>{job.status}</TableCell>
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
