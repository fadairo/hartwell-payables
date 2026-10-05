/**
 * ─────────────────────────────────────────────────────────────────────────
 *  YOUR INTEGRATION GOES HERE.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The agent (src/agent.ts) calls these three functions around every payment.
 * As shipped, they let everything through: the agent asks nobody and pays
 * whatever the invoice says. That is Hartwell today.
 *
 * Replace the bodies with calls to mnd8t using @mnd8t/sdk. INTEGRATION.md
 * walks through it. You should not need to touch any other file; if you do,
 * that is worth noting as integration friction.
 *
 * Contract with the agent:
 *
 *   authorise(p)          before any money moves: may the agent make this payment?
 *   execute(a, p, pay)    after APPROVED: pay through the bank and report the outcome
 *   checkEscalation(id)   for invoices waiting on a human: has anyone decided?
 *
 * Use log("mnd8t", ...) from ./store.js to see your calls in the activity feed.
 */
import type { PaymentInstruction } from "./domain.js";
import { log } from "./store.js";

export type Authority =
  /** No authority check happened (not integrated). The agent pays directly. */
  | { kind: "unchecked" }
  /** Within the mandate. `artifactId` is the single-use authorisation to pay with. */
  | { kind: "approved"; decisionId: string; artifactId: string; reasons: string[]; recordUrl?: string }
  /** A human must decide. Get `approvalUrl` in front of the approver. */
  | { kind: "escalated"; decisionId: string; approvalUrl: string; reasons: string[] }
  /** Outside the mandate. The agent must not pay. */
  | { kind: "refused"; decisionId: string; reasons: string[] }
  /** Still waiting on a human (from checkEscalation). */
  | { kind: "pending"; decisionId: string }
  /** Shadow mode: nothing enforced. The agent pays; `wouldDecide` is what enforcement would have said. */
  | { kind: "observed"; decisionId: string; wouldDecide: string; reasons: string[] };

/** Shown in the app's header. Change it when you are integrated. */
export const integrationStatus = "not integrated: the agent pays every invoice unchecked";

/**
 * Step 1 — ask for authority before paying.
 *
 * TODO(mnd8t): call mnd8t with this payment and map the answer to an Authority.
 */
export async function authorise(p: PaymentInstruction): Promise<Authority> {
  void p;
  return { kind: "unchecked" };
}

/**
 * Step 2 — pay with the authority you were given.
 *
 * TODO(mnd8t): before calling pay(): fetch and verify the artifact, then claim
 * it. After: confirm success, or report failure if pay() throws. Return the
 * bank reference.
 */
export async function execute(
  a: Extract<Authority, { kind: "approved" }>,
  p: PaymentInstruction,
  pay: (p: PaymentInstruction) => Promise<string>,
): Promise<string> {
  log("mnd8t", "execute() is not implemented yet: paying without using the artifact", { invoice: p.invoiceNumber });
  void a;
  return pay(p);
}

/**
 * Step 3 — has the approver decided?
 *
 * TODO(mnd8t): look the decision up and return approved (with the artifact),
 * refused, or still pending.
 */
export async function checkEscalation(decisionId: string): Promise<Authority> {
  return { kind: "pending", decisionId };
}
