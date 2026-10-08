# Security Policy

## Reporting Security Vulnerabilities

If you discover a security vulnerability within **Ethio-Pay**, please report it responsibly instead of opening a public issue.

- **Security Contact**: Email us directly at `security@ethio-pay.org` (or open a confidential disclosure report on GitHub).
- **Response Time**: We aim to acknowledge receipt of security reports within **24-48 hours** and provide a patch timeline within 5 business days.

## Local Sandbox Security Guidelines

1. **Test Keys Only**: Never use live production API keys or merchant secret hashes with `ethio-pay-sandbox`.
2. **Local Host Binding**: The local webhook simulator binds to `127.0.0.1` by default to prevent exposure on local area networks (LAN).
3. **Secret Redaction**: API keys and HMAC signatures in local server console outputs are truncated or redacted.

## Constant-Time HMAC Verification

The `@ethio-pay/core` SDK enforces constant-time buffer comparison (`crypto.timingSafeEqual`) on all incoming webhook signatures to prevent timing side-channel attacks.
