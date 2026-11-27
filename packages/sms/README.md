# @ethio-pay/sms

Unified Ethiopian SMS & OTP engine with automatic cascading failover across AfroMessage, GeeZ SMS, and Ethio Telecom.

## Installation

```bash
npm install @ethio-pay/sms
# or install the umbrella package
npm install ethio-pay
```

## Usage

```ts
import {
  EthiopianSms,
  AfroMessageAdapter,
  GeezSmsAdapter,
  EthioTelecomSmsAdapter,
} from '@ethio-pay/sms';

const sms = new EthiopianSms({
  providers: [
    new AfroMessageAdapter({ token: process.env.AFROMESSAGE_TOKEN!, senderId: 'EthioPay' }),
    new GeezSmsAdapter({ token: process.env.GEEZSMS_TOKEN! }),
    new EthioTelecomSmsAdapter({
      username: process.env.ETHIOTELECOM_SMS_USER!,
      password: process.env.ETHIOTELECOM_SMS_PASS!,
    }),
  ],
});

await sms.sendOtp('0911234567', { length: 6, ttlSeconds: 300 });
```

