export interface SendSmsRequest {
  to: string;
  message: string;
  senderId?: string;
  templateId?: string;
}

export interface SendSmsResult {
  success: boolean;
  messageId: string;
  provider: string;
  raw: unknown;
}

export interface SmsProvider {
  readonly name: string;
  send(req: SendSmsRequest): Promise<SendSmsResult>;
}

export interface EthiopianSmsOptions {
  providers: SmsProvider[];
  defaultSenderId?: string;
}

export interface SendOtpOptions {
  length?: number;
  ttlSeconds?: number;
  template?: string; // e.g. "Your verification code is {code}. Valid for 5 minutes."
  senderId?: string;
}

export interface SendOtpResult {
  success: boolean;
  phone: string;
  provider: string;
  messageId: string;
  expiresAt: number;
}

