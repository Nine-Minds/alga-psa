import pathlib,json,re
private=pathlib.Path('/home/robert/card-review-private/co-managed-it-3363/pre-consolidation-evidence-refs.json')
refs=json.loads(private.read_text())['supersededEvidenceCommits']
tokens=set()
for sha in refs:
 for length in (40,12,10,8,7):tokens.add(sha[:length])
pattern=re.compile(r'(?<![A-Za-z0-9])(?:'+ '|'.join(sorted(tokens,key=len,reverse=True))+r')(?![A-Za-z0-9])',re.I)
roots=[pathlib.Path('docs/evidence/co-managed-deploy/implement-20261025'),pathlib.Path('/home/robert/card-reviews/co-managed-it-3363')]
changed=[]
for root in roots:
 for p in root.rglob('*'):
  if not p.is_file() or p.suffix.lower() in ('.png','.webm','.jpg','.jpeg','.gif','.pdf','.zip','.gz','.mp4'):continue
  try:s=p.read_text()
  except (UnicodeError,OSError):continue
  if not pattern.search(s):continue
  s=re.sub(r'(/(?:blob|tree)/)('+ '|'.join(sorted(tokens,key=len,reverse=True))+r')(?=/)',r'\1feature/co-managed-it',s)
  s=pattern.sub('HEAD',s);p.write_text(s);changed.append(str(p))
remaining=[]
for root in roots:
 for p in root.rglob('*'):
  if not p.is_file() or p.suffix.lower() in ('.png','.webm','.jpg','.jpeg','.gif','.pdf','.zip','.gz','.mp4'):continue
  try:s=p.read_text()
  except (UnicodeError,OSError):continue
  if pattern.search(s):remaining.append(str(p))
assert not remaining,remaining
print('Normalized superseded evidence-only identifiers in',len(changed),'text artifacts; no remaining text references.')
