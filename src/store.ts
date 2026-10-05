/**
 * In-memory state for the app, plus the activity log the UI shows. Restarting
 * the server or pressing Reset clears it.
 */
import type { Invoice } from "./domain.js";

export type LogSource = "inbox" | "agent" | "bank" | "mnd8t" | "approver" | "system";

export interface LogEntry {
  at: string;
  source: LogSource;
  invoice?: string;
  message: string;
  detail?: unknown;
}

export interface Payment {
  ref: string;
  invoiceNumber: string;
  supplierId: string;
  payTo: string;
  amountPence: number;
  at: string;
}

export const store = {
  invoices: [] as Invoice[],
  payments: [] as Payment[],
  log: [] as LogEntry[],
  agentAuto: false,
  bankOutage: false,
};

let seq = 0;
export function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq}`;
}

/**
 * Write to the activity log shown in the UI. Your integration should call
 * this too, so you can watch every mnd8t call as it happens:
 *
 *   log("mnd8t", "decision APPROVE", { invoice: inv.number, detail: response })
 */
export function log(source: LogSource, message: string, opts: { invoice?: string; detail?: unknown } = {}): void {
  store.log.push({ at: new Date().toISOString(), source, message, ...opts });
  if (store.log.length > 500) store.log.splice(0, store.log.length - 500);
  const tag = source.padEnd(8);
  console.log(`${tag} ${opts.invoice ? `[${opts.invoice}] ` : ""}${message}`);
}

export function reset(): void {
  store.invoices = [];
  store.payments = [];
  store.log = [];
  log("system", "reset");
}
