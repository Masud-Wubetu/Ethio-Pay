# @ethio-pay/awashbirr

Official Awash Birr payment provider adapter for [Ethio-Pay](https://github.com/Masud-Wubetu/Ethio-Pay).

## Installation

```bash
npm install @ethio-pay/core @ethio-pay/awashbirr
# or install the umbrella package
npm install ethio-pay
```

## Usage

```ts
import { EthiopianPayments } from '@ethio-pay/core';
import { AwashBirrAdapter } from '@ethio-pay/awashbirr';

const payments = new EthiopianPayments({
  providers: [
    new AwashBirrAdapter({
      merchantId: process.env.AWASHBIRR_MERCHANT_ID!,
      passKey: process.env.AWASHBIRR_PASS_KEY!,
      secretHash: process.env.AWASHBIRR_SECRET_HASH,
    }),
  ],
});
```

