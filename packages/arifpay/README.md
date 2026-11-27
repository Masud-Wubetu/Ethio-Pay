# @ethio-pay/arifpay

Official ArifPay payment provider adapter for [Ethio-Pay](https://github.com/Masud-Wubetu/Ethio-Pay).

## Installation

```bash
npm install @ethio-pay/core @ethio-pay/arifpay
# or install the umbrella package
npm install ethio-pay
```

## Usage

```ts
import { EthiopianPayments } from '@ethio-pay/core';
import { ArifPayAdapter } from '@ethio-pay/arifpay';

const payments = new EthiopianPayments({
  providers: [
    new ArifPayAdapter({
      apiKey: process.env.ARIFPAY_API_KEY!,
      secretKey: process.env.ARIFPAY_SECRET_KEY,
    }),
  ],
});
```

