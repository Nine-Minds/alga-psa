#!/usr/bin/env node
import { AmpSqliteReader, validateAmpPackage } from '@alga-psa/migration-sdk';
const [command, file] = process.argv.slice(2); if (!file || !['validate','inspect','csv','package'].includes(command ?? '')) { console.error('Usage: alga-migrate validate|inspect|csv|package <file>'); process.exit(64); }
const result=validateAmpPackage(file); if(command==='inspect') { const reader=new AmpSqliteReader(file); console.log(JSON.stringify({manifest:reader.manifest(),tables:reader.tables()},null,2)); reader.close(); } else console.log(JSON.stringify(result,null,2)); process.exit(result.valid ? 0 : 2);
