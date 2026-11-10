import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export function createSecretStore(filename, { memory = false } = {}) {
  let key;
  if (memory) key = randomBytes(32);
  else {
    mkdirSync(dirname(filename), { recursive: true });
    if (existsSync(filename)) key = readFileSync(filename);
    else {
      key = randomBytes(32);
      writeFileSync(filename, key, { mode: 0o600 });
    }
  }
  if (key.length !== 32) throw Error('Secret encryption key unavailable');
  return {
    encrypt(value) {
      if (!value) return null;
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(
        '.'
      );
    },
    decrypt(value) {
      if (!value) return '';
      const [iv, tag, data] = value.split('.');
      const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      cipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([cipher.update(Buffer.from(data, 'base64')), cipher.final()]).toString('utf8');
    }
  };
}
export function safeProvider(p) {
  const { secret, apiKey, key, ...safe } = p;
  return {
    ...safe,
    configured: !!secret,
    keyConfigured: !!secret,
    keyMasked: secret ? '••••••••' : null,
    connectionStatus: !p.enabled ? 'disabled' : secret ? 'configured-not-verified' : 'unconfigured'
  };
}
