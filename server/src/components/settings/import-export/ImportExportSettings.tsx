import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from 'server/src/components/ui/Table';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';

const ImportExportSettings = (): JSX.Element => {
  return (
    <div className="space-y-6" data-testid="import-export-settings">
      <Card>
        <CardHeader>
          <CardTitle>New Asset Import</CardTitle>
          <CardDescription>
            Upload asset data from CSV or XLSX files, review validation results, and push records into your environment.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertDescription>
              <span className="font-medium text-foreground">Coming soon.</span> Phase 2 enables CSV/XLSX uploads with mapping templates and preview validation for duplicate detection.
            </AlertDescription>
          </Alert>
          <div className="flex flex-wrap gap-3">
            <Button id="start-import-button" disabled>
              New Import
            </Button>
            <Button id="view-templates-button" variant="outline" disabled>
              Manage Mapping Templates
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Import History</CardTitle>
          <CardDescription>Review previous imports, progress, and downloadable error reports.</CardDescription>
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
              <TableRow>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">
                  Recent import jobs will appear here once Phase 2 is completed.
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default ImportExportSettings;
