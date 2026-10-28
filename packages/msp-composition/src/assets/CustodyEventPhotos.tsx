'use client';

import React, { useEffect, useState } from 'react';
import type { IDocument } from '@alga-psa/types';
import { getDocument, getDocumentThumbnailUrl } from '@alga-psa/documents/actions/documentActions';
import Documents from '@alga-psa/documents/components/Documents';

/** Resolve each photo independently; a denied or failed read leaves no visible content. */
function CustodyEventPhoto({ documentId, id }: { documentId: string; id: string }) {
  const [photo, setPhoto] = useState<{ document: IDocument; url: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true;
    setPhoto(null);
    setLoaded(false);
    setFailed(false);
    void Promise.all([getDocument(documentId), getDocumentThumbnailUrl(documentId)]).then(([document, url]) => {
      if (active && document && 'document_id' in document && typeof url === 'string') setPhoto({ document, url });
    }).catch(() => {});
    return () => { active = false; };
  }, [documentId]);
  if (!photo || failed) return null;
  return (
    <>
      <button className="mr-2 mt-2" type="button" id={id} hidden={!loaded} onClick={() => setOpen(true)}>
        <img src={photo.url} alt={loaded ? photo.document.document_name : ''} className="h-16 w-16 rounded object-cover" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
      </button>
      {open ? <Documents id={`${id}-viewer`} documents={[]} userId="" readOnly drawerOnly documentToOpen={photo.document} onDocumentClosed={() => setOpen(false)} /> : null}
    </>
  );
}

export function CustodyEventPhotos({ documentIds, id = 'custody-photos' }: { documentIds: string[]; id?: string }) {
  return <>{documentIds.map(documentId => <CustodyEventPhoto key={documentId} id={`${id}-${documentId}`} documentId={documentId} />)}</>;
}
