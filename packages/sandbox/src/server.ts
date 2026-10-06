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
 * Local Webhook Simulator & Mock Payment Provider Server.
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

    // Fake Checkout UI Page (SBX-4)
    this.app.get('/checkout/:ref', (req: Request, res: Response) => {
      const ref = req.params.ref;
      const tx = this.transactions.get(ref);

      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Ethio-Pay Simulator Checkout</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
    .card { background: #1e293b; border-radius: 16px; padding: 32px; width: 100%; max-width: 480px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
    h2 { margin-top: 0; color: #38bdf8; text-align: center; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 9999px; background: #3b82f6; font-size: 12px; font-weight: 600; text-transform: uppercase; margin-bottom: 16px; }
    .row { display: flex; justify-content: space-between; margin: 12px 0; border-bottom: 1px solid #334155; padding-bottom: 8px; }
    .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 24px; }
    button { padding: 14px; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; transition: transform 0.1s, opacity 0.2s; }
    button:hover { opacity: 0.9; transform: translateY(-1px); }
    .btn-success { background: #22c55e; color: white; }
    .btn-failed { background: #ef4444; color: white; }
    .btn-cancel { background: #64748b; color: white; }
    .btn-expire { background: #eab308; color: black; }
    .edge-cases { margin-top: 20px; font-size: 13px; color: #94a3b8; }
    .checkbox-label { display: flex; align-items: center; gap: 8px; margin-top: 6px; cursor: pointer; }
    #status-msg { margin-top: 16px; padding: 12px; border-radius: 8px; font-weight: 500; display: none; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div style="text-align: center;"><span class="badge">Local Webhook Simulator (${this.provider})</span></div>
    <h2>Mock Checkout Page</h2>
    ${
      tx
        ? `
      <div class="row"><span>Reference:</span> <strong>${tx.reference}</strong></div>
      <div class="row"><span>Amount:</span> <strong>${tx.amount} ${tx.currency}</strong></div>
      <div class="row"><span>Customer:</span> <strong>${tx.email || 'N/A'}</strong></div>
      <div class="row"><span>Current Status:</span> <strong style="color: #38bdf8;">${tx.status}</strong></div>
    `
        : `<p style="color: #ef4444;">Transaction reference not found (${ref})</p>`
    }

    <div class="edge-cases">
      <strong>Simulation Options:</strong>
      <label class="checkbox-label"><input type="checkbox" id="tamper"> Tamper Signature (HMAC Attack)</label>
      <label class="checkbox-label"><input type="checkbox" id="delay"> Delay Webhook (3 Seconds)</label>
    </div>

    <div class="actions">
      <button class="btn-success" onclick="triggerAction('SUCCEEDED')">Pay Success</button>
      <button class="btn-failed" onclick="triggerAction('FAILED')">Pay Failed</button>
      <button class="btn-cancel" onclick="triggerAction('FAILED')">Cancel Order</button>
      <button class="btn-expire" onclick="triggerAction('EXPIRED')">Let Expire</button>
    </div>

    <div id="status-msg"></div>
  </div>

  <script>
    async function triggerAction(status) {
      const msg = document.getElementById('status-msg');
      const tamper = document.getElementById('tamper').checked;
      const delay = document.getElementById('delay').checked;
      msg.style.display = 'block';
      msg.style.background = '#334155';
      msg.style.color = '#f8fafc';
      msg.innerText = 'Dispatching webhook to target server...';

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
          msg.style.background = '#14532d';
          msg.style.color = '#4ade80';
          msg.innerText = 'Webhook Dispatched! Target HTTP Response: ' + data.responseStatus;
          if ('${tx?.returnUrl || ''}') {
            setTimeout(() => window.location.href = '${tx?.returnUrl}', 1500);
          }
        } else {
          msg.style.background = '#7f1d1d';
          msg.innerText = 'Error: ' + data.message;
        }
      } catch (err) {
        msg.style.background = '#7f1d1d';
        msg.innerText = 'Network error dispatching webhook';
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
