// Shared TypeScript types for the Nimba SMS Supabase integration.
// Mirrors the upstream Nimba SMS REST API (https://api.nimbasms.com/v1).

export interface NimbaClientOptions {
  serviceId: string;
  secretToken: string;
  baseUrl?: string;
  defaultSender?: string;
  timeoutMs?: number;
}

export interface SendMessageInput {
  to: string | string[];
  message: string;
  senderName?: string;
}

export interface NimbaSendMessageResponse {
  // The API returns the created message identifier under `messageid`
  // (single word, lowercase) — see the upstream webhook contract.
  messageid?: string;
  // Some responses include a top-level `status` field.
  status?: string;
  // Free-form fields the API may include.
  [key: string]: unknown;
}

export interface NimbaBalanceResponse {
  balance?: number;
  sms?: number;
  [key: string]: unknown;
}

export interface NimbaSenderName {
  name: string;
  status: "accepted" | "pending" | "rejected" | string;
}

export interface NimbaPaginated<T> {
  count?: number;
  next?: string | null;
  previous?: string | null;
  results: T[];
}

export interface NimbaMessage {
  messageid: string;
  contact: string;
  message: string;
  sender_name?: string;
  status: string;
  [key: string]: unknown;
}

// Inbound webhook payload posted by Nimba SMS when a delivery status changes.
// Reference: nimbasms-odoo/controllers/webhook.py
export interface NimbaWebhookPayload {
  messageid: string;
  contact: string;
  status: "received" | "failed" | string;
  error?: string;
  metadata?: Record<string, unknown>;
}

// Internal representation persisted in `sms_logs.status`.
export type SmsLogStatus = "pending" | "sent" | "delivered" | "failed";
