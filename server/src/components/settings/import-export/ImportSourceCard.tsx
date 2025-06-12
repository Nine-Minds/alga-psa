'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../ui/Dialog';
import { RadioGroup, RadioGroupItem } from '../../ui/RadioGroup';
import { Label } from '../../ui/Label';
import { Download, FileText, Users, CheckCircle, XCircle } from 'lucide-react';

interface ImportSource {
  sourceId: string;
  displayName: string;
  enabled: boolean;
  supportsImport: boolean;
  supportsExport: boolean;
}

interface ImportSourceCardProps {
  source: ImportSource;
  onImport: (sourceId: string, artifactType: 'company' | 'contact') => Promise<void>;
}

export default function ImportSourceCard({ source, onImport }: ImportSourceCardProps) {
  const [showModal, setShowModal] = useState(false);
  const [selectedArtifact, setSelectedArtifact] = useState<'company' | 'contact'>('company');
  const [importing, setImporting] = useState(false);

  const handleImportClick = () => {
    setShowModal(true);
  };

  const handleConfirmImport = async () => {
    setImporting(true);
    try {
      await onImport(source.sourceId, selectedArtifact);
      setShowModal(false);
    } catch (error) {
      // Error handled in parent component
    } finally {
      setImporting(false);
    }
  };

  // Determine if this source is connected (for QBO, we'd check connection status)
  // For now, we'll assume it's connected if enabled
  const isConnected = source.enabled;

  return (
    <>
      <Card className="relative overflow-hidden">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-lg">{source.displayName}</CardTitle>
              <CardDescription className="mt-1">
                Import companies and contacts
              </CardDescription>
            </div>
            {isConnected ? (
              <Badge variant="success" className="flex items-center gap-1">
                <CheckCircle className="h-3 w-3" />
                Connected
              </Badge>
            ) : (
              <Badge variant="secondary" className="flex items-center gap-1">
                <XCircle className="h-3 w-3" />
                Not Connected
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              {source.sourceId === 'qbo' && (
                <>
                  Import your QuickBooks Online customers as companies and contacts in Alga PSA.
                  Existing records will be updated based on email matching.
                </>
              )}
            </div>
            
            <div className="flex items-center gap-2">
              <Button
                id="import-source-button"
                onClick={handleImportClick}
                disabled={!isConnected}
                className="w-full"
              >
                <Download className="h-4 w-4 mr-2" />
                Import Data
              </Button>
            </div>

            {!isConnected && source.sourceId === 'qbo' && (
              <p className="text-xs text-muted-foreground text-center">
                Connect to QuickBooks Online in the Integrations tab first
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Import Options Modal */}
      <Dialog isOpen={showModal} onClose={() => setShowModal(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import from {source.displayName}</DialogTitle>
            <DialogDescription>
              Choose what type of data you want to import
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <RadioGroup value={selectedArtifact} onValueChange={(value: any) => setSelectedArtifact(value)}>
              <div className="space-y-3">
                <div className="flex items-start space-x-3">
                  <RadioGroupItem value="company" id="company" />
                  <Label htmlFor="company" className="cursor-pointer">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      <span className="font-medium">Companies</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Import customers as company records
                    </p>
                  </Label>
                </div>
                
                <div className="flex items-start space-x-3">
                  <RadioGroupItem value="contact" id="contact" />
                  <Label htmlFor="contact" className="cursor-pointer">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      <span className="font-medium">Contacts</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Import customers as individual contacts
                    </p>
                  </Label>
                </div>
              </div>
            </RadioGroup>
          </div>

          <DialogFooter>
            <Button
              id="cancel-import-button"
              variant="outline"
              onClick={() => setShowModal(false)}
              disabled={importing}
            >
              Cancel
            </Button>
            <Button
              id="confirm-import-button"
              onClick={handleConfirmImport}
              disabled={importing}
            >
              {importing ? 'Starting Import...' : 'Start Import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}