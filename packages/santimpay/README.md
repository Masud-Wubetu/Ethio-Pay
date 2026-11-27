# @ethio-pay/santimpay

Official SantimPay payment provider adapter for [Ethio-Pay](https://github.com/Masud-Wubetu/Ethio-Pay).

## Installation

```bash
npm install @ethio-pay/core @ethio-pay/santimpay
# or install the umbrella package
npm install ethio-pay
```

## Usage

```ts
import { EthiopianPayments } from '@ethio-pay/core';
import { SantimPayAdapter } from '@ethio-pay/santimpay';

const payments = new EthiopianPayments({
  providers: [
    new SantimPayAdapter({
      merchantId: process.env.SANTIMPAY_MERCHANT_ID!,
      authToken: process.env.SANTIMPAY_AUTH_TOKEN!,
      clientSecret: process.env.SANTIMPAY_CLIENT_SECRET,
    }),
  ],
});
```

