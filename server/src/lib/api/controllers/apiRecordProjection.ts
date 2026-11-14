/**
 * REST name for the shared record projection. The projection itself lives in `@alga-psa/authorization` so the
 * MSP server actions hide the same fields these controllers do.
 */
export {
  areRecordFieldsVisible as areApiRecordFieldsVisible,
  isRecordFieldHidden as isApiRecordFieldHidden,
  projectRecord as projectApiRecord,
} from '@alga-psa/authorization/recordProjection';
