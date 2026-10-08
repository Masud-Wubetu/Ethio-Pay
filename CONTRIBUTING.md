# Contributing to Ethio-Pay

Thank you for your interest in contributing to Ethio-Pay! We welcome contributions to support more Ethiopian payment providers, improve test coverage, and enhance developer tooling.

## Guide for Adding a New Payment Provider Adapter

To add a new provider adapter (e.g. Telebirr, CBE Birr, Coopay):

1. Create a package in `packages/<provider-name>` (e.g. `packages/telebirr`).
2. Implement the `PaymentProvider` interface from `@ethio-pay/core`:

```typescript
import type { PaymentProvider, InitializeRequest, PaymentSession, VerificationResult } from '@ethio-pay/core';

export class TelebirrAdapter implements PaymentProvider {
  readonly name = 'telebirr';

  async initialize(req: InitializeRequest): Promise<PaymentSession> {
    // Implementation
  }

  async verify(reference: string): Promise<VerificationResult> {
    // Implementation
  }
}
```

3. Add unit tests in `src/adapter.test.ts` matching the core provider test suite.
4. Export the adapter in `src/index.ts`.

## Development Setup

```bash
# Install dependencies
pnpm install

# Run build across monorepo
pnpm build

# Run unit and integration tests
pnpm test
```

## Pull Request Guidelines

- Ensure all Vitest unit tests pass (`pnpm test`).
- Ensure type checks pass (`pnpm --recursive run typecheck`).
- Write concise, clear commit messages.
