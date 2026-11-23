# Next.js App Router Reference (`@ethio-pay/example-nextjs`)

> Reference implementation showing how to receive and verify Ethio-Pay webhooks inside the **Next.js App Router** (`route.ts`) without Express.

---

## Webhook Route Handler

With `@ethio-pay/core`'s `handleWebWebhook()`, Next.js developers can verify and process webhooks with complete idempotency and error handling:

```typescript
// app/api/webhooks/[provider]/route.ts
import { EthiopianPayments, handleWebWebhook } from '@ethio-pay/core';
import { ChapaAdapter } from '@ethio-pay/chapa';
import { TelebirrAdapter } from '@ethio-pay/telebirr';

const sdk = new EthiopianPayments({
  providers: [
    new ChapaAdapter({ secretKey: process.env.CHAPA_SECRET_KEY! }),
    new TelebirrAdapter({
      appId: process.env.TELEBIRR_APP_ID!,
      appKey: process.env.TELEBIRR_APP_KEY!,
      shortCode: process.env.TELEBIRR_SHORT_CODE!,
      publicKey: process.env.TELEBIRR_PUBLIC_KEY!,
      privateKey: process.env.TELEBIRR_PRIVATE_KEY!,
    }),
  ],
});

export async function POST(
  request: Request,
  { params }: { params: { provider: string } }
) {
  return handleWebWebhook(request, {
    sdk,
    provider: params.provider,
    onSuccess: async (event) => {
      // Fulfill customer order
      console.log(`Order ${event.reference} successfully paid!`);
    },
  });
}
```

---

## Features

- **No Express Dependency**: Built for native Web Standard `Request` and `Response`.
- **Automatic Signature Verification**: HMAC-SHA256 for Chapa, RSA-SHA256 for Telebirr.
- **Built-in Replay Protection**: Automatic idempotency check on `tx_ref`, `outTradeNo`, and `tradeNo`.
- **Works on Edge & Node.js Runtimes**: Deployable to Vercel, Node, or Cloudflare.

