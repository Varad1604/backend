import { Buffer } from 'node:buffer';
/* global process, console */
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync, appendFileSync } from 'node:fs';
const target = process.argv[2] ?? '.env';
const text = readFileSync(target, 'utf8');
if (!/^DEMO_MODE=true\s*$/m.test(text)) throw new Error('This helper is restricted to explicit synthetic demo environments.');
const privateExists = /^JWT_PRIVATE_KEY_BASE64=.+$/m.test(text);
const publicExists = /^JWT_PUBLIC_KEY_BASE64=.+$/m.test(text);
if (privateExists !== publicExists) throw new Error('Refusing to overwrite an incomplete key pair.');
if (!privateExists) {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1', privateKeyEncoding: { format: 'pem', type: 'pkcs8' }, publicKeyEncoding: { format: 'pem', type: 'spki' } });
  appendFileSync(target, '\nJWT_PRIVATE_KEY_BASE64=' + Buffer.from(keys.privateKey).toString('base64') + '\nJWT_PUBLIC_KEY_BASE64=' + Buffer.from(keys.publicKey).toString('base64') + '\n');
}
console.log('Synthetic signing configuration is ready; key values were not printed.');
