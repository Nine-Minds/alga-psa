import { HandlerContext } from './types';

/**
 * Navigation handlers for SoftwareOne extension
 */

export function navigateToAgreements(event: MouseEvent, context: HandlerContext) {
  event.preventDefault();
  // Navigate to the correct extension URL format
  context.navigate('/msp/extensions/63a7a0dc-7836-4a5f-aa08-ecdb31b064b5/agreements');
}

export function navigateToStatements(event: MouseEvent, context: HandlerContext) {
  event.preventDefault();
  context.navigate('/msp/extensions/63a7a0dc-7836-4a5f-aa08-ecdb31b064b5/statements');
}

export function navigateToSettings(event: MouseEvent, context: HandlerContext) {
  event.preventDefault();
  context.navigate('/msp/extensions/63a7a0dc-7836-4a5f-aa08-ecdb31b064b5/settings');
}

export function navigateToAgreementDetail(event: MouseEvent, context: HandlerContext, params?: { agreementId: string }) {
  event.preventDefault();
  if (params?.agreementId) {
    context.navigate(`/msp/extensions/63a7a0dc-7836-4a5f-aa08-ecdb31b064b5/agreements/${params.agreementId}`);
  }
}

export function navigateToStatementDetail(event: MouseEvent, context: HandlerContext, params?: { statementId: string }) {
  event.preventDefault();
  if (params?.statementId) {
    context.navigate(`/msp/extensions/63a7a0dc-7836-4a5f-aa08-ecdb31b064b5/statements/${params.statementId}`);
  }
}