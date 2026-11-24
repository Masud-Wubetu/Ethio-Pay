#!/usr/bin/env node
import { SandboxServer } from '../packages/sandbox/dist/index.js';

const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

process.env.PORT = '3000';
process.env.SANDBOX_URL = 'http://localhost:4040';

console.log(`\n${CYAN}Starting Ethio-Pay Multi-Rail Sandbox (port 4040)...${RESET}`);

const sandbox = new SandboxServer({
  port: 4040,
  provider: 'chapa',
  targetUrl: 'http://localhost:3000/api/webhooks/chapa',
});

const sandboxHttpServer = sandbox.app.listen(4040, async () => {
  console.log(`${GREEN}✔${RESET} Sandbox server listening at http://localhost:4040`);

  // Start Express demo storefront on port 3000
  const { syncSandboxTelebirrPublicKey } = await import('../examples/express/dist/server.js');
  await syncSandboxTelebirrPublicKey('http://localhost:4040');

  console.log(`
${CYAN}┌───────────────────────────────────────────────────────────┐${RESET}
${CYAN}│                                                           │${RESET}
${CYAN}│   🚀  ${BOLD}Ethio-Pay Multi-Provider Demo Store Active!${RESET}${CYAN}         │${RESET}
${CYAN}│                                                           │${RESET}
${CYAN}│   • Demo Storefront:   ${BOLD}${GREEN}http://localhost:3000${RESET}${CYAN}              │${RESET}
${CYAN}│   • Sandbox Gateway:   http://localhost:4040              │${RESET}
${CYAN}│   • Webhook Inspector: http://localhost:4040              │${RESET}
${CYAN}│                                                           │${RESET}
${CYAN}│   👉 Open ${BOLD}${GREEN}http://localhost:3000${RESET}${CYAN} in your browser to test!  │${RESET}
${CYAN}│                                                           │${RESET}
${CYAN}└───────────────────────────────────────────────────────────┘${RESET}
`);
});

process.on('SIGINT', () => {
  console.log('\nStopping servers...');
  sandboxHttpServer.close();
  process.exit(0);
});

