import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
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
  }
}
