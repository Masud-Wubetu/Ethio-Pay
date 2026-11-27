# @ethio-pay/cbebirr

Official Commercial Bank of Ethiopia (CBE Birr) payment provider adapter for [Ethio-Pay](https://github.com/Masud-Wubetu/Ethio-Pay).

## Installation

```bash
npm install @ethio-pay/core @ethio-pay/cbebirr
# or install the umbrella package
npm install ethio-pay
```

## Usage

```ts
import { EthiopianPayments } from '@ethio-pay/core';
import { CbeBirrAdapter } from '@ethio-pay/cbebirr';

const payments = new EthiopianPayments({
  providers: [
    new CbeBirrAdapter({
      tillCode: process.env.CBEBIRR_TILL_CODE!,
      apiKey: process.env.CBEBIRR_API_KEY!,
      secretHash: process.env.CBEBIRR_SECRET_HASH,
    }),
  ],
});
```

