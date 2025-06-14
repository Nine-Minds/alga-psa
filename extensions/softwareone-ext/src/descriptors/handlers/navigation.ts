import { HandlerContext } from './types';

/**
 * Navigation handlers for SoftwareOne extension
 */

export function navigateToAgreements(event: MouseEvent, context: HandlerContext) {
  event.preventDefault();
  context.navigate('/softwareone/agreements');
}

export function navigateToStatements(event: MouseEvent, context: HandlerContext) {
  event.preventDefault();
  context.navigate('/softwareone/statements');
}

export function navigateToSettings(event: MouseEvent, context: HandlerContext) {
  event.preventDefault();
  context.navigate('/settings/softwareone');
}

export function navigateToAgreementDetail(event: MouseEvent, context: HandlerContext, params?: { agreementId: string }) {
  event.preventDefault();
  if (params?.agreementId) {
    context.navigate(`/softwareone/agreement/${params.agreementId}`);
  }
}

export function navigateToStatementDetail(event: MouseEvent, context: HandlerContext, params?: { statementId: string }) {
  event.preventDefault();
  if (params?.statementId) {
    context.navigate(`/softwareone/statement/${params.statementId}`);
  }
}