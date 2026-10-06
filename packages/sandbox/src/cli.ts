#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { SandboxServer } from './server.js';

const options = {
  target: { type: 'string', short: 't', default: 'http://localhost:3000/api/webhooks/chapa' },
  provider: { type: 'string', short: 'p', default: 'chapa' },
  port: { type: 'string', short: 'P', default: '4040' },
  secret: { type: 'string', short: 's', default: 'sandbox_secret_hash_123' },
  help: { type: 'boolean', short: 'h', default: false },
} as const;

try {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options,
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Ethio-Pay Webhook Simulator & Sandbox CLI v0.1.0

Usage:
  npx ethio-pay-sandbox --target <url> [options]

Options:
  --target, -t    Target webhook URL to deliver signed webhooks
  --provider, -p  Provider adapter to emulate (chapa, telebirr)
  --port, -P      Local port to run sandbox server on (default: 4040)
  --secret, -s    HMAC secret hash for webhook signing
  --help, -h      Display this help message
`);
    process.exit(0);
  }

  const port = Number(values.port) || 4040;
  const targetUrl = values.target || 'http://localhost:3000/api/webhooks/chapa';
  const provider = values.provider || 'chapa';
  const secretHash = values.secret || 'sandbox_secret_hash_123';

  const server = new SandboxServer({
    port,
    targetUrl,
    provider,
    secretHash,
  });

  server.app.listen(port, () => {
    console.log(`
┌───────────────────────────────────────────────────────────┐
│                                                           │
│   🚀  Ethio-Pay Local Webhook Simulator & Sandbox         │
│                                                           │
│   • Provider:   ${provider.toUpperCase().padEnd(38)}│
│   • Dashboard:  http://localhost:${String(port).padEnd(25)}│
│   • Target URL: ${targetUrl.padEnd(37)}│
│   • Secret:     ${secretHash.padEnd(38)}│
│                                                           │
└───────────────────────────────────────────────────────────┘
`);
  });
} catch (err: any) {
  console.error(`Error starting ethio-pay-sandbox CLI: ${err.message}`);
  process.exit(1);
}
