# `@ethio-pay/core`

> Core interfaces, provider contracts, resilient HTTP client, HMAC signature verification, and idempotency middleware for Ethio-Pay SDK.

## Installation

```bash
npm install @ethio-pay/core
```

## Features

- **Unified Provider Interface**: Standard `PaymentProvider` interface across all Ethiopian payment gateways.
- **HMAC Signature Verification**: Constant-time `crypto.timingSafeEqual` signature checks preventing timing attacks.
- **Idempotency Guard**: Built-in middleware to stop duplicate webhook deliveries.
- **Resilient HTTP Client**: Built-in retry logic with exponential backoff for provider API calls.

## Quickstart

```typescript
import { EthiopianPayments } from '@ethio-pay/core';

// Initialize client with provider adapters
const sdk = new EthiopianPayments({
  providers: [/* provider adapters */],
});
```

## Disclaimer

*Unofficial community package. Not affiliated with Chapa, Telebirr, CBE Birr, or any bank.*
