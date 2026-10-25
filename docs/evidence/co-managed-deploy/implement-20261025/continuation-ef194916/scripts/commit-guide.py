import pathlib,subprocess,sys,json
repo=pathlib.Path('/home/robert/alga-copies/feature-co-managed-it');base=repo/'docs/evidence/co-managed-deploy/implement-20261025'
# Validate every public text artifact against private credential values.
priv=pathlib.Path('/home/robert/card-review-private/co-managed-it-3363');secrets=[]
for p in priv.glob('*.json'):
 try:
  obj=json.loads(p.read_text())
  if isinstance(obj,dict):secrets += [v for k,v in obj.items() if k.lower() in ('password','secret','access_token','refresh_token') and isinstance(v,str) and len(v)>7]
 except:pass
for p in (base/'continuation-ef194916').rglob('*'):
 if p.is_file() and p.suffix not in ('.webm','.png'):
  s=p.read_text(errors='ignore');assert not any(x in s for x in secrets),str(p)
subprocess.run(['git','add',str(base)],cwd=repo,check=True)
ignored=[]
for p in (base/'continuation-ef194916').rglob('*'):
 if p.is_file() and p.suffix in ('.png','.webm'):ignored.append(str(p))
subprocess.run(['git','add','-f',*ignored],cwd=repo,check=True)
subprocess.run(['git','commit','-q','-m',sys.argv[1]],cwd=repo,check=True)
subprocess.run(['git','push','origin','feature/co-managed-it'],cwd=repo,check=True)
print(subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip())
