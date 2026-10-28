'use client';

import React, { useEffect, useState } from 'react';
import type { IDocument } from '@alga-psa/types';
import { getDocument, getDocumentThumbnailUrl } from '@alga-psa/documents/actions/documentActions';
import Documents from '@alga-psa/documents/components/Documents';

/** Resolve each photo independently; a denied or failed read leaves no visible content. */
function CustodyEventPhoto({ documentId }: { documentId: string }) {
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
      <button className="mr-2 mt-2" type="button" id={`custody-photo-${documentId}`} hidden={!loaded} onClick={() => setOpen(true)}>
        <img src={photo.url} alt={loaded ? photo.document.document_name : ''} className="h-16 w-16 rounded object-cover" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
      </button>
      {open ? <Documents id={`custody-photo-viewer-${documentId}`} documents={[]} userId="" readOnly drawerOnly documentToOpen={photo.document} onDocumentClosed={() => setOpen(false)} /> : null}
    </>
  );
}

export function CustodyEventPhotos({ documentIds }: { documentIds: string[] }) {
  return <>{documentIds.map(id => <CustodyEventPhoto key={id} documentId={id} />)}</>;
}
