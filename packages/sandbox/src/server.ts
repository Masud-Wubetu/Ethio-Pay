import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import { createHmac } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import type { Status } from '@ethio-pay/core';


export interface TransactionRecord {
  reference: string;
  amount: number;
  currency: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  callbackUrl?: string;
  returnUrl?: string;
  status: Status;
  provider: string;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookLogRecord {
  id: string;
  reference: string;
  targetUrl: string;
  status: Status;
  payload: unknown;
  headers: Record<string, string>;
  responseStatus?: number;
  responseBody?: string;
  executionTimeMs?: number;
  timestamp: string;
}

export interface SandboxServerOptions {
  port?: number;
  targetUrl?: string;
  provider?: string;
  secretHash?: string;
}

/**
 * Professional Local Webhook Simulator & Mock Payment Provider Server.
 * Provides realistic Chapa & Telebirr checkout interfaces and an isolated Developer Dashboard.
 */
export class SandboxServer {
  public app: Express;
  public port: number;
  public targetUrl: string;
  public provider: string;
  public secretHash: string;
  public transactions = new Map<string, TransactionRecord>();
  public webhookLogs: WebhookLogRecord[] = [];

  constructor(options: SandboxServerOptions = {}) {
    this.port = options.port ?? 4040;
    this.targetUrl = options.targetUrl ?? 'http://localhost:3000/api/webhooks/chapa';
    this.provider = options.provider ?? 'chapa';
    this.secretHash = options.secretHash ?? 'sandbox_secret_hash_123';

    this.app = express();
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    this.setupRoutes();
  }

  public async sendWebhook(
    reference: string,
    targetStatus: Status,
    options: { tamperSignature?: boolean; delayMs?: number; targetUrl?: string } = {}
  ): Promise<WebhookLogRecord> {
    const startTime = Date.now();
    const tx = this.transactions.get(reference);
    if (tx) {
      tx.status = targetStatus;
      tx.updatedAt = new Date().toISOString();
    }

    const destination = options.targetUrl || tx?.callbackUrl || this.targetUrl;

    const rawStatus =
      targetStatus === 'SUCCEEDED' ? 'success' : targetStatus === 'FAILED' ? 'failed' : 'expired';

    const payload = {
      event: targetStatus === 'SUCCEEDED' ? 'charge.success' : 'charge.failed',
      tx_ref: reference,
      amount: tx?.amount || 100,
      currency: tx?.currency || 'ETB',
      status: rawStatus,
      email: tx?.email || 'customer@example.com',
      first_name: tx?.firstName || 'Abebe',
      last_name: tx?.lastName || 'Bikila',
      created_at: new Date().toISOString(),
    };

    const rawBody = JSON.stringify(payload);
    let signature = createHmac('sha256', this.secretHash).update(rawBody).digest('hex');

    if (options.tamperSignature) {
      signature = 'tampered_forged_invalid_signature_hash_123';
    }

    if (options.delayMs && options.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-chapa-signature': signature,
    };

    let responseStatus = 0;
    let responseBody = '';

    try {
      const res = await fetch(destination, {
        method: 'POST',
        headers,
        body: rawBody,
      });
      responseStatus = res.status;
      responseBody = await res.text();
    } catch (err: any) {
      responseStatus = 500;
      responseBody = err.message || 'Webhook dispatch network failure';
    }

    const executionTimeMs = Date.now() - startTime;

    const logRecord: WebhookLogRecord = {
      id: `wh_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      reference,
      targetUrl: destination,
      status: targetStatus,
      payload,
      headers,
      responseStatus,
      responseBody,
      executionTimeMs,
      timestamp: new Date().toISOString(),
    };

    this.webhookLogs.unshift(logRecord);
    return logRecord;
  }

  private setupRoutes() {
    // Security check against live API keys (SBX-11)
    this.app.use((req: Request, res: Response, next) => {
      const auth = req.headers.authorization;
      if (auth && auth.startsWith('Bearer ')) {
        const token = auth.replace('Bearer ', '').trim();
        if (token.includes('_LIVE_') || token.startsWith('CHASECK_LIVE')) {
          return res.status(403).json({
            status: 'failed',
            message: 'SECURITY RISK: Live API key detected in Sandbox environment!',
          });
        }
      }
      next();
    });

    // Emulate Chapa initialize endpoint (SBX-3)
    this.app.post('/v1/transaction/initialize', (req: Request, res: Response) => {
      const {
        tx_ref,
        amount,
        currency,
        email,
        first_name,
        last_name,
        phone_number,
        callback_url,
        return_url,
      } = req.body;

      if (!tx_ref) {
        return res.status(400).json({ status: 'failed', message: 'tx_ref is required' });
      }

      const tx: TransactionRecord = {
        reference: tx_ref,
        amount: Number(amount) || 0,
        currency: currency || 'ETB',
        email,
        firstName: first_name,
        lastName: last_name,
        phone: phone_number,
        callbackUrl: callback_url || this.targetUrl,
        returnUrl: return_url,
        status: 'PENDING',
        provider: this.provider,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      this.transactions.set(tx_ref, tx);

      const checkoutUrl = `http://localhost:${this.port}/checkout/${encodeURIComponent(tx_ref)}`;

      return res.json({
        status: 'success',
        message: 'Sandbox transaction initialized',
        data: {
          checkout_url: checkoutUrl,
        },
      });
    });

    // Emulate Chapa verify endpoint (SBX-3)
    this.app.get('/v1/transaction/verify/:ref', (req: Request, res: Response) => {
      const ref = req.params.ref;
      const tx = this.transactions.get(ref);

      if (!tx) {
        return res.status(404).json({
          status: 'failed',
          message: `Transaction reference '${ref}' not found in sandbox`,
        });
      }

      const statusString =
        tx.status === 'SUCCEEDED' ? 'success' : tx.status === 'FAILED' ? 'failed' : 'pending';

      return res.json({
        status: 'success',
        message: 'Payment details',
        data: {
          status: statusString,
          amount: tx.amount,
          currency: tx.currency,
          tx_ref: tx.reference,
          reference: tx.reference,
          created_at: tx.createdAt,
          updated_at: tx.updatedAt,
        },
      });
    });

    // ------------------------------------------------------------------------
    // 1. REALISTIC CUSTOMER-FACING CHECKOUT UI (/checkout/:ref)
    // ------------------------------------------------------------------------
    this.app.get('/checkout/:ref', (req: Request, res: Response) => {
      const ref = req.params.ref;
      const tx = this.transactions.get(ref);

      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pay with ${this.provider.toUpperCase()} (Test Mode)</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      background: #0b0f19;
      color: #f8fafc;
      min-height: 100vh;
      margin: 0;
      display: flex;
      flex-direction: column;
    }
    .test-banner {
      background: #f59e0b;
      color: #000;
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      text-align: center;
      padding: 8px 16px;
    }
    .checkout-wrapper {
      flex: 1;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 24px;
    }
    .card {
      background: #151d30;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 24px;
      padding: 32px;
      width: 100%;
      max-width: 460px;
      box-shadow: 0 30px 60px -12px rgba(0, 0, 0, 0.6);
    }
    .brand-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
    }
    .brand-name { font-size: 22px; font-weight: 800; color: #38bdf8; letter-spacing: -0.02em; }
    .amount-box { text-align: center; background: rgba(10, 16, 28, 0.6); border-radius: 16px; padding: 20px; margin-bottom: 24px; border: 1px solid rgba(255, 255, 255, 0.05); }
    .amount-val { font-size: 38px; font-weight: 800; color: #ffffff; }
    .amount-cur { font-size: 16px; color: #38bdf8; font-weight: 700; margin-left: 4px; }
    .ref-code { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #94a3b8; margin-top: 6px; }

    .form-group { margin-bottom: 16px; }
    .form-label { display: block; font-size: 13px; font-weight: 600; color: #cbd5e1; margin-bottom: 6px; }
    .form-input {
      width: 100%;
      padding: 12px 14px;
      background: #090d16;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 10px;
      color: white;
      font-size: 14px;
      font-family: inherit;
    }
    .form-input:focus { outline: none; border-color: #38bdf8; }

    .test-helper {
      font-size: 12px;
      color: #38bdf8;
      background: rgba(56, 189, 248, 0.1);
      border: 1px dashed rgba(56, 189, 248, 0.3);
      border-radius: 8px;
      padding: 8px 12px;
      margin-bottom: 20px;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .test-helper:hover { background: rgba(56, 189, 248, 0.2); }

    .btn-pay {
      width: 100%;
      padding: 16px;
      border: none;
      border-radius: 12px;
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: white;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 6px 20px rgba(16, 185, 129, 0.3);
      transition: all 0.2s;
    }
    .btn-pay:hover { opacity: 0.95; transform: translateY(-1px); }
    .btn-cancel { width: 100%; background: transparent; border: none; color: #94a3b8; padding: 12px; font-size: 13px; font-weight: 600; cursor: pointer; margin-top: 8px; }
    .btn-cancel:hover { color: white; }

    /* PIN Modal */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.8);
      backdrop-filter: blur(8px);
      display: none;
      justify-content: center;
      align-items: center;
      z-index: 100;
    }
    .modal-card {
      background: #1e293b;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 20px;
      padding: 32px;
      width: 100%;
      max-width: 380px;
      text-align: center;
    }
    .pin-input { font-size: 28px; letter-spacing: 12px; text-align: center; width: 180px; padding: 10px; background: #0f172a; border: 1px solid #38bdf8; border-radius: 10px; color: white; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="test-banner">⚠️ TEST MODE — Simulated Payment (No Real Money Charged)</div>

  <div class="checkout-wrapper">
    <div class="card">
      <div class="brand-row">
        <span class="brand-name">${this.provider.toUpperCase()} CHECKOUT</span>
        <span style="font-size: 12px; color: #94a3b8;">Hosted Gateway</span>
      </div>

      ${
        tx
          ? `
        <div class="amount-box">
          <div><span class="amount-val">${tx.amount.toLocaleString()}</span><span class="amount-cur">${tx.currency}</span></div>
          <div class="ref-code">Ref: ${tx.reference}</div>
        </div>

        <div class="test-helper" onclick="autofillTest()">
          <span>💡 Autofill Test Telebirr Credentials</span>
          <strong>0911000000</strong>
        </div>

        <div class="form-group">
          <label class="form-label">Phone Number / Account Email</label>
          <input type="text" id="account" class="form-input" value="${tx.phone || tx.email || '0911234567'}">
        </div>

        <button class="btn-pay" onclick="openPinModal()">Pay ${tx.amount} ${tx.currency}</button>
        <button class="btn-cancel" onclick="cancelPayment()">Cancel and Return to Store</button>
      `
          : `<div style="color: #fb7185; text-align: center;">Transaction reference '${ref}' not found</div>`
      }
    </div>
  </div>

  <div class="modal-overlay" id="pin-modal">
    <div class="modal-card">
      <h3 style="margin-top:0;">Enter Test PIN / OTP</h3>
      <p style="font-size: 13px; color: #94a3b8;">Enter <strong>123456</strong> to complete test authorization</p>
      <input type="password" id="pin" class="pin-input" maxlength="6" value="123456">
      <br>
      <button class="btn-pay" onclick="confirmPayment()">Confirm Payment</button>
    </div>
  </div>

  <script>
    function autofillTest() {
      document.getElementById('account').value = '0911000000';
    }
    function openPinModal() {
      document.getElementById('pin-modal').style.display = 'flex';
    }
    async function confirmPayment() {
      const pinModal = document.getElementById('pin-modal');
      pinModal.innerHTML = '<div class="modal-card"><h3 style="color: #38bdf8;">Processing Payment...</h3><p>Dispatching signed webhook...</p></div>';

      try {
        const res = await fetch('/api/trigger-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reference: '${ref}', status: 'SUCCEEDED' })
        });
        if (res.ok) {
          pinModal.innerHTML = '<div class="modal-card"><h3 style="color: #34d399;">✓ Payment Authorized!</h3><p>Redirecting back to store...</p></div>';
          if ('${tx?.returnUrl || ''}') {
            setTimeout(() => window.location.href = '${tx?.returnUrl}', 1200);
          }
        }
      } catch (err) {
        alert('Payment processing error');
      }
    }
    async function cancelPayment() {
      await fetch('/api/trigger-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: '${ref}', status: 'FAILED' })
      });
      if ('${tx?.returnUrl || ''}') {
        window.location.href = '${tx?.returnUrl}';
      }
    }
  </script>
</body>
</html>
      `;
      return res.send(html);
    });

    // ------------------------------------------------------------------------
    // 2. ISOLATED DEVELOPER SIMULATOR DASHBOARD (http://localhost:4040/)
    // Serve Next.js static build if available, or fall back to inline HTML
    // ------------------------------------------------------------------------
    const currentDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
    const dashboardOutDir = path.resolve(currentDir, '../../dashboard/out');
    const fallbackDashboardOutDir = path.resolve(process.cwd(), 'packages/dashboard/out');
    const staticDir = fs.existsSync(fallbackDashboardOutDir)
      ? fallbackDashboardOutDir
      : fs.existsSync(dashboardOutDir)
      ? dashboardOutDir
      : null;

    if (staticDir) {
      this.app.use(express.static(staticDir));
    }

    this.app.get('/', (_req: Request, res: Response) => {
      if (staticDir && fs.existsSync(path.join(staticDir, 'index.html'))) {
        return res.sendFile(path.join(staticDir, 'index.html'));
      }

      const transactionsList = Array.from(this.transactions.values());

      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ethio-Pay Developer Simulator Hub</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #070a12;
      --card-bg: #121929;
      --border: rgba(255, 255, 255, 0.08);
      --primary: #38bdf8;
      --emerald: #10b981;
      --rose: #f43f5e;
      --text: #f8fafc;
      --muted: #94a3b8;
    }
    * { box-sizing: border-box; }
    body {
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 0;
      min-height: 100vh;
      display: flex;
    }

    /* Sidebar Navigation */
    .sidebar {
      width: 260px;
      background: #0d1322;
      border-right: 1px solid var(--border);
      padding: 24px;
      display: flex;
      flex-direction: column;
    }
    .brand-header {
      font-size: 18px;
      font-weight: 800;
      color: var(--primary);
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 32px;
    }
    .brand-icon { width: 12px; height: 12px; border-radius: 50%; background: var(--emerald); box-shadow: 0 0 10px var(--emerald); }

    .nav-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 6px; }
    .nav-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      color: var(--muted);
      cursor: pointer;
      transition: all 0.2s;
    }
    .nav-item:hover, .nav-item.active { background: rgba(56, 189, 248, 0.1); color: var(--primary); }

    /* Main Content */
    .main { flex: 1; padding: 32px; overflow-y: auto; }
    .top-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; }
    .page-title { font-size: 24px; font-weight: 800; margin: 0; }
    .target-badge { font-family: 'JetBrains Mono', monospace; font-size: 12px; background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.2); padding: 8px 16px; border-radius: 999px; color: var(--primary); }

    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px; }
    .stat-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 16px; padding: 20px; }
    .stat-val { font-size: 28px; font-weight: 800; color: white; margin-top: 6px; }
    .stat-lbl { font-size: 12px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }

    .content-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 24px; }
    .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 16px; padding: 24px; }
    .card-title { font-size: 16px; font-weight: 700; margin-top: 0; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }

    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 12px 10px; border-bottom: 1px solid var(--border); color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
    td { padding: 14px 10px; border-bottom: 1px solid rgba(255, 255, 255, 0.04); font-family: 'JetBrains Mono', monospace; }

    .badge-status { padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .badge-SUCCEEDED, .badge-200 { background: rgba(16, 185, 129, 0.15); color: var(--emerald); }
    .badge-PENDING { background: rgba(56, 189, 248, 0.15); color: var(--primary); }
    .badge-FAILED, .badge-500, .badge-400 { background: rgba(244, 63, 94, 0.15); color: var(--rose); }

    .btn-action { padding: 6px 12px; border: none; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; transition: opacity 0.2s; }
    .btn-action:hover { opacity: 0.85; }
    .btn-trigger { background: var(--emerald); color: white; }
    .btn-replay { background: var(--primary); color: #000; }

    .form-field { margin-bottom: 16px; }
    .form-field label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 6px; font-weight: 600; }
    .form-field input[type="text"] { width: 100%; padding: 10px 12px; background: #090d16; border: 1px solid var(--border); border-radius: 8px; color: white; font-family: 'JetBrains Mono', monospace; }
  </style>
</head>
<body>
  <div class="sidebar">
    <div class="brand-header">
      <span class="brand-icon"></span>
      ethio-pay SDK
    </div>
    <ul class="nav-list">
      <li class="nav-item active">📊 Developer Dashboard</li>
      <li class="nav-item">💳 Active Transactions (${transactionsList.length})</li>
      <li class="nav-item">📜 Webhook Logs (${this.webhookLogs.length})</li>
      <li class="nav-item">🛡️ Security Attack Lab</li>
    </ul>
  </div>

  <div class="main">
    <div class="top-bar">
      <div>
        <h1 class="page-title">Developer Webhook Simulator</h1>
        <div style="font-size: 13px; color: var(--muted); margin-top: 4px;">Gateway: <strong>${this.provider.toUpperCase()}</strong> | Secret: <code>${this.secretHash}</code></div>
      </div>
      <div class="target-badge">Webhook Target: ${this.targetUrl}</div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-lbl">Active Transactions</div>
        <div class="stat-val">${transactionsList.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-lbl">Webhooks Dispatched</div>
        <div class="stat-val">${this.webhookLogs.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-lbl">Delivery Success Rate</div>
        <div class="stat-val" style="color: var(--emerald);">
          ${this.webhookLogs.length > 0 ? Math.round((this.webhookLogs.filter((l) => l.responseStatus === 200).length / this.webhookLogs.length) * 100) : 100}%
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-lbl">Simulator Port</div>
        <div class="stat-val" style="color: var(--primary);">${this.port}</div>
      </div>
    </div>

    <div class="content-grid">
      <div class="card">
        <div class="card-title">
          <span>Active Transactions</span>
          <span style="font-size: 12px; color: var(--muted);">SDK Initialized Orders</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Reference</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Simulate Webhook</th>
            </tr>
          </thead>
          <tbody>
            ${
              transactionsList.length > 0
                ? transactionsList
                    .map(
                      (tx) => `
              <tr>
                <td><strong>${tx.reference}</strong></td>
                <td>${tx.amount} ${tx.currency}</td>
                <td><span class="badge-status badge-${tx.status}">${tx.status}</span></td>
                <td>
                  <button class="btn-action btn-trigger" onclick="triggerManual('${tx.reference}', 'SUCCEEDED')">⚡ Send Success Webhook</button>
                </td>
              </tr>
            `
                    )
                    .join('')
                : `<tr><td colspan="4" style="color: var(--muted); text-align: center; padding: 24px;">No transactions initialized yet. Initialize a payment from your app to test.</td></tr>`
            }
          </tbody>
        </table>

        <div class="card-title" style="margin-top: 32px;">
          <span>Live Webhook Log Inspector</span>
          <span style="font-size: 12px; color: var(--muted);">Recent Delivery Attempts</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Reference</th>
              <th>HTTP Code</th>
              <th>Replay</th>
            </tr>
          </thead>
          <tbody>
            ${
              this.webhookLogs.length > 0
                ? this.webhookLogs
                    .slice(0, 5)
                    .map(
                      (log) => `
              <tr>
                <td>${new Date(log.timestamp).toLocaleTimeString()}</td>
                <td>${log.reference}</td>
                <td><span class="badge-status badge-${log.responseStatus}">${log.responseStatus}</span></td>
                <td>
                  <button class="btn-action btn-replay" onclick="replayLog('${log.id}')">🔄 Replay</button>
                </td>
              </tr>
            `
                    )
                    .join('')
                : `<tr><td colspan="4" style="color: var(--muted); text-align: center; padding: 24px;">No webhooks dispatched yet.</td></tr>`
            }
          </tbody>
        </table>
      </div>

      <div class="card">
        <div class="card-title">Security Attack Lab</div>
        <p style="font-size: 13px; color: var(--muted);">Test how your merchant application reacts to forged signatures and edge-case attacks.</p>

        <div class="form-field">
          <label>Target Reference</label>
          <input type="text" id="attack-ref" placeholder="e.g. MANUAL-ORDER-999">
        </div>

        <div class="form-field">
          <label style="cursor: pointer; display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" id="tamper"> Forged HMAC Signature (MITM Attack)
          </label>
        </div>

        <button class="btn-action btn-trigger" style="width: 100%; padding: 12px; font-size: 14px;" onclick="triggerAttack()">
          🚀 Dispatch Attack Webhook
        </button>
      </div>
    </div>
  </div>

  <script>
    async function triggerManual(ref, status) {
      await fetch('/api/trigger-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: ref, status: status })
      });
      window.location.reload();
    }

    async function replayLog(id) {
      const res = await fetch('/api/logs/' + id + '/replay', { method: 'POST' });
      const data = await res.json();
      alert('Webhook replayed! HTTP Response: ' + data.log.responseStatus);
      window.location.reload();
    }

    async function triggerAttack() {
      const ref = document.getElementById('attack-ref').value || 'ATTACK-REF-1';
      const tamper = document.getElementById('tamper').checked;
      const res = await fetch('/api/trigger-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: ref, status: 'SUCCEEDED', tamperSignature: tamper })
      });
      const data = await res.json();
      alert('Attack webhook dispatched! Target Response HTTP: ' + data.responseStatus);
      window.location.reload();
    }
  </script>
</body>
</html>
      `;
      return res.send(html);
    });

    // Action Trigger Endpoint (SBX-5)
    this.app.post('/api/trigger-action', async (req: Request, res: Response) => {
      const { reference, status, tamperSignature, delayMs } = req.body;
      if (!reference || !status) {
        return res.status(400).json({ status: 'failed', message: 'reference and status are required' });
      }

      try {
        const log = await this.sendWebhook(reference, status, {
          tamperSignature: Boolean(tamperSignature),
          delayMs: Number(delayMs) || 0,
        });

        return res.json({
          status: 'success',
          message: 'Webhook dispatched successfully',
          responseStatus: log.responseStatus,
          logId: log.id,
        });
      } catch (err: any) {
        return res.status(500).json({ status: 'failed', message: err.message });
      }
    });

    // Webhook Request Log Endpoint (SBX-7)
    this.app.get('/api/logs', (_req: Request, res: Response) => {
      return res.json({ status: 'success', logs: this.webhookLogs });
    });

    // Active Transactions Endpoint (SBX-12)
    this.app.get('/api/transactions', (_req: Request, res: Response) => {
      return res.json({ status: 'success', transactions: Array.from(this.transactions.values()) });
    });

    // Replay Logged Webhook Endpoint (SBX-8)
    this.app.post('/api/logs/:id/replay', async (req: Request, res: Response) => {
      const log = this.webhookLogs.find((l) => l.id === req.params.id);
      if (!log) {
        return res.status(404).json({ status: 'failed', message: 'Log record not found' });
      }

      try {
        const replayLog = await this.sendWebhook(log.reference, log.status, {
          targetUrl: log.targetUrl,
        });
        return res.json({ status: 'success', message: 'Webhook replayed', log: replayLog });
      } catch (err: any) {
        return res.status(500).json({ status: 'failed', message: err.message });
      }
    });
  }
}
