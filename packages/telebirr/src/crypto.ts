import crypto from 'node:crypto';

/**
 * Ensures an RSA public key string is properly wrapped in PEM header/footer format.
 */
export function formatPublicKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.includes('-----BEGIN PUBLIC KEY-----')) {
    return trimmed;
  }
  const cleanKey = trimmed.replace(/\r?\n|\r/g, '').replace(/\s+/g, '');
  const lines = cleanKey.match(/.{1,64}/g) || [cleanKey];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
}

/**
 * Ensures an RSA private key string is properly wrapped in PEM header/footer format.
 */
export function formatPrivateKey(key: string): string {
  const trimmed = key.trim();
  if (
    trimmed.includes('-----BEGIN PRIVATE KEY-----') ||
    trimmed.includes('-----BEGIN RSA PRIVATE KEY-----')
  ) {
    return trimmed;
  }
  const cleanKey = trimmed.replace(/\r?\n|\r/g, '').replace(/\s+/g, '');
  const lines = cleanKey.match(/.{1,64}/g) || [cleanKey];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`;
}

/**
 * Creates the Telebirr canonical string from parameters sorted alphabetically by ASCII key.
 * Excludes undefined, null, empty strings, and the 'sign' field itself.
 */
export function createCanonicalString(params: Record<string, unknown>): string {
  const sortedKeys = Object.keys(params)
    .filter((k) => k !== 'sign')
    .sort();

  const pairs: string[] = [];

  for (const key of sortedKeys) {
    const value = params[key];
    if (value !== undefined && value !== null && value !== '') {
      const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
      pairs.push(`${key}=${stringValue}`);
    }
  }

  return pairs.join('&');
}

/**
 * Signs payload string using SHA256withRSA and returns base64-encoded signature.
 */
export function signWithPrivateKey(data: string, privateKey: string): string {
  const formattedKey = formatPrivateKey(privateKey);
  const signer = crypto.createSign('SHA256');
  signer.update(data, 'utf8');
  signer.end();
  return signer.sign(formattedKey, 'base64');
}

/**
 * Verifies a base64-encoded signature using Telebirr RSA public key.
 */
export function verifyWithPublicKey(
  data: string,
  signature: string,
  publicKey: string
): boolean {
  try {
    const formattedKey = formatPublicKey(publicKey);
    const verifier = crypto.createVerify('SHA256');
    verifier.update(data, 'utf8');
    verifier.end();
    return verifier.verify(formattedKey, signature, 'base64');
  } catch {
    return false;
  }
}

/**
 * Encrypts data using RSA public key (supports segmented chunking for payloads longer than key block size).
 * Uses RSA_PKCS1_OAEP_PADDING for security compliance across all Node.js versions (CVE-2023-46809).
 */
export function encryptWithPublicKey(data: string, publicKey: string): string {
  const formattedKey = formatPublicKey(publicKey);
  const buffer = Buffer.from(data, 'utf8');
  // For 2048-bit RSA with OAEP padding, max chunk size is 214 bytes.
  // Using 64 bytes guarantees compatibility across both 1024-bit and 2048-bit keys.
  const maxChunkSize = 64;
  const chunks: Buffer[] = [];

  for (let i = 0; i < buffer.length; i += maxChunkSize) {
    const chunk = buffer.subarray(i, i + maxChunkSize);
    const encrypted = crypto.publicEncrypt(
      {
        key: formattedKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      },
      chunk
    );
    chunks.push(encrypted);
  }

  return Buffer.concat(chunks).toString('base64');
}

/**
 * Decrypts base64-encoded RSA ciphertext using private key.
 * Uses RSA_PKCS1_OAEP_PADDING for security compliance across all Node.js versions (CVE-2023-46809).
 */
export function decryptWithPrivateKey(ciphertext: string, privateKey: string): string {
  const formattedKey = formatPrivateKey(privateKey);
  const buffer = Buffer.from(ciphertext, 'base64');
  // Key block size for 1024-bit is 128 bytes, for 2048-bit is 256 bytes
  const keyDetails = crypto.createPrivateKey(formattedKey);
  const keySizeInBytes = (keyDetails.asymmetricKeyDetails?.modulusLength || 2048) / 8;

  const chunks: Buffer[] = [];

  for (let i = 0; i < buffer.length; i += keySizeInBytes) {
    const chunk = buffer.subarray(i, i + keySizeInBytes);
    const decrypted = crypto.privateDecrypt(
      {
        key: formattedKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      },
      chunk
    );
    chunks.push(decrypted);
  }

  return Buffer.concat(chunks).toString('utf8');
}
