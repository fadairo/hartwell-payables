/**
 * Hartwell's payment provider (simulated). In real life this is your bank's
 * payments API, holding credentials that never leave Hartwell. It pays
 * whatever it is told to, to whatever account it is given: deciding whether a
 * payment SHOULD happen is not its job.
 */
import type { PaymentInstruction } from "./domain.js";
import { gbp } from "./domain.js";
import { log, store } from "./store.js";

export class BankRejected extends Error {}

export async function pay(p: PaymentInstruction): Promise<string> {
  await new Promise((r) => setTimeout(r, 300));
  if (store.bankOutage) {
    log("bank", `REJECTED ${gbp(p.amountPence)} to ${p.payTo} (provider outage)`, { invoice: p.invoiceNumber });
    throw new BankRejected("provider outage");
  }
  const ref = `FPS-${Date.now().toString(36).toUpperCase()}`;
  store.payments.push({
    ref,
    invoiceNumber: p.invoiceNumber,
    supplierId: p.supplierId,
    payTo: p.payTo,
    amountPence: p.amountPence,
    at: new Date().toISOString(),
  });
  log("bank", `paid ${gbp(p.amountPence)} to ${p.payTo} (${ref})`, { invoice: p.invoiceNumber });
  return ref;
}
