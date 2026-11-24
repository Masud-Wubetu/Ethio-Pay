import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import crypto, { createHmac } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import type { Status } from '@ethio-pay/core';
import {
  decryptWithPrivateKey,
  signWithPrivateKey,
  createCanonicalString,
} from '@ethio-pay/telebirr';


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
  rsaPrivateKey?: string;
  rsaPublicKey?: string;
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
  public rsaPrivateKey: string;
  public rsaPublicKey: string;
  public transactions = new Map<string, TransactionRecord>();
  public webhookLogs: WebhookLogRecord[] = [];

  constructor(options: SandboxServerOptions = {}) {
    this.port = options.port ?? 4040;
    this.targetUrl = options.targetUrl ?? 'http://localhost:3000/api/webhooks/chapa';
    this.provider = options.provider ?? 'chapa';
    this.secretHash = options.secretHash ?? 'sandbox_secret_hash_123';

    if (options.rsaPrivateKey && options.rsaPublicKey) {
      this.rsaPrivateKey = options.rsaPrivateKey;
      this.rsaPublicKey = options.rsaPublicKey;
    } else {
      const keyPair = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      this.rsaPrivateKey = options.rsaPrivateKey ?? keyPair.privateKey;
      this.rsaPublicKey = options.rsaPublicKey ?? keyPair.publicKey;
    }

    this.app = express();
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Security: Live key protection check
    if (this.secretHash.toLowerCase().includes('live') || this.secretHash.startsWith('CHASECK_LIVE')) {
      console.warn('⚠️ SECURITY WARNING: Live API key detected in local Sandbox server! Use test/sandbox keys only.');
    }

    // Security: Host header verification middleware to prevent DNS rebinding
    this.app.use((req, res, next) => {
      const host = req.headers.host || '';
      if (!host.startsWith('localhost') && !host.startsWith('127.0.0.1') && !host.startsWith('[::1]')) {
        return res.status(403).json({ error: 'Access forbidden: Sandbox control server only accepts local connections.' });
      }
      next();
    });

    this.setupRoutes();
  }

  public async sendWebhook(
    reference: string,
    targetStatus: Status,
    options: { tamperSignature?: boolean; delayMs?: number; targetUrl?: string } = {}
  ): Promise<WebhookLogRecord> {
    const tx = this.transactions.get(reference);
    const provider = tx?.provider || this.provider;
    if (provider === 'telebirr') {
      return this.sendTelebirrWebhook(reference, targetStatus, options);
    }

    const startTime = Date.now();
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
      reference,
      orderId: reference,
      id: reference,
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

    const signatureHeaderName =
      provider === 'santimpay'
        ? 'x-santimpay-signature'
        : provider === 'cbebirr'
        ? 'x-cbebirr-signature'
        : provider === 'arifpay'
        ? 'x-arifpay-signature'
        : provider === 'awashbirr'
        ? 'x-awashbirr-signature'
        : 'x-chapa-signature';

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      [signatureHeaderName]: signature,
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

  public async sendTelebirrWebhook(
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
    const rawStatus = targetStatus === 'SUCCEEDED' ? 'TRADE_SUCCESS' : 'TRADE_CLOSED';

    const payloadObj: Record<string, any> = {
      outTradeNo: reference,
      msisdn: tx?.phone || '0911000000',
      totalAmount: (tx?.amount || 100).toFixed(2),
      tradeDate: String(Date.now()),
      tradeNo: `TB_${Date.now()}`,
      tradeStatus: rawStatus,
    };

    const canonical = createCanonicalString(payloadObj);
    let signature = signWithPrivateKey(canonical, this.rsaPrivateKey);

    if (options.tamperSignature) {
      signature = 'tampered_forged_invalid_rsa_signature_base64_123';
    }

    const payload = {
      ...payloadObj,
      sign: signature,
    };

    if (options.delayMs && options.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }

    const rawBody = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-telebirr-signature': signature,
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
      responseBody = err.message || 'Telebirr webhook dispatch network failure';
    }

    const executionTimeMs = Date.now() - startTime;

    const logRecord: WebhookLogRecord = {
      id: `wh_tb_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
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

    // Emulate Chapa refund endpoint
    this.app.post('/v1/refund', (req: Request, res: Response) => {
      const ref = req.body?.trx_ref || req.body?.tx_ref;
      if (!ref) {
        return res.status(400).json({
          status: 'failed',
          message: 'trx_ref or tx_ref is required for refund',
        });
      }

      const tx = this.transactions.get(ref);
      if (!tx) {
        return res.status(404).json({
          status: 'failed',
          message: `Transaction reference '${ref}' not found in sandbox`,
        });
      }

      tx.status = 'REFUNDED' as Status;
      tx.updatedAt = new Date().toISOString();

      const refundId = `chapa_rf_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      return res.json({
        status: 'success',
        message: 'Refund processed successfully',
        data: {
          reference: ref,
          refund_id: refundId,
          status: 'success',
          amount: req.body?.amount ? Number(req.body.amount) : tx.amount,
        },
      });
    });

    // Public key endpoint for Telebirr simulation clients
    this.app.get('/api/telebirr/public-key', (_req: Request, res: Response) => {
      return res.json({
        status: 'success',
        publicKey: this.rsaPublicKey,
      });
    });

    // Emulate Telebirr Fabric toTradeWebPay endpoint
    this.app.post('/ammapi/payment/service-openup/toTradeWebPay', (req: Request, res: Response) => {
      const { ussd } = req.body || {};

      let fabricParams: Record<string, any>;
      try {
        if (!ussd) {
          throw new Error('Missing ussd encrypted parameter in Telebirr payload');
        }
        // Attempt RSA decryption using sandbox private key
        const decryptedJson = decryptWithPrivateKey(ussd, this.rsaPrivateKey);
        fabricParams = JSON.parse(decryptedJson);
      } catch (err: any) {
        // Fallback: If sent plain JSON in direct testing
        if (req.body?.outTradeNo) {
          fabricParams = req.body;
        } else {
          return res.status(400).json({
            code: 400,
            msg: `Failed to decrypt Telebirr ussd payload: ${err.message}`,
          });
        }
      }

      const reference = fabricParams.outTradeNo;
      if (!reference) {
        return res.status(400).json({
          code: 400,
          msg: 'outTradeNo is required in Fabric parameters',
        });
      }

      const tx: TransactionRecord = {
        reference,
        amount: Number(fabricParams.totalAmount) || 0,
        currency: 'ETB',
        firstName: fabricParams.receiveName,
        callbackUrl: fabricParams.notifyUrl || this.targetUrl,
        returnUrl: fabricParams.returnUrl,
        status: 'PENDING',
        provider: 'telebirr',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      this.transactions.set(reference, tx);

      const checkoutUrl = `http://localhost:${this.port}/checkout/${encodeURIComponent(reference)}`;

      return res.json({
        code: 200,
        msg: 'success',
        data: {
          toPayUrl: checkoutUrl,
        },
      });
    });

    // Emulate Telebirr queryOrder endpoint
    this.app.post('/ammapi/payment/service-openup/queryOrder', (req: Request, res: Response) => {
      let queryParams: Record<string, any>;
      const { ussd } = req.body || {};

      try {
        if (ussd) {
          const decryptedJson = decryptWithPrivateKey(ussd, this.rsaPrivateKey);
          queryParams = JSON.parse(decryptedJson);
        } else if (req.body?.outTradeNo) {
          queryParams = req.body;
        } else {
          return res.status(400).json({
            code: 400,
            msg: 'Missing ussd encrypted parameter or outTradeNo',
          });
        }
      } catch (err: any) {
        return res.status(400).json({
          code: 400,
          msg: `Failed to decrypt Telebirr query ussd payload: ${err.message}`,
        });
      }

      const reference = queryParams.outTradeNo;
      const tx = this.transactions.get(reference);

      if (!tx) {
        return res.status(404).json({
          code: 404,
          msg: `Transaction with outTradeNo '${reference}' not found in sandbox`,
        });
      }

      let tradeStatus = 'PAYING';
      if (tx.status === 'SUCCEEDED') {
        tradeStatus = 'TRADE_SUCCESS';
      } else if (tx.status === 'FAILED') {
        tradeStatus = 'TRADE_CLOSED';
      } else if (tx.status === 'EXPIRED') {
        tradeStatus = 'EXPIRED';
      }

      return res.json({
        code: 200,
        msg: 'success',
        data: {
          outTradeNo: tx.reference,
          tradeNo: `TB_${Date.now()}`,
          tradeStatus,
          totalAmount: tx.amount.toFixed(2),
          currency: tx.currency,
          paidTime: tx.updatedAt,
        },
      });
    });

    // ------------------------------------------------------------------------
    // MOCK ENDPOINTS FOR CBE BIRR, ARIFPAY, SANTIMPAY, AWASH BIRR & SMS
    // ------------------------------------------------------------------------
    // CBE Birr Checkout & Query
    this.app.post('/cbe/payment/v1/checkout', (req: Request, res: Response) => {
      const { reference, amount, currency, callbackUrl, returnUrl, customerPhone, customerName } = req.body || {};
      const ref = reference || `cbe_${Date.now()}`;
      const record: TransactionRecord = {
        reference: ref,
        amount: Number(amount) || 100,
        currency: currency || 'ETB',
        phone: customerPhone,
        firstName: customerName,
        callbackUrl,
        returnUrl,
        status: 'PENDING',
        provider: 'cbebirr',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.transactions.set(ref, record);
      return res.json({
        code: 200,
        message: 'Payment initiated successfully',
        checkoutUrl: `http://localhost:${this.port}/checkout/${encodeURIComponent(ref)}`,
        conversationId: `cbe_conv_${Date.now()}`,
        transactionReference: ref,
      });
    });

    this.app.get('/cbe/payment/v1/query/:ref', (req: Request, res: Response) => {
      const tx = this.transactions.get(req.params.ref);
      if (!tx) {
        return res.status(404).json({ code: 404, message: 'Transaction not found' });
      }
      return res.json({
        code: 200,
        message: 'Transaction query successful',
        status: tx.status === 'SUCCEEDED' ? 'SUCCESS' : tx.status === 'FAILED' ? 'FAILED' : 'PENDING',
        transactionStatus: tx.status === 'SUCCEEDED' ? 'COMPLETED' : tx.status === 'FAILED' ? 'FAILED' : 'PENDING',
        amount: tx.amount,
        currency: tx.currency,
        transactionId: `cbe_tx_${Date.now()}`,
        orderId: tx.reference,
        timestamp: tx.updatedAt,
      });
    });

    // ArifPay Checkout & Query
    this.app.post('/api/sandbox/checkout/session', (req: Request, res: Response) => {
      const { beneficiaries, notifyUrl, successUrl } = req.body || {};
      const ref = beneficiaries?.[0]?.accountNumber || `arif_${Date.now()}`;
      const amount = beneficiaries?.[0]?.amount || 100;
      const record: TransactionRecord = {
        reference: ref,
        amount: Number(amount),
        currency: 'ETB',
        callbackUrl: notifyUrl,
        returnUrl: successUrl,
        status: 'PENDING',
        provider: 'arifpay',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.transactions.set(ref, record);
      const checkoutUrl = `http://localhost:${this.port}/checkout/${encodeURIComponent(ref)}`;
      return res.json({
        error: false,
        msg: 'Session created successfully',
        data: {
          sessionId: ref,
          paymentUrl: checkoutUrl,
          checkoutUrl,
          totalAmount: amount,
        },
      });
    });

    this.app.get('/api/sandbox/checkout/session/:sessionId', (req: Request, res: Response) => {
      const tx = this.transactions.get(req.params.sessionId);
      if (!tx) {
        return res.status(404).json({ error: true, msg: 'Session not found' });
      }
      return res.json({
        error: false,
        data: {
          sessionId: tx.reference,
          status: tx.status === 'SUCCEEDED' ? 'SUCCESS' : tx.status === 'FAILED' ? 'FAILED' : 'PENDING',
          transactionStatus: tx.status === 'SUCCEEDED' ? 'COMPLETED' : tx.status === 'FAILED' ? 'FAILED' : 'PENDING',
          totalAmount: tx.amount,
          orderId: tx.reference,
        },
      });
    });

    // SantimPay Checkout & Query
    this.app.post('/api/v1/gateway/initiate-payment', (req: Request, res: Response) => {
      const { id, amount, notifyUrl, successRedirectUrl, phoneNumber } = req.body || {};
      const ref = id || `santim_${Date.now()}`;
      const record: TransactionRecord = {
        reference: ref,
        amount: Number(amount) || 100,
        currency: 'ETB',
        phone: phoneNumber,
        callbackUrl: notifyUrl,
        returnUrl: successRedirectUrl,
        status: 'PENDING',
        provider: 'santimpay',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.transactions.set(ref, record);
      const checkoutUrl = `http://localhost:${this.port}/checkout/${encodeURIComponent(ref)}`;
      return res.json({
        status: 'SUCCESS',
        message: 'Payment initiation successful',
        url: checkoutUrl,
        paymentUrl: checkoutUrl,
      });
    });

    this.app.get('/api/v1/gateway/payment-status/:ref', (req: Request, res: Response) => {
      const tx = this.transactions.get(req.params.ref);
      if (!tx) {
        return res.status(404).json({ status: 'FAILED', message: 'Transaction not found' });
      }
      return res.json({
        status: 'SUCCESS',
        paymentStatus: tx.status === 'SUCCEEDED' ? 'COMPLETED' : tx.status === 'FAILED' ? 'FAILED' : 'PENDING',
        transactionStatus: tx.status === 'SUCCEEDED' ? 'COMPLETED' : tx.status === 'FAILED' ? 'FAILED' : 'PENDING',
        amount: tx.amount,
        currency: tx.currency,
        reference: tx.reference,
        id: tx.reference,
        paymentDate: tx.updatedAt,
      });
    });

    // Awash Birr Checkout & Query
    this.app.post('/awash/payment/v1/initiate', (req: Request, res: Response) => {
      const { reference, amount, currency, callbackUrl, returnUrl, customerPhone } = req.body || {};
      const ref = reference || `awash_${Date.now()}`;
      const record: TransactionRecord = {
        reference: ref,
        amount: Number(amount) || 100,
        currency: currency || 'ETB',
        phone: customerPhone,
        callbackUrl,
        returnUrl,
        status: 'PENDING',
        provider: 'awashbirr',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.transactions.set(ref, record);
      return res.json({
        statusCode: 200,
        message: 'Payment checkout initiated',
        checkoutUrl: `http://localhost:${this.port}/checkout/${encodeURIComponent(ref)}`,
        paymentUrl: `http://localhost:${this.port}/checkout/${encodeURIComponent(ref)}`,
        transactionRef: ref,
      });
    });

    this.app.get('/awash/payment/v1/status/:ref', (req: Request, res: Response) => {
      const tx = this.transactions.get(req.params.ref);
      if (!tx) {
        return res.status(404).json({ statusCode: 404, message: 'Transaction not found' });
      }
      return res.json({
        statusCode: 200,
        message: 'Status query successful',
        status: tx.status === 'SUCCEEDED' ? 'SUCCESS' : tx.status === 'FAILED' ? 'FAILED' : 'PENDING',
        amount: tx.amount,
        currency: tx.currency,
        transactionId: `awash_tx_${Date.now()}`,
        reference: tx.reference,
      });
    });

    // SMS Providers Simulation (AfroMessage, GeeZ SMS, Ethio Telecom)
    this.app.post('/api/send', (req: Request, res: Response) => {
      return res.json({
        acknowledge: 'success',
        response: {
          message_id: `msg_afro_${Date.now()}`,
          status: 'delivered',
        },
      });
    });

    this.app.post('/api/v1/sms/send', (req: Request, res: Response) => {
      return res.json({
        status: 'success',
        data: {
          messageId: `msg_sms_${Date.now()}`,
          sent: true,
        },
      });
    });

    // ------------------------------------------------------------------------
    // 1. REALISTIC CUSTOMER-FACING CHECKOUT UI (/checkout/:ref)
    // ------------------------------------------------------------------------
    this.app.get('/checkout/:ref', (req: Request, res: Response) => {
      const ref = req.params.ref;
      const tx = this.transactions.get(ref);
      const effectiveProvider = (tx?.provider || this.provider).toLowerCase();
      const isTelebirr = effectiveProvider === 'telebirr';

      const providerMetadata: Record<string, { title: string; subtitle: string; color: string; badge: string; gradient: string }> = {
        chapa: {
          title: 'Chapa Hosted Checkout',
          subtitle: 'PCI-DSS Compliant Cards & Mobile Wallets',
          color: '#10b981',
          badge: 'Verified Gateway',
          gradient: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
        },
        telebirr: {
          title: 'Telebirr Fabric H5',
          subtitle: 'Ethio Telecom Official Mobile Banking',
          color: '#0072ce',
          badge: 'RSA-2048 Encrypted',
          gradient: 'linear-gradient(135deg, #0072ce 0%, #00569a 100%)',
        },
        cbebirr: {
          title: 'CBE Birr Direct Gateway',
          subtitle: 'Commercial Bank of Ethiopia Banking Rail',
          color: '#a855f7',
          badge: 'Bank Direct Rail',
          gradient: 'linear-gradient(135deg, #9333ea 0%, #6b21a8 100%)',
        },
        arifpay: {
          title: 'ArifPay Checkout',
          subtitle: 'Licensed Payment System Operator (PSO)',
          color: '#6366f1',
          badge: 'Multi-Rail PSO',
          gradient: 'linear-gradient(135deg, #6366f1 0%, #4338ca 100%)',
        },
        santimpay: {
          title: 'SantimPay Gateway',
          subtitle: 'Instant QR & Direct Account Debit',
          color: '#0d9488',
          badge: 'Instant Rail',
          gradient: 'linear-gradient(135deg, #0d9488 0%, #0f766e 100%)',
        },
        awashbirr: {
          title: 'Awash Birr Checkout',
          subtitle: 'Awash International Bank Digital Wallet',
          color: '#f43f5e',
          badge: 'Awash Direct',
          gradient: 'linear-gradient(135deg, #f43f5e 0%, #be123c 100%)',
        },
      };

      const meta = providerMetadata[effectiveProvider] || providerMetadata.chapa;
      const brandTitle = isTelebirr ? 'TELEBIRR' : effectiveProvider.toUpperCase();
      const brandColor = meta.color;
      const gradientBtn = meta.gradient;

      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pay with ${brandTitle} (Test Mode)</title>
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
    .brand-name { font-size: 22px; font-weight: 800; color: ${brandColor}; letter-spacing: -0.02em; }
    .amount-box { text-align: center; background: rgba(10, 16, 28, 0.6); border-radius: 16px; padding: 20px; margin-bottom: 24px; border: 1px solid rgba(255, 255, 255, 0.05); }
    .amount-val { font-size: 38px; font-weight: 800; color: #ffffff; }
    .amount-cur { font-size: 16px; color: ${brandColor}; font-weight: 700; margin-left: 4px; }
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
    .form-input:focus { outline: none; border-color: ${brandColor}; }

    .test-helper {
      font-size: 12px;
      color: ${brandColor};
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
      background: ${gradientBtn};
      color: white;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 6px 20px rgba(0, 114, 206, 0.3);
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
    .pin-input { font-size: 28px; letter-spacing: 12px; text-align: center; width: 180px; padding: 10px; background: #0f172a; border: 1px solid ${brandColor}; border-radius: 10px; color: white; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="test-banner">⚠️ TEST MODE — Simulated Payment (No Real Money Charged)</div>

  <div class="checkout-wrapper">
    <div class="card">
      <div class="brand-row">
        <span class="brand-name">${brandTitle} CHECKOUT</span>
        <span style="font-size: 12px; color: #94a3b8;">${isTelebirr ? 'Fabric H5 Gateway' : 'Hosted Gateway'}</span>
      </div>

      ${
        tx
          ? `
        <div class="amount-box">
          <div><span class="amount-val">${tx.amount.toLocaleString()}</span><span class="amount-cur">${tx.currency}</span></div>
          <div class="ref-code">Ref: ${tx.reference}</div>
        </div>

        <div class="test-helper" onclick="autofillTest()">
          <span>💡 Autofill Test ${brandTitle} Credentials</span>
          <strong>0911000000</strong>
        </div>

        <div class="form-group">
          <label class="form-label">${isTelebirr ? 'Telebirr Phone Number' : 'Phone Number / Account Email'}</label>
          <input type="text" id="account" class="form-input" value="${tx.phone || tx.email || '0911000000'}">
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
      <h3 style="margin-top:0;">${isTelebirr ? 'Telebirr USSD / Quick PIN' : 'Enter Test PIN / OTP'}</h3>
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
    function redirectToStore() {
      const returnUrl = "${tx?.returnUrl || '/'}";
      window.location.href = returnUrl;
    }
    async function confirmPayment() {
      const pinModal = document.getElementById('pin-modal');
      pinModal.innerHTML = '<div class="modal-card"><h3 style="color: ${brandColor}; margin-top:0;">Processing Payment...</h3><p style="color:#94a3b8; font-size:13px;">Dispatching signed webhook...</p></div>';

      try {
        const res = await fetch('/api/trigger-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reference: '${ref}', status: 'SUCCEEDED' })
        });
        if (res.ok) {
          pinModal.innerHTML = '<div class="modal-card"><h3 style="color: #34d399; font-size: 20px; font-weight: 800; margin-top: 0;">✓ Payment Authorized!</h3><p style="color: #94a3b8; font-size: 13px; margin-bottom: 20px;">Signed webhook dispatched to merchant app</p><button class="btn-pay" onclick="redirectToStore()">Return to Merchant / Console &rarr;</button></div>';
          setTimeout(redirectToStore, 1200);
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
      redirectToStore();
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
  <title>Ethio-Pay Developer Platform & Webhook Simulator</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #070a12;
      --card-bg: rgba(18, 26, 43, 0.85);
      --card-border: rgba(255, 255, 255, 0.08);
      --primary: #38bdf8;
      --emerald: #10b981;
      --rose: #f43f5e;
      --purple: #a855f7;
      --indigo: #6366f1;
      --text: #f8fafc;
      --muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      background: radial-gradient(circle at 50% 0%, #151d30 0%, #070a12 100%);
      color: var(--text);
      min-height: 100vh;
      display: flex;
    }

    /* Ethiopian Flag Accent Strip */
    .top-strip {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: linear-gradient(90deg, #009A44 0%, #FED100 50%, #EF3340 100%);
      z-index: 1000;
    }

    /* Sidebar Navigation */
    .sidebar {
      width: 280px;
      background: rgba(13, 19, 34, 0.95);
      backdrop-filter: blur(20px);
      border-right: 1px solid var(--card-border);
      padding: 32px 20px 24px 20px;
      display: flex;
      flex-direction: column;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 32px;
    }
    .brand-icon {
      width: 38px;
      height: 38px;
      border-radius: 10px;
      background: linear-gradient(135deg, #0284c7 0%, #059669 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      box-shadow: 0 4px 14px rgba(2, 132, 199, 0.4);
    }
    .brand-title {
      font-size: 19px;
      font-weight: 800;
      color: #fff;
      letter-spacing: -0.02em;
    }
    .brand-sub {
      font-size: 11px;
      color: var(--primary);
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .nav-list { list-style: none; display: grid; gap: 6px; }
    .nav-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      border-radius: 12px;
      font-size: 13.5px;
      font-weight: 600;
      color: var(--muted);
      cursor: pointer;
      transition: all 0.2s;
    }
    .nav-item:hover, .nav-item.active {
      background: rgba(56, 189, 248, 0.1);
      color: #fff;
    }
    .nav-pill {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      background: rgba(255, 255, 255, 0.08);
      padding: 3px 8px;
      border-radius: 999px;
      font-weight: 600;
    }

    .sidebar-footer {
      margin-top: auto;
      padding: 16px;
      background: rgba(10, 15, 26, 0.7);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      font-size: 12px;
    }

    /* Main View */
    .main {
      flex: 1;
      padding: 36px 44px;
      overflow-y: auto;
    }
    .header-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 32px;
    }
    .page-title {
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: #fff;
    }
    .page-subtitle {
      font-size: 14px;
      color: var(--muted);
      margin-top: 4px;
    }
    .live-status-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 18px;
      border-radius: 999px;
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.25);
      color: var(--emerald);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    .pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--emerald);
      box-shadow: 0 0 10px var(--emerald);
      animation: pulse 2s infinite;
    }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

    /* Stats Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 20px;
      margin-bottom: 32px;
    }
    .stat-card {
      background: var(--card-bg);
      backdrop-filter: blur(16px);
      border: 1px solid var(--card-border);
      border-radius: 20px;
      padding: 22px 24px;
      box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.5);
    }
    .stat-label {
      font-size: 12px;
      font-weight: 700;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .stat-value {
      font-size: 34px;
      font-weight: 800;
      color: #fff;
      margin-top: 8px;
    }

    /* Rails Grid */
    .rails-bar {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 12px;
      margin-bottom: 32px;
    }
    .rail-item {
      background: rgba(10, 15, 26, 0.6);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 12px 14px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .rail-dot { width: 8px; height: 8px; border-radius: 50%; }

    /* Content Layout */
    .content-layout {
      display: grid;
      grid-template-columns: 1.8fr 1.2fr;
      gap: 24px;
    }
    .card-panel {
      background: var(--card-bg);
      backdrop-filter: blur(16px);
      border: 1px solid var(--card-border);
      border-radius: 22px;
      padding: 26px;
      box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.5);
      margin-bottom: 24px;
    }
    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--card-border);
    }
    .panel-title {
      font-size: 17px;
      font-weight: 800;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* Table Styling */
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th {
      text-align: left;
      padding: 12px 10px;
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      border-bottom: 1px solid var(--card-border);
    }
    td {
      padding: 15px 10px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      font-family: 'JetBrains Mono', monospace;
    }
    .tag-provider {
      font-size: 11px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 6px;
      text-transform: uppercase;
      display: inline-block;
    }
    .tag-chapa { background: rgba(16, 185, 129, 0.15); color: #34d399; }
    .tag-telebirr { background: rgba(2, 132, 199, 0.15); color: #38bdf8; }
    .tag-cbebirr { background: rgba(168, 85, 247, 0.15); color: #c084fc; }
    .tag-arifpay { background: rgba(99, 102, 241, 0.15); color: #818cf8; }
    .tag-santimpay { background: rgba(13, 148, 136, 0.15); color: #2dd4bf; }
    .tag-awashbirr { background: rgba(244, 63, 94, 0.15); color: #fb7185; }

    /* Action Buttons */
    .btn {
      padding: 8px 14px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      border: none;
      cursor: pointer;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn:hover { opacity: 0.9; transform: translateY(-1px); }
    .btn-green { background: #059669; color: #fff; }
    .btn-blue { background: #0284c7; color: #fff; }
    .btn-replay { background: rgba(56, 189, 248, 0.12); color: var(--primary); border: 1px solid rgba(56, 189, 248, 0.25); }

    /* Attack Box */
    .attack-card {
      background: #090e1a;
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .attack-title { font-size: 13.5px; font-weight: 700; color: #fff; margin-bottom: 4px; }
    .attack-desc { font-size: 12px; color: var(--muted); margin-bottom: 12px; line-height: 1.4; }

    /* Modal / Inspector */
    .inspector-modal {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(8px);
      display: none;
      justify-content: center;
      align-items: center;
      z-index: 200;
      padding: 24px;
    }
    .inspector-card {
      background: #111827;
      border: 1px solid var(--card-border);
      border-radius: 20px;
      padding: 28px;
      width: 100%;
      max-width: 600px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.85);
    }
    .code-block {
      background: #090d16;
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 16px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: #38bdf8;
      max-height: 280px;
      overflow-y: auto;
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <div class="top-strip"></div>

  <div class="sidebar">
    <div class="brand">
      <div class="brand-icon">💳</div>
      <div>
        <div class="brand-title">Ethio-Pay</div>
        <div class="brand-sub">Sandbox v1.0.0 Hub</div>
      </div>
    </div>

    <ul class="nav-list">
      <li class="nav-item active">
        <span>📊 Overview</span>
      </li>
      <li class="nav-item">
        <span>💳 Active Orders</span>
        <span class="nav-pill">${transactionsList.length}</span>
      </li>
      <li class="nav-item">
        <span>📜 Webhook Stream</span>
        <span class="nav-pill">${this.webhookLogs.length}</span>
      </li>
      <li class="nav-item">
        <span>🛡️ Security Attack Lab</span>
      </li>
      <li class="nav-item">
        <span>📱 SMS & OTP Engine</span>
      </li>
    </ul>

    <div class="sidebar-footer">
      <div style="color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px;">Live Webhook Target</div>
      <div style="color: #fff; font-family: 'JetBrains Mono', monospace; font-size: 11px; word-break: break-all;">${this.targetUrl}</div>
      <div style="margin-top: 10px; font-size: 11px; color: var(--muted);">Secret: <code>${this.secretHash}</code></div>
    </div>
  </div>

  <div class="main">
    <div class="header-bar">
      <div>
        <h1 class="page-title">Developer Webhook Simulator</h1>
        <div class="page-subtitle">Test multi-rail checkouts, inspect cryptographic signatures, and simulate provider outages offline.</div>
      </div>
      <div class="live-status-badge">
        <span class="pulse-dot"></span>
        <span>Gateway Operational (Port ${this.port})</span>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Active Orders</div>
        <div class="stat-value">${transactionsList.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Webhooks Dispatched</div>
        <div class="stat-value">${this.webhookLogs.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Delivery Success</div>
        <div class="stat-value" style="color: var(--emerald);">
          ${this.webhookLogs.length > 0 ? Math.round((this.webhookLogs.filter((l) => l.responseStatus === 200).length / this.webhookLogs.length) * 100) : 100}%
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Simulated Rails</div>
        <div class="stat-value" style="color: var(--primary);">6 + 3 SMS</div>
      </div>
    </div>

    <div class="rails-bar">
      <div class="rail-item"><span class="rail-dot" style="background:#10b981;"></span><span style="font-size:12px; font-weight:700;">Chapa</span></div>
      <div class="rail-item"><span class="rail-dot" style="background:#0284c7;"></span><span style="font-size:12px; font-weight:700;">Telebirr</span></div>
      <div class="rail-item"><span class="rail-dot" style="background:#a855f7;"></span><span style="font-size:12px; font-weight:700;">CBE Birr</span></div>
      <div class="rail-item"><span class="rail-dot" style="background:#6366f1;"></span><span style="font-size:12px; font-weight:700;">ArifPay</span></div>
      <div class="rail-item"><span class="rail-dot" style="background:#0d9488;"></span><span style="font-size:12px; font-weight:700;">SantimPay</span></div>
      <div class="rail-item"><span class="rail-dot" style="background:#f43f5e;"></span><span style="font-size:12px; font-weight:700;">Awash Birr</span></div>
    </div>

    <div class="content-layout">
      <div>
        <div class="card-panel">
          <div class="panel-header">
            <div class="panel-title">Active Orders in Simulator Cache</div>
            <span style="font-size: 12px; color: var(--muted);">Orders initialized via Ethio-Pay SDK</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Order Reference</th>
                <th>Provider Rail</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Webhook Action</th>
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
                  <td><span class="tag-provider tag-${(tx.provider || 'chapa').toLowerCase()}">${(tx.provider || 'chapa').toUpperCase()}</span></td>
                  <td>${tx.amount} ${tx.currency}</td>
                  <td><span style="color: ${tx.status === 'SUCCEEDED' ? 'var(--emerald)' : tx.status === 'FAILED' ? 'var(--rose)' : 'var(--primary)'}; font-weight: 700;">${tx.status}</span></td>
                  <td>
                    <button class="btn btn-green" onclick="triggerManual('${tx.reference}', 'SUCCEEDED')">⚡ Trigger Success</button>
                  </td>
                </tr>
              `
                      )
                      .join('')
                  : `<tr><td colspan="5" style="color: var(--muted); text-align: center; padding: 36px;">No orders in cache yet. Initiate a checkout from your store to test.</td></tr>`
              }
            </tbody>
          </table>
        </div>

        <div class="card-panel">
          <div class="panel-header">
            <div class="panel-title">Real-time Webhook Delivery Log</div>
            <span style="font-size: 12px; color: var(--muted);">Cryptographically signed events</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Reference</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${
                this.webhookLogs.length > 0
                  ? this.webhookLogs
                      .slice(0, 6)
                      .map(
                        (log) => `
                <tr>
                  <td>${new Date(log.timestamp).toLocaleTimeString()}</td>
                  <td>${log.reference}</td>
                  <td><span style="color: ${log.responseStatus === 200 ? 'var(--emerald)' : 'var(--rose)'}; font-weight: 700;">HTTP ${log.responseStatus} (${log.executionTimeMs || 12}ms)</span></td>
                  <td>
                    <button class="btn btn-replay" onclick="replayLog('${log.id}')">🔄 Replay</button>
                  </td>
                </tr>
              `
                      )
                      .join('')
                  : `<tr><td colspan="4" style="color: var(--muted); text-align: center; padding: 36px;">No webhooks dispatched yet.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div class="card-panel">
          <div class="panel-header">
            <div class="panel-title">🛡️ Security Attack Lab</div>
          </div>
          <p style="font-size: 13px; color: var(--muted); margin-bottom: 20px;">
            Verify that your backend rejects forged signatures and gracefully survives network timeouts.
          </p>

          <div class="attack-card">
            <div class="attack-title">1. Signature Tampering (MITM)</div>
            <div class="attack-desc">Dispatches webhook with a forged HMAC-SHA256 signature hash. Merchant app must return HTTP 400.</div>
            <button class="btn btn-blue" style="width: 100%; justify-content: center;" onclick="triggerAttack(true)">🚀 Test Forged Signature</button>
          </div>

          <div class="attack-card">
            <div class="attack-title">2. Timeout Injection (3,000ms)</div>
            <div class="attack-desc">Simulates network lag to verify your backend timeout and async queue handling.</div>
            <button class="btn btn-blue" style="width: 100%; justify-content: center;" onclick="triggerAttack(false, 3000)">⏳ Inject 3,000ms Latency</button>
          </div>
        </div>

        <div class="card-panel">
          <div class="panel-header">
            <div class="panel-title">📱 Unified SMS & OTP Console</div>
          </div>
          <p style="font-size: 13px; color: var(--muted); margin-bottom: 16px;">
            Simulate AfroMessage, GeeZ SMS, and Ethio Telecom OTP deliveries.
          </p>
          <div style="margin-bottom: 14px;">
            <label style="display: block; font-size: 12px; color: var(--muted); margin-bottom: 6px;">Customer Phone Number</label>
            <input type="text" id="sms-phone" value="0911234567" style="width: 100%; background: #090e1a; border: 1px solid var(--card-border); border-radius: 10px; padding: 12px; color: #fff; font-family: 'JetBrains Mono', monospace;" />
          </div>
          <button class="btn btn-green" style="width: 100%; justify-content: center; padding: 12px;" onclick="testSms()">📱 Dispatch Test SMS OTP</button>
        </div>
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

    async function triggerAttack(tamper, delayMs = 0) {
      const res = await fetch('/api/trigger-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reference: 'ATTACK-' + Date.now(),
          status: 'SUCCEEDED',
          tamperSignature: tamper,
          delayMs: delayMs
        })
      });
      const data = await res.json();
      alert('Attack webhook dispatched! Your server responded: HTTP ' + data.responseStatus);
      window.location.reload();
    }

    async function testSms() {
      const phone = document.getElementById('sms-phone').value;
      alert('Simulated SMS successfully dispatched to ' + phone + ' via Ethiopian SMS Infrastructure!');
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
