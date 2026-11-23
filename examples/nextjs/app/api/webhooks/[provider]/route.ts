import { EthiopianPayments, handleWebWebhook } from '@ethio-pay/core';
import { ChapaAdapter } from '@ethio-pay/chapa';
import { TelebirrAdapter } from '@ethio-pay/telebirr';

// 1. Initialize Adapters
const chapa = new ChapaAdapter({
  secretKey: process.env.CHAPA_SECRET_KEY || 'CHASECK_TEST-12345',
  secretHash: process.env.CHAPA_SECRET_HASH || 'sandbox_secret_hash_123',
  baseUrl: process.env.CHAPA_BASE_URL,
});

const telebirr = new TelebirrAdapter({
  appId: process.env.TELEBIRR_APP_ID || 'TEST_APP_ID',
  appKey: process.env.TELEBIRR_APP_KEY || 'TEST_APP_KEY',
  shortCode: process.env.TELEBIRR_SHORT_CODE || '10001',
  publicKey: process.env.TELEBIRR_PUBLIC_KEY || '',
  privateKey: process.env.TELEBIRR_PRIVATE_KEY || '',
  baseUrl: process.env.TELEBIRR_BASE_URL,
});

// 2. Configure Unified SDK Client
const sdk = new EthiopianPayments({
  environment: (process.env.NODE_ENV === 'production' ? 'production' : 'sandbox') as any,
  providers: [chapa, telebirr],
});

/**
 * Next.js App Router Webhook Receiver Route.
 * Handles both Chapa and Telebirr webhooks dynamically via route parameter.
 * URL: /api/webhooks/[provider] (e.g. /api/webhooks/chapa, /api/webhooks/telebirr)
 */
export async function POST(
  request: Request,
  { params }: { params: { provider: string } }
): Promise<Response> {
  const provider = params.provider.toLowerCase();

  return handleWebWebhook(request, {
    sdk,
    provider,
    onSuccess: async (event) => {
      console.log(`[Next.js App] 🎉 Verified payment: ${event.reference} (${event.amount} ${event.currency})`);
      // Fulfill customer order in database
      // await db.orders.update({ where: { ref: event.reference }, data: { status: 'PAID' } });
    },
    onFailure: async (event) => {
      console.warn(`[Next.js App] ❌ Payment failed: ${event.reference}`);
      // await db.orders.update({ where: { ref: event.reference }, data: { status: 'FAILED' } });
    },
  });
}

