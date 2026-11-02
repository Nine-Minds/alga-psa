import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { readFileSync } from 'node:fs';
const secret = readFileSync(process.argv[2], 'utf8').trim();
const salt = randomBytes(12).toString('hex');
console.log(`${salt}:${pbkdf2Sync(process.argv[3], secret + salt, 10000, 64, 'sha512').toString('hex')}`);
