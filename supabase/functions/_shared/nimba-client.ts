// Lightweight Deno client for the Nimba SMS REST API.
//
// Auth: HTTP Basic with `SERVICE_ID:SECRET_TOKEN`.
// Base URL: https://api.nimbasms.com/v1
// Docs: https://developers.nimbasms.com

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
const MAX_RECIPIENTS_PER_REQUEST = 50;

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
    if (!options.serviceId || !options.secretToken) {
      throw new NimbaSMSError(
        "Missing Nimba SMS credentials (serviceId / secretToken)",
        { code: "missing_credentials" },
      );
    }
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.authHeader = `Basic ${
      btoa(`${options.serviceId}:${options.secretToken}`)
    }`;
    this.defaultSender = options.defaultSender;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  // Read credentials from Deno env. Safe to call from any Edge Function.
  static fromEnv(): NimbaSMSClient {
    return new NimbaSMSClient({
      serviceId: Deno.env.get("NIMBA_SERVICE_ID") ?? "",
      secretToken: Deno.env.get("NIMBA_SECRET_TOKEN") ?? "",
      baseUrl: Deno.env.get("NIMBA_API_BASE_URL") ?? undefined,
      defaultSender: Deno.env.get("NIMBA_DEFAULT_SENDER") ?? undefined,
      timeoutMs: Number(Deno.env.get("NIMBA_TIMEOUT_MS")) || undefined,
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Public API
  // ───────────────────────────────────────────────────────────────────────

  async sendMessage(
    input: SendMessageInput,
  ): Promise<NimbaSendMessageResponse> {
    const recipients = this.normalizeRecipients(input.to);
    if (recipients.length === 0) {
      throw new NimbaSMSError("At least one recipient is required", {
        code: "invalid_recipient",
      });
    }
    if (recipients.length > MAX_RECIPIENTS_PER_REQUEST) {
      throw new NimbaSMSError(
        `Nimba SMS accepts up to ${MAX_RECIPIENTS_PER_REQUEST} recipients per request; use sendCampaign() for larger broadcasts`,
        { code: "too_many_recipients" },
      );
    }
    const message = (input.message ?? "").toString().trim();
    if (!message) {
      throw new NimbaSMSError("Message body is required", {
        code: "invalid_message",
      });
    }

    const sender_name = input.senderName ?? this.defaultSender;
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

  // Splits a large recipient list into chunks of ≤50 and sends them sequentially.
  // Returns one response per chunk in the order they were sent. This is the
  // pragmatic replacement for "campaigns" since the Nimba REST API does not
  // expose a dedicated campaign endpoint.
  async sendCampaign(input: {
    recipients: string[];
    message: string;
    senderName?: string;
    chunkSize?: number;
  }): Promise<NimbaSendMessageResponse[]> {
    const chunkSize = Math.min(
      Math.max(1, input.chunkSize ?? MAX_RECIPIENTS_PER_REQUEST),
      MAX_RECIPIENTS_PER_REQUEST,
    );
    const all = this.normalizeRecipients(input.recipients);
    const out: NimbaSendMessageResponse[] = [];
    for (let i = 0; i < all.length; i += chunkSize) {
      const slice = all.slice(i, i + chunkSize);
      const resp = await this.sendMessage({
        to: slice,
        message: input.message,
        senderName: input.senderName,
      });
      out.push(resp);
    }
    return out;
  }

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
  // Internals
  // ───────────────────────────────────────────────────────────────────────

  private normalizeRecipients(input: string | string[]): string[] {
    const arr = Array.isArray(input) ? input : [input];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of arr) {
      const formatted = formatGuineanNumber(raw);
      if (formatted && !seen.has(formatted)) {
        seen.add(formatted);
        out.push(formatted);
      }
    }
    return out;
  }

  private async request<T>(
    method: "GET" | "POST",
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

// Strip whitespace, dashes, dots, parentheses; keep digits and a single
// leading `+`. If the result is a bare local Guinean number (8–9 digits, no
// country code), prepend the Guinea country code (+224).
export function formatGuineanNumber(raw: string): string {
  if (!raw) return "";
  const trimmed = raw.toString().trim();
  // Keep digits and an optional leading '+'.
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return "";

  if (hasPlus) {
    return `+${digits}`;
  }
  // Already includes the 224 country code without `+` — normalize to E.164.
  if (digits.startsWith("224") && digits.length >= 11) {
    return `+${digits}`;
  }
  // Bare local Guinean number (8 or 9 digits) → prepend +224.
  if (digits.length === 8 || digits.length === 9) {
    return `+224${digits}`;
  }
  // Anything else: assume the caller knows what they're doing and pass through
  // as E.164 (the Nimba API accepts 8–18 digits).
  return `+${digits}`;
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
