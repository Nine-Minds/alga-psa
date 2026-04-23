import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve(__dirname, 'quoteActions.ts'), 'utf8');

describe('quote action authorization parity contracts', () => {
  it('uses shared quote-read authorization helpers across read and mutation surfaces', () => {
    expect(source).toContain('async function authorizeQuoteReadDecision(');
    expect(source).toContain('async function getAuthorizedQuoteForRead(');
    expect(source).toContain('async function assertQuoteReadAllowedForMutation(');

    expect(source).toContain('export const updateQuote = withAuth(async (');
    expect(source).toContain("'Permission denied: Cannot update quote'");
    expect(source).toContain('export const deleteQuote = withAuth(async (');
    expect(source).toContain("'Permission denied: Cannot delete quote'");
    expect(source).toContain('export const submitQuoteForApproval = withAuth(async (');
    expect(source).toContain('export const requestQuoteApprovalChanges = withAuth(async (');
    expect(source).toContain('export const sendQuote = withAuth(async (');
    expect(source).toContain('export const resendQuote = withAuth(async (');
    expect(source).toContain('export const sendQuoteReminder = withAuth(async (');
    expect(source).toContain('export const createQuoteRevision = withAuth(async (');
    expect(source).toContain('export const convertQuoteToContract = withAuth(async (');
    expect(source).toContain('export const convertQuoteToInvoice = withAuth(async (');
    expect(source).toContain('export const convertQuoteToBoth = withAuth(async (');
  });

  it('hardens quote-item operations with parent-quote authorization and ownership integrity checks', () => {
    expect(source).toContain('export const addQuoteItem = withAuth(async (');
    expect(source).toContain('parsedInput.quote_id');
    expect(source).toContain('export const updateQuoteItem = withAuth(async (');
    expect(source).toContain("Quote item updates cannot move items across quotes.");
    expect(source).toContain('export const removeQuoteItem = withAuth(async (');
    expect(source).toContain('export const reorderQuoteItems = withAuth(async (');
  });

  it('keeps quote list totals authorization-aware and applies read checks to preview/pdf/converted-record helpers', () => {
    expect(source).toContain('buildAuthorizationAwarePage<IQuoteListItem>({');
    expect(source).toContain('total: authorizedPage.total');
    expect(source).toContain('totalPages: Math.ceil(authorizedPage.total / pageSize) || 1');

    expect(source).toContain('export const getQuoteConversionPreview = withAuth(async (');
    expect(source).toContain('export const getQuoteByConvertedContractId = withAuth(async (');
    expect(source).toContain('export const getQuoteByConvertedInvoiceId = withAuth(async (');
    expect(source).toContain('export const getQuotePdfFileId = withAuth(async (');
    expect(source).toContain('export const downloadQuotePdf = withAuth(async (');
    expect(source).toContain('export const renderQuotePreview = withAuth(async (');
  });
});
