/**
 * Hartwell's accounts-payable agent. A stand-in for an LLM agent: it reads
 * each invoice, turns it into a payment instruction, and pays it. It is
 * deliberately credulous. It trusts the amount, the purpose and the bank
 * details printed on the invoice, and it does not notice duplicates. Deciding
 * what it may do is not the agent's job; that is what the integration adds.
 */
import { BankRejected, pay } from "./bank.js";
import { gbp, supplier, type Invoice, type PaymentInstruction } from "./domain.js";
import { authorise, checkEscalation, execute, type Authority } from "./mnd8t.js";
import { log, store } from "./store.js";

function instructionFor(inv: Invoice): PaymentInstruction {
  return {
    invoiceId: inv.id,
    invoiceNumber: inv.number,
    supplierId: inv.supplierId,
    supplierName: supplier(inv.supplierId).name,
    payTo: inv.payTo,
    amountPence: inv.amountPence,
    currency: "GBP",
    purpose: inv.purpose,
  };
}

function record(inv: Invoice, a: Authority): void {
  if (a.kind === "unchecked") return;
  inv.authority = {
    ...inv.authority,
    decisionId: a.decisionId,
    decision: a.kind === "observed" ? `OBSERVE (would ${a.wouldDecide})` : a.kind.toUpperCase(),
    ...("reasons" in a ? { reasons: a.reasons } : {}),
    ...(a.kind === "escalated" ? { approvalUrl: a.approvalUrl } : {}),
    ...(a.kind === "approved" && a.recordUrl ? { recordUrl: a.recordUrl } : {}),
  };
}

async function payDirect(inv: Invoice, p: PaymentInstruction): Promise<void> {
  inv.paymentRef = await pay(p);
  inv.status = "PAID";
}

/** Act on an authority answer. Shared by new invoices and resolved escalations. */
async function act(inv: Invoice, p: PaymentInstruction, a: Authority): Promise<void> {
  record(inv, a);
  switch (a.kind) {
    case "unchecked":
      log("agent", `no authority check: paying ${gbp(p.amountPence)} to ${p.payTo}`, { invoice: inv.number });
      await payDirect(inv, p);
      inv.outcome = "Paid unchecked";
      return;
    case "observed":
      log("agent", `shadow mode (mnd8t would ${a.wouldDecide}): paying anyway`, { invoice: inv.number });
      await payDirect(inv, p);
      inv.outcome = `Paid; mnd8t would have said ${a.wouldDecide}`;
      return;
    case "approved":
      log("agent", `authorised: paying ${gbp(p.amountPence)}`, { invoice: inv.number });
      inv.paymentRef = await execute(a, p, pay);
      inv.status = "PAID";
      inv.outcome = "Paid under the mandate";
      return;
    case "escalated":
      inv.status = "AWAITING_APPROVAL";
      inv.outcome = `Waiting for a human: ${a.reasons.join(", ")}`;
      log("agent", "needs a human; holding the payment", { invoice: inv.number });
      return;
    case "pending":
      return;
    case "refused":
      inv.status = "BLOCKED";
      inv.outcome = `Refused: ${a.reasons.join(", ")}`;
      log("agent", "refused; not paying", { invoice: inv.number });
      return;
  }
}

function fail(inv: Invoice, err: unknown): void {
  inv.status = "FAILED";
  const message = err instanceof Error ? err.message : String(err);
  inv.outcome = err instanceof BankRejected ? `Bank rejected: ${message}` : `Error: ${message}`;
  log("agent", inv.outcome, { invoice: inv.number, detail: err instanceof Error ? err.stack : err });
}

let running = false;

/** One pass: work the inbox, then re-check anything waiting on a human. */
export async function runOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const inv of store.invoices.filter((i) => i.status === "INBOX")) {
      inv.status = "PROCESSING";
      const p = instructionFor(inv);
      log("agent", `read invoice: ${gbp(p.amountPence)} to ${p.supplierName} for ${p.purpose}`, { invoice: inv.number });
      try {
        await act(inv, p, await authorise(p));
      } catch (err) {
        fail(inv, err);
      }
    }
    for (const inv of store.invoices.filter((i) => i.status === "AWAITING_APPROVAL")) {
      const decisionId = inv.authority?.decisionId;
      if (!decisionId) continue;
      try {
        const a = await checkEscalation(decisionId);
        if (a.kind !== "pending") {
          log("agent", `approver decided: ${a.kind}`, { invoice: inv.number });
          await act(inv, instructionFor(inv), a);
        }
      } catch (err) {
        fail(inv, err);
      }
    }
  } finally {
    running = false;
  }
}

setInterval(() => {
  if (store.agentAuto) void runOnce();
}, 3000);
