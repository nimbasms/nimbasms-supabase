// Lightweight Deno client for the Nimba SMS REST API.
//
// Auth: HTTP Basic with `ACCOUNT_SID:AUTH_TOKEN`.
//   (Aliases on the dashboard: ACCOUNT_SID = SERVICE_ID, AUTH_TOKEN = SECRET_TOKEN.)
// Base URL: https://api.nimbasms.com/v1
// Docs:     https://developers.nimbasms.com

import type {
  NimbaBalanceResponse,
  NimbaClientOptions,
  NimbaMessage,
  NimbaPaginated,
  NimbaSendMessageResponse,
  NimbaSenderName,
  SendMessageInput,
} from "./types.ts";

const DEFAULT_BASE_URL = "https://api.nimbasms.com/v1";
const DEFAULT_TIMEOUT_MS = 10_000;
export const MAX_RECIPIENTS_PER_REQUEST = 50;

export class NimbaSMSError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly code: string;

  constructor(
    message: string,
    options: { status?: number; body?: unknown; code?: string } = {},
  ) {
    super(message);
    this.name = "NimbaSMSError";
    this.status = options.status ?? 0;
    this.body = options.body;
    this.code = options.code ?? "nimba_error";
  }
}

export class NimbaSMSClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly defaultSender?: string;
  private readonly timeoutMs: number;

  constructor(options: NimbaClientOptions) {
    if (!options.accountSid || !options.authToken) {
      throw new NimbaSMSError(
        "Missing Nimba SMS credentials (accountSid / authToken)",
        { code: "missing_credentials" },
      );
    }
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.authHeader = `Basic ${
      btoa(`${options.accountSid}:${options.authToken}`)
    }`;
    this.defaultSender = options.defaultSender;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  // Read credentials from Deno env. Safe to call from any Edge Function.
  static fromEnv(): NimbaSMSClient {
    return new NimbaSMSClient({
      accountSid: Deno.env.get("NIMBA_ACCOUNT_SID") ?? "",
      authToken: Deno.env.get("NIMBA_AUTH_TOKEN") ?? "",
      baseUrl: Deno.env.get("NIMBA_API_BASE_URL") ?? undefined,
      defaultSender: Deno.env.get("NIMBA_DEFAULT_SENDER") ?? undefined,
      timeoutMs: Number(Deno.env.get("NIMBA_TIMEOUT_MS")) || undefined,
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Messages
  // ───────────────────────────────────────────────────────────────────────

  // `to` is always an array (matching the wire contract — POST /v1/messages
  // accepts a `to` array of 1..50 recipients in every call).
  async sendMessage(
    input: SendMessageInput,
  ): Promise<NimbaSendMessageResponse> {
    if (!Array.isArray(input.to)) {
      throw new NimbaSMSError("`to` must be an array of phone numbers", {
        code: "invalid_argument",
      });
    }
    const recipients = this.normalizeRecipients(input.to);
    if (recipients.length === 0) {
      throw new NimbaSMSError("At least one recipient is required", {
        code: "invalid_recipient",
      });
    }
    if (recipients.length > MAX_RECIPIENTS_PER_REQUEST) {
      throw new NimbaSMSError(
        `Nimba SMS accepts up to ${MAX_RECIPIENTS_PER_REQUEST} recipients per request; split your list into chunks`,
        { code: "too_many_recipients" },
      );
    }
    const message = (input.message ?? "").toString().trim();
    if (!message) {
      throw new NimbaSMSError("Message body is required", {
        code: "invalid_message",
      });
    }
    const sender_name = (input.senderName ?? this.defaultSender ?? "").trim();
    if (!sender_name) {
      throw new NimbaSMSError(
        "sender_name is required (pass it explicitly or set NIMBA_DEFAULT_SENDER)",
        { code: "missing_sender" },
      );
    }

    return await this.request<NimbaSendMessageResponse>(
      "POST",
      "/messages",
      { sender_name, to: recipients, message },
    );
  }

  async listMessages(
    params: {
      limit?: number;
      offset?: number;
      search?: string;
      status?: string;
    } = {},
  ): Promise<NimbaPaginated<NimbaMessage>> {
    const qs = new URLSearchParams();
    if (params.limit !== undefined) qs.set("limit", String(params.limit));
    if (params.offset !== undefined) qs.set("offset", String(params.offset));
    if (params.search) qs.set("search", params.search);
    if (params.status) qs.set("status", params.status);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return await this.request<NimbaPaginated<NimbaMessage>>(
      "GET",
      `/messages${suffix}`,
    );
  }

  async getMessage(messageId: string): Promise<NimbaMessage> {
    if (!messageId) {
      throw new NimbaSMSError("messageId is required", {
        code: "invalid_argument",
      });
    }
    return await this.request<NimbaMessage>(
      "GET",
      `/messages/${encodeURIComponent(messageId)}`,
    );
  }

  // ───────────────────────────────────────────────────────────────────────
  // Account
  // ───────────────────────────────────────────────────────────────────────

  async getBalance(): Promise<NimbaBalanceResponse> {
    return await this.request<NimbaBalanceResponse>("GET", "/accounts");
  }

  async getSenderNames(
    params: { limit?: number; offset?: number } = {},
  ): Promise<NimbaPaginated<NimbaSenderName>> {
    const qs = new URLSearchParams();
    if (params.limit !== undefined) qs.set("limit", String(params.limit));
    if (params.offset !== undefined) qs.set("offset", String(params.offset));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return await this.request<NimbaPaginated<NimbaSenderName>>(
      "GET",
      `/sendernames${suffix}`,
    );
  }

  // ───────────────────────────────────────────────────────────────────────
  // Contacts
  // ───────────────────────────────────────────────────────────────────────

  async listContacts(
    params: { limit?: number; offset?: number; search?: string } = {},
  ): Promise<NimbaPaginated<NimbaContact>> {
    const qs = new URLSearchParams();
    if (params.limit !== undefined) qs.set("limit", String(params.limit));
    if (params.offset !== undefined) qs.set("offset", String(params.offset));
    if (params.search) qs.set("search", params.search);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return await this.request<NimbaPaginated<NimbaContact>>(
      "GET",
      `/contacts${suffix}`,
    );
  }

  // ───────────────────────────────────────────────────────────────────────
  // Managed OTP (verifications)
  //
  // Nimba SMS hosts an end-to-end OTP service: it generates the code, sends
  // the SMS, stores the code with TTL + attempts, and exposes a PATCH endpoint
  // to verify the code submitted by the user. The flow is two-call:
  //
  //   1) POST /v1/verifications        → returns { verificationid, ... }
  //   2) PATCH /v1/verifications/{id}  → submits { code } → returns { status }
  //
  // `status: "approved"` means the code was correct.
  // ───────────────────────────────────────────────────────────────────────

  async createVerification(
    input: {
      to: string;
      senderName?: string;
      message?: string;
      expiryTime?: number;
      attempts?: number;
      codeLength?: number;
      channel?: "sms" | "whatsapp" | "email";
      language?: "fr" | "en_US";
    },
  ): Promise<NimbaVerificationCreateResponse> {
    const to = formatGuineanNumber(input.to);
    if (!to) {
      throw new NimbaSMSError("`to` is required", { code: "invalid_argument" });
    }
    const sender_name = (input.senderName ?? this.defaultSender ?? "").trim();
    if (!sender_name) {
      throw new NimbaSMSError(
        "sender_name is required (pass it explicitly or set NIMBA_DEFAULT_SENDER)",
        { code: "missing_sender" },
      );
    }
    if (input.message && !input.message.includes("<1234>")) {
      throw new NimbaSMSError(
        "`message` must contain the `<1234>` placeholder so Nimba can inject the code",
        { code: "invalid_message_template" },
      );
    }
    if (
      input.expiryTime !== undefined &&
      (input.expiryTime < 5 || input.expiryTime > 30)
    ) {
      throw new NimbaSMSError("`expiryTime` must be between 5 and 30 minutes", {
        code: "invalid_expiry_time",
      });
    }
    if (
      input.attempts !== undefined &&
      (input.attempts < 3 || input.attempts > 10)
    ) {
      throw new NimbaSMSError("`attempts` must be between 3 and 10", {
        code: "invalid_attempts",
      });
    }
    if (
      input.codeLength !== undefined &&
      (input.codeLength < 4 || input.codeLength > 8)
    ) {
      throw new NimbaSMSError("`codeLength` must be between 4 and 8", {
        code: "invalid_code_length",
      });
    }

    const body: Record<string, unknown> = { to, sender_name };
    if (input.message) body.message = input.message;
    if (input.expiryTime !== undefined) body.expiry_time = input.expiryTime;
    if (input.attempts !== undefined) body.attempts = input.attempts;
    if (input.codeLength !== undefined) body.code_length = input.codeLength;
    if (input.channel) body.channel = input.channel;
    if (input.language) body.language = input.language;

    return await this.request<NimbaVerificationCreateResponse>(
      "POST",
      "/verifications",
      body,
    );
  }

  async checkVerification(
    input: { verificationId: string; code: number | string },
  ): Promise<NimbaVerificationCheckResponse> {
    if (!input.verificationId) {
      throw new NimbaSMSError("verificationId is required", {
        code: "invalid_argument",
      });
    }
    const code = typeof input.code === "string"
      ? Number.parseInt(input.code, 10)
      : input.code;
    if (!Number.isFinite(code)) {
      throw new NimbaSMSError("`code` must be a numeric value", {
        code: "invalid_code",
      });
    }
    return await this.request<NimbaVerificationCheckResponse>(
      "PATCH",
      `/verifications/${encodeURIComponent(input.verificationId)}`,
      { code },
    );
  }

  async createContact(
    input: { numero: string; name?: string; groups?: string[] },
  ): Promise<NimbaContact> {
    const numero = formatGuineanNumber(input.numero);
    if (!numero) {
      throw new NimbaSMSError("`numero` is required", {
        code: "invalid_argument",
      });
    }
    const body: Record<string, unknown> = { numero };
    if (input.name) body.name = input.name;
    if (input.groups) body.groups = input.groups;
    return await this.request<NimbaContact>("POST", "/contacts", body);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────────────

  private normalizeRecipients(input: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of input) {
      const formatted = formatGuineanNumber(raw);
      if (formatted && !seen.has(formatted)) {
        seen.add(formatted);
        out.push(formatted);
      }
    }
    return out;
  }

  private async request<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          "Authorization": this.authHeader,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      const text = await res.text();
      const parsed: unknown = text ? safeJsonParse(text) : null;

      if (!res.ok) {
        throw new NimbaSMSError(
          extractErrorMessage(parsed) ?? `Nimba API ${res.status}`,
          { status: res.status, body: parsed, code: `http_${res.status}` },
        );
      }
      return parsed as T;
    } catch (err) {
      if (err instanceof NimbaSMSError) throw err;
      if ((err as Error).name === "AbortError") {
        throw new NimbaSMSError(
          `Nimba API request timed out after ${this.timeoutMs}ms`,
          { code: "timeout" },
        );
      }
      throw new NimbaSMSError(
        `Network error calling Nimba API: ${(err as Error).message}`,
        { code: "network_error" },
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Phone number formatting
// ───────────────────────────────────────────────────────────────────────────

// Nimba SMS expects bare digits with country code (e.g. `224623000000`).
// This helper strips separators and a leading `+`, then prepends `224` if
// the caller passed a local Guinean number (8–9 digits, no country code).
export function formatGuineanNumber(raw: string): string {
  if (!raw) return "";
  const digits = String(raw).replace(/[^\d]/g, "");
  if (!digits) return "";
  // Local format (no country code) → assume Guinea (224).
  if ((digits.length === 8 || digits.length === 9) && !digits.startsWith("224")) {
    return `224${digits}`;
  }
  return digits;
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  if (typeof b.detail === "string") return b.detail;
  if (typeof b.message === "string") return b.message;
  if (typeof b.error === "string") return b.error;
  return undefined;
}

// ───────────────────────────────────────────────────────────────────────────
// Re-exported / local types
// ───────────────────────────────────────────────────────────────────────────

interface NimbaContact {
  numero: string;
  name?: string;
  groups?: string[];
  [key: string]: unknown;
}

export interface NimbaVerificationCreateResponse {
  verificationid: string;
  message_cost?: number;
  url?: string;
  [key: string]: unknown;
}

// Verification check status vocabulary, from the official OpenAPI spec.
// Reference: https://developers.nimbasms.com (Verifications / Vérification de la demande)
export type NimbaVerificationStatus =
  | "pending"
  | "sent"
  | "expired"
  | "failure"
  | "received"
  | "too_many_attemps"
  | "approved"
  | "read";

export interface NimbaVerificationCheckResponse {
  status: NimbaVerificationStatus;
  [key: string]: unknown;
}
