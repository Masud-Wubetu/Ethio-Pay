# Changelog

All notable changes to the Ethio-Pay monorepo are documented in this file.

## [1.0.0] - 2026-11-27

### Added
- **Multi-Rail Payment Support**: Full production adapters for Chapa, Telebirr (Fabric H5 / RSA-2048), CBE Birr, ArifPay, SantimPay, and Awash Birr.
- **Automated Zero-Downtime Failover**: `EthiopianPayments` supports `defaultFallbackProviders` and per-request `fallbackProviders` to automatically cascade checkouts on provider 5xx/network outages.
- **Unified SMS & OTP Engine (`@ethio-pay/sms`)**: Cascading SMS delivery across AfroMessage, GeeZ SMS, and Ethio Telecom, plus single-use constant-time OTP generation and verification.
- **Refunds & Webhooks**: `ChapaAdapter.refund()`, framework-agnostic Web Request/Response webhook handler (`handleWebWebhook`) with Next.js App Router example, and `RedisIdempotencyStore` for horizontally-scaled deployments.
- **Offline Multi-Rail Sandbox (`@ethio-pay/sandbox`)**: Local mock endpoints for all 6 payment providers and 3 SMS gateways, hosted checkout UI, webhook inspector, replay tool, and security attack lab.
- **Single-Command Demo & Verification**: Added `pnpm run demo` and `pnpm run test:manual`.

