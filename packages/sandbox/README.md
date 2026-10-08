# `@ethio-pay/sandbox`

> Local Webhook Simulator CLI (`ethio-pay-sandbox`) and mock payment server for Ethio-Pay SDK.

## Installation

```bash
npm install -g @ethio-pay/sandbox
# or use via npx
npx ethio-pay-sandbox --target http://localhost:3000/api/webhooks/chapa
```

## Features

- **Local Mock Checkout Dashboard**: Runs on `http://127.0.0.1:4040`.
- **Signed HMAC Webhooks**: Sends valid or tampered HMAC-SHA256 signatures to test security logic.
- **Edge-Case Failure Testing**: Simulate Payment Success, Failure, Session Expiry, Network Delays, and Duplicate Replays.

## Options

| Option | Flag | Description | Default |
|---|---|---|---|
| `--target` | `-t` | Target webhook URL | `http://localhost:3000/api/webhooks/chapa` |
| `--provider` | `-p` | Provider adapter to emulate | `chapa` |
| `--port` | `-P` | Local server port | `4040` |
| `--secret` | `-s` | Secret hash for HMAC signing | `sandbox_secret_hash_123` |

## Disclaimer

*Unofficial community tool for local development & testing.*
