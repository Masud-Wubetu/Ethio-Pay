# `@ethio-pay/chapa`

> Chapa payment provider adapter implementation for `@ethio-pay/core`.

## Installation

```bash
npm install @ethio-pay/core @ethio-pay/chapa
```

## Quickstart

```typescript
import { EthiopianPayments } from '@ethio-pay/core';
import { ChapaAdapter } from '@ethio-pay/chapa';

const chapa = new ChapaAdapter({
  secretKey: process.env.CHAPA_SECRET_KEY!,
  secretHash: process.env.CHAPA_SECRET_HASH!,
});

const sdk = new EthiopianPayments({
  providers: [chapa],
});
```

## Features

- Full mapping for Chapa API initialize & verify endpoints.
- Automatic HMAC-SHA256 `x-chapa-signature` verification & payload parsing.

## Disclaimer

*Unofficial community package. Not affiliated with Chapa Financial Technologies.*
