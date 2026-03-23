'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Box } from '@radix-ui/themes';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@alga-psa/ui/components/Dialog';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import type { IClient, IContact, IQuote, QuoteConversionPreview } from '@alga-psa/types';
import { getAllClientsForBilling } from '../../../actions/billingClientsActions';
import { approveQuote, convertQuoteToBoth, convertQuoteToContract, convertQuoteToInvoice, createQuoteRevision, deleteQuote, duplicateQuote, getQuote, getQuoteApprovalSettings, getQuoteConversionPreview, getQuotePdfFileId, listQuoteVersions, renderQuotePreview, requestQuoteApprovalChanges, resendQuote, saveQuoteAsTemplate, sendQuote, sendQuoteReminder, submitQuoteForApproval, updateQuote } from '../../../actions/quoteActions';
import { getAllContacts } from '@alga-psa/clients/actions';
import QuoteStatusBadge from './QuoteStatusBadge';

interface QuoteDetailProps {
  quoteId: string;
  onBack: () => void;
  onEdit?: () => void;
  onSelectVersion?: (quoteId: string) => void;
}

function formatCurrency(minorUnits: number, currencyCode: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode,
  }).format((minorUnits || 0) / 100);
}

function formatDate(value?: string | null): string {
  if (!value) {
    return '—';
  }

  return new Date(value).toLocaleDateString();
}

function formatQuoteNumber(quote: IQuote): string {
  const baseNumber = quote.quote_number || 'Template quote';
  return quote.version > 1 ? `${baseNumber} v${quote.version}` : baseNumber;
}

function hasConvertibleRecurringItems(quote: IQuote | null): boolean {
  return Boolean((quote?.quote_items || []).some((item) => item.is_recurring && !item.is_discount && (!item.is_optional || item.is_selected !== false)));
}

function hasConvertibleOneTimeItems(quote: IQuote | null): boolean {
  const oneTimeItems = (quote?.quote_items || []).filter((item) => !item.is_recurring && (!item.is_optional || item.is_selected !== false));
  if (oneTimeItems.some((item) => !item.is_discount)) {
    return true;
  }

  const oneTimeItemIds = new Set(oneTimeItems.filter((item) => !item.is_discount).map((item) => item.quote_item_id));
  const oneTimeServiceIds = new Set(oneTimeItems.filter((item) => !item.is_discount && item.service_id).map((item) => item.service_id));

  return oneTimeItems.some((item) => item.is_discount && (!item.applies_to_item_id || oneTimeItemIds.has(item.applies_to_item_id) || (item.applies_to_service_id ? oneTimeServiceIds.has(item.applies_to_service_id) : true)));
}

type ConversionMode = 'contract' | 'invoice' | 'both';

const QuoteDetail: React.FC<QuoteDetailProps> = ({ quoteId, onBack, onEdit, onSelectVersion }) => {
  const router = useRouter();
  const [quote, setQuote] = useState<IQuote | null>(null);
  const [versions, setVersions] = useState<IQuote[]>([]);
  const [clients, setClients] = useState<IClient[]>([]);
  const [contacts, setContacts] = useState<IContact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conversionMode, setConversionMode] = useState<ConversionMode | null>(null);
  const [conversionPreview, setConversionPreview] = useState<QuoteConversionPreview | null>(null);
  const [isConversionDialogOpen, setIsConversionDialogOpen] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [approvalDialogMode, setApprovalDialogMode] = useState<'approve' | 'changes' | null>(null);
  const [approvalComment, setApprovalComment] = useState('');
  const [isSendDialogOpen, setIsSendDialogOpen] = useState(false);
  const [sendMessage, setSendMessage] = useState('');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<{ html: string; css: string } | null>(null);
  const [isPreviewLoading2, setIsPreviewLoading2] = useState(false);

  useEffect(() => {
    void loadQuote();
  }, [quoteId]);

  const loadQuote = async () => {
    try {
      setIsLoading(true);
      const [loadedQuote, loadedClients, loadedContacts, approvalSettings] = await Promise.all([
        getQuote(quoteId),
        getAllClientsForBilling(false),
        getAllContacts('active'),
        getQuoteApprovalSettings(),
      ]);

      if (!loadedQuote || 'permissionError' in loadedQuote) {
        throw new Error(!loadedQuote ? 'Quote not found' : loadedQuote.permissionError);
      }

      setQuote(loadedQuote);
      setClients(loadedClients);
      setContacts(loadedContacts);
      setApprovalRequired(!('permissionError' in approvalSettings) && approvalSettings.approvalRequired === true);

      const loadedVersions = await listQuoteVersions(quoteId);
      setVersions(Array.isArray(loadedVersions) ? loadedVersions : []);
      setError(null);
    } catch (loadError) {
      console.error('Error loading quote detail:', loadError);
      setError(loadError instanceof Error ? loadError.message : 'Failed to load quote detail');
    } finally {
      setIsLoading(false);
    }
  };

  const client = useMemo(() => clients.find((entry) => entry.client_id === quote?.client_id) ?? null, [clients, quote?.client_id]);
  const contact = useMemo(() => contacts.find((entry) => entry.contact_name_id === quote?.contact_id) ?? null, [contacts, quote?.contact_id]);
  const acceptedOptionalItems = useMemo(
    () => (quote?.quote_items || []).filter((item) => item.is_optional),
    [quote?.quote_items]
  );
  const canConvertToContract = useMemo(() => hasConvertibleRecurringItems(quote), [quote]);
  const canConvertToInvoice = useMemo(() => hasConvertibleOneTimeItems(quote), [quote]);
  const canConvertToBoth = canConvertToContract && canConvertToInvoice;

  const handleDelete = async () => {
    if (!quote) {
      return;
    }

    try {
      setIsWorking(true);
      setError(null);
      setNotice(null);
      const result = await deleteQuote(quote.quote_id);

      if ('permissionError' in result) {
        throw new Error(result.permissionError);
      }

      if (!result.deleted) {
        throw new Error(result.message || 'Quote could not be deleted');
      }

      onBack();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Failed to delete quote');
    } finally {
      setIsWorking(false);
    }
  };

  const handleCancelQuote = async () => {
    if (!quote) {
      return;
    }

    try {
      setIsWorking(true);
      setError(null);
      setNotice(null);
      const result = await updateQuote(quote.quote_id, { status: 'cancelled' });

      if ('permissionError' in result) {
        throw new Error(result.permissionError);
      }

      setQuote(result);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Failed to cancel quote');
    } finally {
      setIsWorking(false);
    }
  };

  const handleSubmitForApproval = async () => {
    if (!quote) {
      return;
    }

    try {
      setIsWorking(true);
      setError(null);
      setNotice(null);
      const result = await submitQuoteForApproval(quote.quote_id);

      if ('permissionError' in result) {
        throw new Error(result.permissionError);
      }

      setQuote(result);
      setNotice('Quote submitted for internal approval.');
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Failed to submit quote for approval');
    } finally {
      setIsWorking(false);
    }
  };

  const handleApproveQuote = async () => {
    if (!quote) {
      return;
    }

    try {
      setIsWorking(true);
      setError(null);
      setNotice(null);
      const result = await approveQuote(quote.quote_id, approvalComment);

      if ('permissionError' in result) {
        throw new Error(result.permissionError);
      }

      setQuote(result);
      setApprovalDialogMode(null);
      setApprovalComment('');
      setNotice('Quote approved and is ready to send.');
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Failed to approve quote');
    } finally {
      setIsWorking(false);
    }
  };

  const handleRequestChanges = async () => {
    if (!quote) {
      return;
    }

    try {
      setIsWorking(true);
      setError(null);
      setNotice(null);
      const result = await requestQuoteApprovalChanges(quote.quote_id, approvalComment);

      if ('permissionError' in result) {
        throw new Error(result.permissionError);
      }

      setQuote(result);
      setApprovalDialogMode(null);
      setApprovalComment('');
      setNotice('Quote returned to draft with requested changes.');
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Failed to request quote changes');
    } finally {
      setIsWorking(false);
    }
  };

  const handleResendQuote = async () => {
    if (!quote) {
      return;
    }

    try {
      setIsWorking(true);
      setError(null);
      setNotice(null);
      const result = await resendQuote(quote.quote_id);

      if ('permissionError' in result) {
        throw new Error(result.permissionError);
      }

      setQuote(result);
      setNotice('Quote resent to the configured billing recipients.');
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Failed to resend quote');
    } finally {
      setIsWorking(false);
    }
  };

  const handleSendReminder = async () => {
    if (!quote) {
      return;
    }

    try {
      setIsWorking(true);
      setError(null);
      setNotice(null);
      const result = await sendQuoteReminder(quote.quote_id);

      if ('permissionError' in result) {
        throw new Error(result.permissionError);
      }

      setQuote(result);
      setNotice('Quote reminder sent to the configured billing recipients.');
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Failed to send quote reminder');
    } finally {
      setIsWorking(false);
    }
  };

  const handleDuplicateQuote = async () => {
    if (!quote) {
      return;
    }

    try {
      setIsWorking(true);
      setError(null);
      setNotice(null);
      const result = await duplicateQuote(quote.quote_id);

      if ('permissionError' in result) {
        throw new Error(result.permissionError);
      }

      router.push(`/msp/billing?tab=quotes&quoteId=${result.quote_id}&mode=edit`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Failed to duplicate quote');
    } finally {
      setIsWorking(false);
    }
  };

  const handleSaveAsTemplate = async () => {
    if (!quote) {
      return;
    }

    try {
      setIsWorking(true);
      setError(null);
      setNotice(null);
      const result = await saveQuoteAsTemplate(quote.quote_id);

      if ('permissionError' in result) {
        throw new Error(result.permissionError);
      }

      router.push(`/msp/billing?tab=quotes&quoteId=${result.quote_id}&mode=edit`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Failed to save quote as template');
    } finally {
      setIsWorking(false);
    }
  };

  const handleSendQuote = async () => {
    if (!quote) {
      return;
    }

    try {
      setIsWorking(true);
      setError(null);
      setNotice(null);
      const result = await sendQuote(quote.quote_id, {
        message: sendMessage.trim() || undefined,
      });

      if ('permissionError' in result) {
        throw new Error(result.permissionError);
      }

      setQuote(result);
      setIsSendDialogOpen(false);
      setSendMessage('');
      setNotice('Quote sent to the client.');
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Failed to send quote');
    } finally {
      setIsWorking(false);
    }
  };

  const handleReviseQuote = async () => {
    if (!quote) {
      return;
    }

    try {
      setIsWorking(true);
      setError(null);
      setNotice(null);
      const result = await createQuoteRevision(quote.quote_id);

      if ('permissionError' in result) {
        throw new Error(result.permissionError);
      }

      router.push(`/msp/billing?tab=quotes&quoteId=${result.quote_id}&mode=edit`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Failed to create quote revision');
    } finally {
      setIsWorking(false);
    }
  };

  const handleViewPdf = async () => {
    if (!quote) {
      return;
    }

    try {
      setIsWorking(true);
      setError(null);
      const fileId = await getQuotePdfFileId(quote.quote_id);

      if (fileId && typeof fileId === 'object' && 'permissionError' in fileId) {
        throw new Error(fileId.permissionError);
      }

      if (!fileId) {
        setError('No PDF has been generated for this quote yet. Send the quote first to generate a PDF.');
        return;
      }

      window.open(`/api/files/${fileId}`, '_blank');
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Failed to load quote PDF');
    } finally {
      setIsWorking(false);
    }
  };

  const handlePreviewPdf = async () => {
    if (!quote) {
      return;
    }

    try {
      setIsPreviewLoading2(true);
      setError(null);
      const result = await renderQuotePreview(quote.quote_id);

      if (result && typeof result === 'object' && 'permissionError' in result) {
        throw new Error(result.permissionError);
      }

      setPreviewHtml(result as { html: string; css: string });
      setIsPreviewOpen(true);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Failed to generate quote preview');
    } finally {
      setIsPreviewLoading2(false);
    }
  };

  const handleOpenConversionDialog = async (mode: ConversionMode) => {
    if (!quote) {
      return;
    }

    try {
      setIsPreviewLoading(true);
      setError(null);
      setNotice(null);
      setConversionMode(mode);
      const preview = await getQuoteConversionPreview(quote.quote_id);

      if ('permissionError' in preview) {
        throw new Error(preview.permissionError);
      }

      setConversionPreview(preview);
      setIsConversionDialogOpen(true);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Failed to load conversion preview');
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleConfirmConversion = async () => {
    if (!quote || !conversionMode) {
      return;
    }

    try {
      setIsWorking(true);
      setError(null);
      setNotice(null);

      if (conversionMode === 'contract') {
        const result = await convertQuoteToContract(quote.quote_id);
        if ('permissionError' in result) {
          throw new Error(result.permissionError);
        }
        setQuote(result.quote);
        setNotice(`Created draft contract ${result.contract.contract_name}.`);
      } else if (conversionMode === 'invoice') {
        const result = await convertQuoteToInvoice(quote.quote_id);
        if ('permissionError' in result) {
          throw new Error(result.permissionError);
        }
        setQuote(result.quote);
        setNotice(`Created draft invoice ${result.invoice.invoice_number}.`);
      } else {
        const result = await convertQuoteToBoth(quote.quote_id);
        if ('permissionError' in result) {
          throw new Error(result.permissionError);
        }
        setQuote(result.quote);
        setNotice(`Created draft contract ${result.contract.contract_name} and draft invoice ${result.invoice.invoice_number}.`);
      }

      setIsConversionDialogOpen(false);
      setConversionPreview(null);
      setConversionMode(null);
    } catch (conversionError) {
      setError(conversionError instanceof Error ? conversionError.message : 'Failed to convert quote');
    } finally {
      setIsWorking(false);
    }
  };

  const renderPrimaryActions = () => {
    if (!quote) {
      return null;
    }

    const status = quote.status || 'draft';

    switch (status) {
      case 'draft':
        return (
          <>
            {onEdit ? <Button id="quote-detail-edit" onClick={onEdit} disabled={isWorking}>Edit</Button> : null}
            {approvalRequired ? (
              <Button id="quote-detail-submit-approval" onClick={() => void handleSubmitForApproval()} disabled={isWorking}>Submit for Approval</Button>
            ) : (
              <Button id="quote-detail-send" onClick={() => setIsSendDialogOpen(true)} disabled={isWorking}>Send to Client</Button>
            )}
            <Button id="quote-detail-delete" variant="outline" onClick={() => void handleDelete()} disabled={isWorking}>Delete</Button>
          </>
        );
      case 'pending_approval':
        return (
          <>
            <Button id="quote-detail-approve" onClick={() => setApprovalDialogMode('approve')} disabled={isWorking}>Approve</Button>
            <Button id="quote-detail-request-changes" variant="outline" onClick={() => setApprovalDialogMode('changes')} disabled={isWorking}>Request Changes</Button>
          </>
        );
      case 'sent':
        return (
          <>
            <Button id="quote-detail-revise" onClick={() => void handleReviseQuote()} disabled={isWorking}>Revise</Button>
            <Button id="quote-detail-resend" variant="outline" onClick={() => void handleResendQuote()} disabled={isWorking}>Resend</Button>
            <Button id="quote-detail-reminder" variant="outline" onClick={() => void handleSendReminder()} disabled={isWorking}>Send Reminder</Button>
            <Button id="quote-detail-cancel" variant="outline" onClick={() => void handleCancelQuote()} disabled={isWorking}>Cancel</Button>
          </>
        );
      case 'accepted':
        return (
          <>
            <Button id="quote-detail-convert-contract" onClick={() => void handleOpenConversionDialog('contract')} disabled={isWorking || isPreviewLoading || !canConvertToContract}>Convert to Contract</Button>
            <Button id="quote-detail-convert-invoice" onClick={() => void handleOpenConversionDialog('invoice')} disabled={isWorking || isPreviewLoading || !canConvertToInvoice}>Convert to Invoice</Button>
            <Button id="quote-detail-convert-both" onClick={() => void handleOpenConversionDialog('both')} disabled={isWorking || isPreviewLoading || !canConvertToBoth}>Convert to Both</Button>
          </>
        );
      case 'approved':
        return <Button id="quote-detail-send-approved" onClick={() => setIsSendDialogOpen(true)} disabled={isWorking}>Send to Client</Button>;
      default:
        return onEdit ? <Button id="quote-detail-edit" onClick={onEdit} disabled={isWorking}>Edit</Button> : null;
    }
  };

  if (isLoading) {
    return (
      <Card size="2">
        <Box p="4">
          <LoadingIndicator
            className="py-12 text-muted-foreground"
            layout="stacked"
            spinnerProps={{ size: 'md' }}
            text="Loading quote details..."
            textClassName="text-muted-foreground"
          />
        </Box>
      </Card>
    );
  }

  if (error || !quote) {
    return (
      <Card size="2">
        <Box p="4" className="space-y-4">
          <Button id="quote-detail-back-error" variant="outline" onClick={onBack}>Back to Quotes</Button>
          <Alert variant="destructive">
            <AlertTitle>Quote Detail</AlertTitle>
            <AlertDescription>{error || 'Quote not found'}</AlertDescription>
          </Alert>
        </Box>
      </Card>
    );
  }

  return (
    <Card size="2">
      <Box p="4" className="space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">{formatQuoteNumber(quote)}</div>
            <h2 className="text-2xl font-semibold text-foreground">{quote.title}</h2>
            <div>
              <QuoteStatusBadge status={quote.status || 'draft'} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button id="quote-detail-back" variant="outline" onClick={onBack}>Back</Button>
            {renderPrimaryActions()}
            {!quote.is_template ? (
              <>
                <Button id="quote-detail-duplicate" variant="outline" onClick={() => void handleDuplicateQuote()} disabled={isWorking}>Duplicate</Button>
                <Button id="quote-detail-save-template" variant="outline" onClick={() => void handleSaveAsTemplate()} disabled={isWorking}>Save as Template</Button>
              </>
            ) : null}
            <Button id="quote-detail-preview-pdf" variant="outline" onClick={() => void handlePreviewPdf()} disabled={isWorking || isPreviewLoading2}>
              {isPreviewLoading2 ? 'Loading...' : 'Preview'}
            </Button>
            <Button id="quote-detail-view-pdf" variant="outline" onClick={() => void handleViewPdf()} disabled={isWorking}>Download PDF</Button>
          </div>
        </div>

        {notice ? (
          <Alert>
            <AlertTitle>Quote Update</AlertTitle>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}

        {quote.converted_contract_id || quote.converted_invoice_id ? (
          <section className="flex flex-wrap gap-2 rounded-lg border border-border p-4">
            {quote.converted_contract_id ? (
              <Button
                id="quote-detail-open-converted-contract"
                variant="outline"
                onClick={() => router.push(`/msp/billing?tab=client-contracts&contractId=${quote.converted_contract_id}`)}
              >
                Open Converted Contract
              </Button>
            ) : null}
            {quote.converted_invoice_id ? (
              <Button
                id="quote-detail-open-converted-invoice"
                variant="outline"
                onClick={() => router.push(`/msp/billing?tab=invoicing&subtab=drafts&invoiceId=${quote.converted_invoice_id}`)}
              >
                Open Converted Invoice
              </Button>
            ) : null}
          </section>
        ) : null}

        <section className="grid gap-4 rounded-lg border border-border p-4 md:grid-cols-2 xl:grid-cols-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Client</div>
            <div className="mt-1 font-medium">{client?.client_name || quote.client_id || '—'}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Contact</div>
            <div className="mt-1 font-medium">{contact?.full_name || quote.contact_id || '—'}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Quote Date</div>
            <div className="mt-1 font-medium">{formatDate(quote.quote_date)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Valid Until</div>
            <div className="mt-1 font-medium">{formatDate(quote.valid_until)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">PO Number</div>
            <div className="mt-1 font-medium">{quote.po_number || '—'}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Total</div>
            <div className="mt-1 font-medium">{formatCurrency(quote.total_amount, quote.currency_code || 'USD')}</div>
          </div>
        </section>

        <section className="grid gap-3 rounded-lg border border-border p-4 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Subtotal</div>
            <div className="mt-1 text-lg font-semibold">{formatCurrency(quote.subtotal, quote.currency_code || 'USD')}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Discounts</div>
            <div className="mt-1 text-lg font-semibold">{formatCurrency(quote.discount_total, quote.currency_code || 'USD')}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Tax</div>
            <div className="mt-1 text-lg font-semibold">{formatCurrency(quote.tax, quote.currency_code || 'USD')}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Total</div>
            <div className="mt-1 text-lg font-semibold">{formatCurrency(quote.total_amount, quote.currency_code || 'USD')}</div>
          </div>
        </section>

        <section className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="text-base font-semibold">Version History</h3>
          {versions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {versions.map((version) => (
                <Button
                  key={version.quote_id}
                  id={`quote-version-${version.quote_id}`}
                  type="button"
                  variant={version.quote_id === quote.quote_id ? 'default' : 'outline'}
                  onClick={() => onSelectVersion?.(version.quote_id)}
                  disabled={version.quote_id === quote.quote_id}
                >
                  {formatQuoteNumber(version)}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No prior revisions for this quote yet.</p>
          )}
        </section>

        <section className="space-y-2 rounded-lg border border-border p-4">
          <h3 className="text-base font-semibold">Scope of Work</h3>
          <p className="whitespace-pre-wrap text-sm text-foreground">{quote.description || '—'}</p>
        </section>

        <section className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="text-base font-semibold">Line Items</h3>
          {quote.status === 'accepted' && acceptedOptionalItems.length > 0 ? (
            <Alert>
              <AlertTitle>Client Configuration Submitted</AlertTitle>
              <AlertDescription>
                Review the optional line items below before converting this quote. Selected items are marked as included, and declined items are highlighted for follow-up.
              </AlertDescription>
            </Alert>
          ) : null}
          {quote.quote_items?.length ? (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Description</th>
                    <th className="px-3 py-2 font-medium">Billing</th>
                    <th className="px-3 py-2 font-medium">Qty</th>
                    <th className="px-3 py-2 font-medium">Unit Price</th>
                    <th className="px-3 py-2 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-background">
                  {quote.quote_items.map((item) => {
                    const showClientSelection = quote.status === 'accepted' && item.is_optional;
                    const clientSelected = item.is_selected !== false;

                    return (
                    <tr
                      key={item.quote_item_id}
                      className={showClientSelection ? (clientSelected ? 'bg-emerald-50/60' : 'bg-amber-50/70') : undefined}
                    >
                      <td className="px-3 py-3 align-top">
                        <div className="font-medium text-foreground">{item.description}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.service_name || 'Custom item'}
                          {item.service_sku ? ` • ${item.service_sku}` : ''}
                          {item.phase ? ` • Phase: ${item.phase}` : ''}
                          {item.is_optional ? ' • Optional' : ''}
                          {item.is_recurring ? ` • Recurring${item.billing_frequency ? ` (${item.billing_frequency})` : ''}` : ''}
                        </div>
                        {showClientSelection ? (
                          <div className={`mt-2 inline-flex rounded-full px-2 py-1 text-xs font-medium ${clientSelected ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                            {clientSelected ? 'Client selected this optional item' : 'Client declined this optional item'}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 align-top text-muted-foreground">{item.billing_method || '—'}</td>
                      <td className="px-3 py-3 align-top text-muted-foreground">{item.quantity}</td>
                      <td className="px-3 py-3 align-top text-muted-foreground">
                        {formatCurrency(item.unit_price, quote.currency_code || 'USD')}
                      </td>
                      <td className="px-3 py-3 align-top font-medium text-foreground">
                        {formatCurrency(item.total_price, quote.currency_code || 'USD')}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No line items on this quote yet.</p>
          )}
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2 rounded-lg border border-border p-4">
            <h3 className="text-base font-semibold">Client Notes</h3>
            <p className="whitespace-pre-wrap text-sm text-foreground">{quote.client_notes || '—'}</p>
          </div>
          <div className="space-y-2 rounded-lg border border-border p-4">
            <h3 className="text-base font-semibold">Internal Notes</h3>
            <p className="whitespace-pre-wrap text-sm text-foreground">{quote.internal_notes || '—'}</p>
          </div>
        </section>

        <section className="space-y-2 rounded-lg border border-border p-4">
          <h3 className="text-base font-semibold">Terms &amp; Conditions</h3>
          <p className="whitespace-pre-wrap text-sm text-foreground">{quote.terms_and_conditions || '—'}</p>
        </section>

        <section className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="text-base font-semibold">Activity Log</h3>
          {quote.quote_activities?.length ? (
            <div className="space-y-3">
              {quote.quote_activities.map((activity) => (
                <div key={activity.activity_id} className="rounded-md border border-border p-3">
                  <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                    <div className="font-medium text-foreground">{activity.description}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(activity.created_at)}</div>
                  </div>
                  <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
                    {activity.activity_type.replace(/_/g, ' ')}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No quote activity recorded yet.</p>
          )}
        </section>
      </Box>
      <Dialog id="quote-conversion-preview" isOpen={isConversionDialogOpen} onClose={() => setIsConversionDialogOpen(false)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Conversion Preview</DialogTitle>
            <DialogDescription>
              Review what this quote conversion will create before confirming.
            </DialogDescription>
          </DialogHeader>

          {conversionPreview ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Contract Items</div>
                  <div className="mt-1 text-lg font-semibold">{conversionPreview.contract_items.length}</div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Invoice Items</div>
                  <div className="mt-1 text-lg font-semibold">{conversionPreview.invoice_items.length}</div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Excluded Items</div>
                  <div className="mt-1 text-lg font-semibold">{conversionPreview.excluded_items.length}</div>
                </div>
              </div>

              <section className="space-y-2 rounded-lg border border-border p-4">
                <h3 className="text-base font-semibold">Will Become Contract Lines</h3>
                {conversionPreview.contract_items.length ? (
                  <div className="space-y-2">
                    {conversionPreview.contract_items.map((item) => (
                      <div key={item.quote_item_id} className="rounded-md border border-border p-3">
                        <div className="font-medium text-foreground">{item.description}</div>
                        <div className="text-sm text-muted-foreground">
                          {item.billing_method || 'fixed'} • Qty {item.quantity} • {formatCurrency(item.total_price, quote.currency_code || 'USD')}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No recurring items will convert to a contract.</p>
                )}
              </section>

              <section className="space-y-2 rounded-lg border border-border p-4">
                <h3 className="text-base font-semibold">Will Become Invoice Charges</h3>
                {conversionPreview.invoice_items.length ? (
                  <div className="space-y-2">
                    {conversionPreview.invoice_items.map((item) => (
                      <div key={item.quote_item_id} className="rounded-md border border-border p-3">
                        <div className="font-medium text-foreground">{item.description}</div>
                        <div className="text-sm text-muted-foreground">
                          {item.is_discount ? 'Discount' : (item.billing_method || 'fixed')} • Qty {item.quantity} • {formatCurrency(item.total_price, quote.currency_code || 'USD')}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No one-time items will convert to an invoice.</p>
                )}
              </section>

              {conversionPreview.excluded_items.length ? (
                <section className="space-y-2 rounded-lg border border-border p-4">
                  <h3 className="text-base font-semibold">Excluded from Conversion</h3>
                  <div className="space-y-2">
                    {conversionPreview.excluded_items.map((item) => (
                      <div key={item.quote_item_id} className="rounded-md border border-border p-3">
                        <div className="font-medium text-foreground">{item.description}</div>
                        <div className="text-sm text-muted-foreground">{item.reason || 'Not converted'}</div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center justify-center py-10">
              <LoadingIndicator text="Loading conversion preview..." spinnerProps={{ size: 'sm' }} />
            </div>
          )}

          <DialogFooter>
            <Button id="quote-conversion-cancel" variant="outline" onClick={() => setIsConversionDialogOpen(false)} disabled={isWorking}>Cancel</Button>
            <Button id="quote-conversion-confirm" onClick={() => void handleConfirmConversion()} disabled={isWorking || !conversionPreview || (conversionMode === 'contract' && !conversionPreview.contract_items.length) || (conversionMode === 'invoice' && !conversionPreview.invoice_items.length) || (conversionMode === 'both' && (!conversionPreview.contract_items.length || !conversionPreview.invoice_items.length))}>
              {conversionMode === 'contract' ? 'Create Draft Contract' : conversionMode === 'invoice' ? 'Create Draft Invoice' : 'Create Both Records'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog id="quote-preview-dialog" isOpen={isPreviewOpen} onClose={() => setIsPreviewOpen(false)} title="Quote Preview" className="max-w-4xl">
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          {previewHtml ? (
            <div className="bg-white rounded border border-border p-4">
              <style dangerouslySetInnerHTML={{ __html: previewHtml.css }} />
              <div dangerouslySetInnerHTML={{ __html: previewHtml.html }} />
            </div>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading preview...</div>
          )}
          <DialogFooter>
            <Button id="quote-preview-close" variant="outline" onClick={() => setIsPreviewOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog id="quote-send-dialog" isOpen={isSendDialogOpen} onClose={() => setIsSendDialogOpen(false)} title="Send Quote to Client">
        <DialogContent>
          <DialogDescription>
            This will email the quote to the client&apos;s billing contacts and change its status to &ldquo;Sent&rdquo;.
          </DialogDescription>
          <div className="space-y-3 py-2">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Optional message to include in the email
              <TextArea
                value={sendMessage}
                onChange={(event) => setSendMessage(event.target.value)}
                rows={3}
                placeholder="Add a personal note for the client..."
              />
            </label>
          </div>
          <DialogFooter>
            <Button id="quote-send-cancel" variant="outline" onClick={() => setIsSendDialogOpen(false)} disabled={isWorking}>Cancel</Button>
            <Button id="quote-send-confirm" onClick={() => void handleSendQuote()} disabled={isWorking}>
              {isWorking ? 'Sending...' : 'Send Quote'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        id="quote-approval-dialog"
        isOpen={approvalDialogMode !== null}
        onClose={() => { setApprovalDialogMode(null); setApprovalComment(''); }}
        title={approvalDialogMode === 'approve' ? 'Approve Quote' : 'Request Changes'}
      >
        <DialogContent>
          <DialogDescription>
            {approvalDialogMode === 'approve'
              ? 'Approve this quote so it can be sent to the client. You may add an optional comment.'
              : 'Return this quote to draft with requested changes. Please describe what needs to be revised.'}
          </DialogDescription>
          <div className="space-y-3 py-2">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {approvalDialogMode === 'approve' ? 'Comment (optional)' : 'Requested changes'}
              <TextArea
                value={approvalComment}
                onChange={(event) => setApprovalComment(event.target.value)}
                rows={3}
                placeholder={approvalDialogMode === 'approve' ? 'Add an optional note...' : 'Describe the changes needed...'}
              />
            </label>
          </div>
          <DialogFooter>
            <Button
              id="quote-approval-cancel"
              variant="outline"
              onClick={() => { setApprovalDialogMode(null); setApprovalComment(''); }}
              disabled={isWorking}
            >
              Cancel
            </Button>
            <Button
              id="quote-approval-confirm"
              onClick={() => void (approvalDialogMode === 'approve' ? handleApproveQuote() : handleRequestChanges())}
              disabled={isWorking || (approvalDialogMode === 'changes' && !approvalComment.trim())}
            >
              {isWorking ? 'Processing...' : approvalDialogMode === 'approve' ? 'Approve' : 'Request Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default QuoteDetail;
