import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import { createHmac } from 'node:crypto';
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
  timestamp: string;
}

export interface SandboxServerOptions {
  port?: number;
  targetUrl?: string;
  provider?: string;
  secretHash?: string;
}

/**
 * Local Webhook Simulator & Mock Payment Provider Server with a State-of-the-Art Developer UI.
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
      created_at: new Date().toISOString(),
    };

    const rawBody = JSON.stringify(payload);
    let signature = createHmac('sha256', this.secretHash).update(rawBody).digest('hex');

    if (options.tamperSignature) {
      signature = 'tampered_bad_signature_hash_123';
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

    const logRecord: WebhookLogRecord = {
      id: `wh_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      reference,
      targetUrl: destination,
      status: targetStatus,
      payload,
      headers,
      responseStatus,
      responseBody,
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

    // Ultra-Premium Glassmorphic Checkout Dashboard UI (SBX-4)
    this.app.get('/checkout/:ref', (req: Request, res: Response) => {
      const ref = req.params.ref;
      const tx = this.transactions.get(ref);

      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ethio-Pay Developer Simulator</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-dark: #070a12;
      --card-bg: rgba(18, 26, 44, 0.75);
      --card-border: rgba(255, 255, 255, 0.08);
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #38bdf8;
      --emerald: #10b981;
      --emerald-glow: rgba(16, 185, 129, 0.25);
      --rose: #f43f5e;
      --rose-glow: rgba(244, 63, 94, 0.25);
      --amber: #f59e0b;
      --slate: #475569;
    }

    * { box-sizing: border-box; }
    body {
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      background: radial-gradient(circle at 50% 0%, #111a2e 0%, var(--bg-dark) 70%);
      color: var(--text-main);
      min-height: 100vh;
      margin: 0;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 24px;
    }

    .container {
      width: 100%;
      max-width: 520px;
      perspective: 1000px;
    }

    .card {
      background: var(--card-bg);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid var(--card-border);
      border-radius: 24px;
      padding: 32px;
      box-shadow: 0 30px 60px -12px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.1);
      transition: transform 0.3s ease, box-shadow 0.3s ease;
    }

    .header {
      text-align: center;
      margin-bottom: 28px;
    }

    .provider-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 16px;
      border-radius: 9999px;
      background: rgba(56, 189, 248, 0.1);
      border: 1px solid rgba(56, 189, 248, 0.25);
      color: var(--primary);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      margin-bottom: 12px;
    }

    .flag-accent {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
    }

    h1 {
      font-size: 24px;
      font-weight: 800;
      margin: 0 0 6px 0;
      letter-spacing: -0.02em;
      background: linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .subtitle {
      font-size: 13px;
      color: var(--text-muted);
      margin: 0;
    }

    .summary-box {
      background: rgba(10, 16, 28, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 16px;
      padding: 20px;
      margin-bottom: 24px;
    }

    .amount-row {
      text-align: center;
      margin-bottom: 16px;
      padding-bottom: 16px;
      border-bottom: 1px dashed rgba(255, 255, 255, 0.1);
    }

    .amount-number {
      font-size: 36px;
      font-weight: 800;
      color: #ffffff;
      letter-spacing: -0.03em;
    }

    .amount-currency {
      font-size: 16px;
      color: var(--primary);
      font-weight: 700;
      margin-left: 4px;
    }

    .info-grid {
      display: grid;
      gap: 12px;
      font-size: 13px;
    }

    .info-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .info-label { color: var(--text-muted); }
    .info-val { font-weight: 600; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #f1f5f9; }

    .status-tag {
      padding: 3px 10px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .status-PENDING { background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); }
    .status-SUCCEEDED { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .status-FAILED { background: rgba(244, 63, 94, 0.15); color: #fb7185; border: 1px solid rgba(244, 63, 94, 0.3); }

    .section-title {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-muted);
      margin-bottom: 12px;
    }

    .controls-grid {
      display: grid;
      gap: 10px;
      margin-bottom: 24px;
      background: rgba(10, 16, 28, 0.4);
      padding: 14px;
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.04);
    }

    .toggle-label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 13px;
      color: #cbd5e1;
      cursor: pointer;
      user-select: none;
    }

    .toggle-label input { accent-color: var(--primary); width: 16px; height: 16px; cursor: pointer; }

    .actions-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .btn {
      position: relative;
      padding: 14px 18px;
      border: none;
      border-radius: 12px;
      font-family: inherit;
      font-size: 14px;
      font-weight: 700;
      color: white;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    .btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);
    }

    .btn:active { transform: translateY(0); }

    .btn-success {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      box-shadow: 0 6px 20px var(--emerald-glow);
    }
    .btn-failed {
      background: linear-gradient(135deg, #f43f5e 0%, #e11d48 100%);
      box-shadow: 0 6px 20px var(--rose-glow);
    }
    .btn-cancel {
      background: linear-gradient(135deg, #475569 0%, #334155 100%);
    }
    .btn-expire {
      background: linear-gradient(135deg, #d97706 0%, #b45309 100%);
    }

    .console-card {
      margin-top: 24px;
      background: #040711;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 14px;
      padding: 16px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      display: none;
    }

    .console-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      color: var(--text-muted);
      font-size: 11px;
    }

    .status-badge-200 { color: #34d399; font-weight: 700; }
    .status-badge-400 { color: #fb7185; font-weight: 700; }

    #console-body {
      white-space: pre-wrap;
      word-break: break-all;
      color: #e2e8f0;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="header">
        <div class="provider-pill">
          <span class="flag-accent"></span>
          ${this.provider} Webhook Simulator
        </div>
        <h1>Developer Checkout</h1>
        <p class="subtitle">Test live signed webhooks locally on your machine</p>
      </div>

      ${
        tx
          ? `
        <div class="summary-box">
          <div class="amount-row">
            <span class="amount-number">${tx.amount.toLocaleString()}</span>
            <span class="amount-currency">${tx.currency}</span>
          </div>
          <div class="info-grid">
            <div class="info-row">
              <span class="info-label">Reference</span>
              <span class="info-val">${tx.reference}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Customer</span>
              <span class="info-val">${tx.email || 'customer@example.com'}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Payment Status</span>
              <span class="status-tag status-${tx.status}">${tx.status}</span>
            </div>
          </div>
        </div>
      `
          : `<div class="summary-box" style="color: #fb7185; text-align: center;">Transaction reference '${ref}' not found</div>`
      }

      <div class="section-title">Attack & Failure Simulation</div>
      <div class="controls-grid">
        <label class="toggle-label">
          <span>🛡️ Tamper HMAC Signature (HMAC Forgery Test)</span>
          <input type="checkbox" id="tamper">
        </label>
        <label class="toggle-label">
          <span>⏱️ Network Latency (3 Seconds Delay)</span>
          <input type="checkbox" id="delay">
        </label>
      </div>

      <div class="section-title">Trigger Action</div>
      <div class="actions-grid">
        <button class="btn btn-success" onclick="triggerAction('SUCCEEDED')">
          ⚡ Pay Success
        </button>
        <button class="btn btn-failed" onclick="triggerAction('FAILED')">
          💥 Pay Failed
        </button>
        <button class="btn btn-cancel" onclick="triggerAction('FAILED')">
          🚫 Cancel Order
        </button>
        <button class="btn btn-expire" onclick="triggerAction('EXPIRED')">
          ⌛ Let Expire
        </button>
      </div>

      <div class="console-card" id="console">
        <div class="console-header">
          <span>REAL-TIME WEBHOOK LOG</span>
          <span id="console-timestamp"></span>
        </div>
        <div id="console-body">Dispatching signed webhook request...</div>
      </div>
    </div>
  </div>

  <script>
    async function triggerAction(status) {
      const consoleBox = document.getElementById('console');
      const consoleBody = document.getElementById('console-body');
      const consoleTime = document.getElementById('console-timestamp');
      const tamper = document.getElementById('tamper').checked;
      const delay = document.getElementById('delay').checked;

      consoleBox.style.display = 'block';
      consoleTime.innerText = new Date().toLocaleTimeString();
      consoleBody.innerHTML = '<span style="color: #38bdf8;">⏳ Dispatching HMAC-SHA256 signed webhook to target server...</span>';

      try {
        const res = await fetch('/api/trigger-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reference: '${ref}',
            status: status,
            tamperSignature: tamper,
            delayMs: delay ? 3000 : 0
          })
        });

        const data = await res.json();
        if (res.ok) {
          const isSuccess = data.responseStatus >= 200 && data.responseStatus < 300;
          const statusClass = isSuccess ? 'status-badge-200' : 'status-badge-400';
          
          consoleBody.innerHTML = 
            '<strong>HTTP POST Delivery Result:</strong>\\n' +
            '• Target Response Status: <span class="' + statusClass + '">' + data.responseStatus + ' ' + (isSuccess ? 'OK' : 'ERROR') + '</span>\\n' +
            '• Log ID: <span style="color: #94a3b8;">' + data.logId + '</span>\\n' +
            '• Tamper Attack: ' + (tamper ? '<span style="color:#fb7185;">ACTIVE</span>' : '<span style="color:#34d399;">DISABLED</span>') + '\\n\\n' +
            '<span style="color: #94a3b8;">Redirecting to return URL...</span>';

          if ('${tx?.returnUrl || ''}') {
            setTimeout(() => window.location.href = '${tx?.returnUrl}', 1800);
          }
        } else {
          consoleBody.innerHTML = '<span style="color: #fb7185;">❌ Error: ' + data.message + '</span>';
        }
      } catch (err) {
        consoleBody.innerHTML = '<span style="color: #fb7185;">❌ Network error delivering webhook</span>';
      }
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
