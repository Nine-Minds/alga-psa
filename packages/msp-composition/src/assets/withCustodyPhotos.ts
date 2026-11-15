import type { Knex } from 'knex';
import { hasPermission } from '@alga-psa/auth';
import type { IUser, IDocumentAssociationInput } from '@alga-psa/types';
import { withPrivateDocumentUploads } from '@alga-psa/documents/lib/withPrivateDocumentUploads';
import { CustodyError } from '@alga-psa/assets/lib/custody/errors';
import { custodyPhotosWithinLimit } from '@alga-psa/assets/lib/custody/photoLimits';

/** Shared upload/commit boundary for intake and later custody steps. Targets are authorized by callers. */
export async function withCustodyPhotos<T>(
  knex: Knex,
  tenant: string,
  user: IUser,
  photos: FormData | undefined,
  targets: Array<Pick<IDocumentAssociationInput, 'entity_id' | 'entity_type'>>,
  run: (trx: Knex.Transaction, documentIds: string[]) => Promise<T>
): Promise<T> {
  const entries = photos?.getAll('photos') ?? [];
  const files = entries.filter((file): file is File => typeof file !== 'string');
  if (
    entries.length !== files.length ||
    files.some((file) => !file.type.startsWith('image/')) ||
    !custodyPhotosWithinLimit(files)
  ) {
    throw new CustodyError('permission_denied', 'Choose up to 20 image files totalling no more than 10 MB.');
  }
  if (!files.length) return knex.transaction((trx) => run(trx, []));
  if (
    user.user_type === 'client' ||
    !(await hasPermission(user, 'document', 'create')) ||
    !(await hasPermission(user, 'document', 'read'))
  ) {
    throw new CustodyError('permission_denied', 'Permission denied: Cannot upload custody photos.');
  }
  return withPrivateDocumentUploads(knex, tenant, user, files, targets, (trx, documents) =>
    run(
      trx,
      documents.map((document) => document.document_id)
    )
  );
}
