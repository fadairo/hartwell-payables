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
import { MandateClient } from "@mnd8t/sdk";
import type { AuthorizeResponse } from "@mnd8t/sdk";
import type { PaymentInstruction } from "./domain.js";
import { archiveDecisionReceipts } from "./receipt-archive.js";
import { log } from "./store.js";

let client: MandateClient | undefined;

function mandateClient(): MandateClient {
  if (client) return client;
  const apiKey = process.env.MANDATE_AGENT_KEY;
  const baseUrl = process.env.MANDATE_API_URL;
  if (!apiKey || !baseUrl) {
    throw new Error(
      "mnd8t is not configured: set MANDATE_AGENT_KEY and MANDATE_API_URL in .env",
    );
  }
  client = new MandateClient({ apiKey, baseUrl });
  return client;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function detailString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

async function archiveReceiptsBestEffort(
  decisionId: string,
  invoiceNumber: string,
): Promise<void> {
  try {
    const archived = await archiveDecisionReceipts(
      mandateClient(),
      decisionId,
      invoiceNumber,
    );
    log("mnd8t", `archived ${archived.length} signed receipt(s) locally`, {
      invoice: invoiceNumber,
      detail: {
        decisionId,
        receiptIds: archived.map((receipt) => receipt.receiptId),
      },
    });
  } catch (error) {
    log("mnd8t", "could not archive mnd8t receipts locally", {
      invoice: invoiceNumber,
      detail: {
        decisionId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

export type Authority =
  /** No authority check happened (not integrated). The agent pays directly. */
  | { kind: "unchecked" }
  /** Within the mandate. `artifactId` is the single-use authorisation to pay with. */
  | {
      kind: "approved";
      decisionId: string;
      artifactId: string;
      reasons: string[];
      recordUrl?: string;
    }
  /** A human must decide. Get `approvalUrl` in front of the approver. */
  | {
      kind: "escalated";
      decisionId: string;
      approvalUrl: string;
      reasons: string[];
    }
  /** Outside the mandate. The agent must not pay. */
  | { kind: "refused"; decisionId: string; reasons: string[] }
  /** Still waiting on a human (from checkEscalation). */
  | { kind: "pending"; decisionId: string }
  /** Shadow mode: nothing enforced. The agent pays; `wouldDecide` is what enforcement would have said. */
  | {
      kind: "observed";
      decisionId: string;
      wouldDecide: string;
      reasons: string[];
    };

/** Keep the header honest until dashboard setup and runtime credentials exist. */
export const integrationStatus =
  process.env.MANDATE_AGENT_KEY && process.env.MANDATE_API_URL
    ? "live: mnd8t enforces Hartwell's payables mandate"
    : "not integrated: mnd8t credentials are not configured";

/**
 * Step 1 — ask for authority before paying.
 *
 * Ask mnd8t for authority before any payment can reach Hartwell's bank.
 */
export async function authorise(p: PaymentInstruction): Promise<Authority> {
  const agentId = process.env.MANDATE_AGENT_ID;
  if (!agentId)
    throw new Error("mnd8t is not configured: set MANDATE_AGENT_ID in .env");

  const result: AuthorizeResponse = await mandateClient().decisions.authorize({
    agent_external_id: agentId,
    external_reference: p.invoiceNumber,
    action_type: "PAYMENT",
    amount: { asset: "GBP", asset_amount_minor: p.amountPence },
    valuation: {
      policy_amount_minor: p.amountPence,
      policy_currency: "GBP",
      source: "HARTWELL_ERP",
    },
    counterparty_external_id: p.supplierId,
    destination: p.payTo,
    purpose: p.purpose,
    // Invoice number is stable across duplicate deliveries; invoiceId is not.
    idempotencyKey: `hartwell-${p.supplierId}-${p.invoiceNumber}`,
  });

  const reasons = result.reason_codes;
  const decisionId = result.id;
  const recordUrl = result.authority_record?.url;
  log(
    "mnd8t",
    `decision ${result.effective_decision}: ${reasons.join(", ") || "no reason codes"}`,
    {
      invoice: p.invoiceNumber,
      detail: { decisionId, mode: result.mode, recordUrl },
    },
  );
  await archiveReceiptsBestEffort(decisionId, p.invoiceNumber);

  switch (result.effective_decision) {
    case "APPROVE": {
      const artifact = result.authorisation_artifact;
      if (!artifact?.id)
        throw new Error(
          `mnd8t approved ${p.invoiceNumber} without an authorisation artifact`,
        );
      return {
        kind: "approved",
        decisionId,
        artifactId: artifact.id,
        reasons,
        recordUrl,
      };
    }
    case "ESCALATE": {
      const approvalUrl = result.approval?.approval_url;
      if (!approvalUrl)
        throw new Error(
          `mnd8t escalated ${p.invoiceNumber} without an approval URL`,
        );
      return { kind: "escalated", decisionId, approvalUrl, reasons };
    }
    case "REJECT":
      return { kind: "refused", decisionId, reasons };
    case "OBSERVE":
      return {
        kind: "observed",
        decisionId,
        wouldDecide: result.would_decide,
        reasons,
      };
  }
}

/**
 * Step 2 — pay with the authority you were given.
 *
 * Verify and claim the single-use artifact before using Hartwell's bank, then
 * report the execution outcome to mnd8t.
 */
export async function execute(
  a: Extract<Authority, { kind: "approved" }>,
  p: PaymentInstruction,
  pay: (p: PaymentInstruction) => Promise<string>,
): Promise<string> {
  const mnd8t = mandateClient();
  const envelope = await mnd8t.artifacts.get(a.artifactId);
  const check = await mnd8t.artifacts.verify(envelope.artifact);
  if (!check.valid) {
    throw new Error(
      `refusing to execute: mnd8t artifact signature is invalid (${check.reason ?? "unknown reason"})`,
    );
  }

  if (
    envelope.status !== "ISSUED" ||
    envelope.decision_intent_id !== a.decisionId
  ) {
    throw new Error(
      "refusing to execute: artifact is not issued for this decision",
    );
  }

  // Purpose is recorded on the decision intent but omitted from the artifact.
  const decision = await mnd8t.decisions.get(a.decisionId);
  const matchesDecision =
    decision.effective_decision === "APPROVE" &&
    decision.asset === "GBP" &&
    decision.asset_amount_minor === p.amountPence &&
    decision.policy_amount_minor === p.amountPence &&
    decision.counterparty_external_id === p.supplierId &&
    decision.destination === p.payTo &&
    decision.purpose === p.purpose &&
    decision.external_reference === p.invoiceNumber;
  if (!matchesDecision) {
    throw new Error(
      "refusing to execute: approved decision does not match the payment instruction",
    );
  }

  // The verified signature binds the execution fields carried by the artifact.
  const artifact = envelope.artifact;
  const matchesPayment =
    artifact.asset === "GBP" &&
    artifact.amount_minor === p.amountPence &&
    artifact.policy_amount_minor === p.amountPence &&
    artifact.destination === p.payTo &&
    artifact.counterparty_reference === p.supplierId &&
    artifact.external_client_reference === p.invoiceNumber;
  if (!matchesPayment)
    throw new Error(
      "refusing to execute: verified artifact does not match the payment instruction",
    );

  await mnd8t.artifacts.claim(a.artifactId, "hartwell-payables-bank-executor");

  let paymentRef: string;
  try {
    paymentRef = await pay(p);
  } catch (error) {
    try {
      await mnd8t.artifacts.fail(a.artifactId, "PROVIDER_REJECTED");
      await archiveReceiptsBestEffort(a.decisionId, p.invoiceNumber);
    } catch (reportError) {
      log("mnd8t", "failed to report bank rejection to mnd8t", {
        invoice: p.invoiceNumber,
        detail:
          reportError instanceof Error
            ? reportError.message
            : String(reportError),
      });
    }
    throw error;
  }

  await mnd8t.decisions.confirm(a.decisionId, {
    provider: "HARTWELL_SIMULATED_BANK",
    external_reference: paymentRef,
    authorisation_artifact_id: a.artifactId,
    reported_by: "CUSTOMER_EXECUTOR",
    verification: { method: "CUSTOMER_ASSERTED", verified: false },
  });
  await archiveReceiptsBestEffort(a.decisionId, p.invoiceNumber);
  log("mnd8t", "bank execution confirmed", {
    invoice: p.invoiceNumber,
    detail: { paymentRef },
  });
  return paymentRef;
}

/**
 * Step 3 — has the approver decided?
 *
 * Look up an escalated decision and return its resolved authority if any.
 */
export async function checkEscalation(decisionId: string): Promise<Authority> {
  const decision = await mandateClient().decisions.get(decisionId);
  const invoiceNumber = detailString(decision.external_reference) ?? decisionId;
  await archiveReceiptsBestEffort(decisionId, invoiceNumber);
  const status = detailString(decision.status)?.toUpperCase();
  const reasons = strings(decision.reason_codes ?? decision.reasons);
  const record = decision.authority_record;
  const recordUrl =
    record && typeof record === "object"
      ? detailString((record as Record<string, unknown>).url)
      : undefined;

  if (status === "REJECTED" || status === "EXPIRED") {
    log("mnd8t", `escalation ${status.toLowerCase()}`, {
      detail: { decisionId, reasons },
    });
    return { kind: "refused", decisionId, reasons };
  }

  if (status === "APPROVED") {
    const artifacts = Array.isArray(decision.artifacts)
      ? decision.artifacts
      : [];
    const issued = artifacts.find((item) => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as Record<string, unknown>;
      return (
        candidate.status === "ISSUED" &&
        (typeof candidate.id === "string" ||
          typeof candidate.artifact_id === "string")
      );
    }) as Record<string, unknown> | undefined;
    const artifactId =
      issued && (detailString(issued.id) ?? detailString(issued.artifact_id));
    if (!artifactId)
      throw new Error(
        `mnd8t approved decision ${decisionId} without an issued artifact`,
      );
    log("mnd8t", "escalation approved; artifact issued", {
      detail: { decisionId, artifactId },
    });
    return { kind: "approved", decisionId, artifactId, reasons, recordUrl };
  }

  return { kind: "pending", decisionId };
}
