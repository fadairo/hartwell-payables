/**
 * Worked solution: Hartwell's payables agent under mnd8t.
 *
 * Compare with your own version on main. Design choices are explained inline.
 */
import { MandateClient, MandateError, type AuthorizeResponse } from "@mnd8t/sdk";
import type { PaymentInstruction } from "./domain.js";
import { gbp } from "./domain.js";
import { log } from "./store.js";

export type Authority =
  | { kind: "unchecked" }
  | { kind: "approved"; decisionId: string; artifactId: string; reasons: string[]; recordUrl?: string }
  | { kind: "escalated"; decisionId: string; approvalUrl: string; reasons: string[] }
  | { kind: "refused"; decisionId: string; reasons: string[] }
  | { kind: "pending"; decisionId: string }
  | { kind: "observed"; decisionId: string; wouldDecide: string; reasons: string[] };

const apiKey = process.env.MANDATE_AGENT_KEY;
const agentId = process.env.MANDATE_AGENT_ID ?? "hartwell_payables_agent";
const baseUrl = process.env.MANDATE_API_URL ?? "https://mnd8t.com/api";

if (!apiKey) throw new Error("MANDATE_AGENT_KEY is not set: see INTEGRATION.md step 3");
if (!apiKey.startsWith("mdt_")) throw new Error("MANDATE_AGENT_KEY does not look like an mnd8t key");

const mandate = new MandateClient({ apiKey, baseUrl });
const EXECUTOR = "hartwell-payables-bank-executor";

export const integrationStatus = `integrated: ${agentId} asks ${new URL(baseUrl).host} before every payment`;

function toAuthority(d: AuthorizeResponse): Authority {
  const reasons = d.reason_codes;
  switch (d.effective_decision) {
    case "APPROVE":
      if (!d.authorisation_artifact) throw new Error("APPROVE without an authorisation artifact");
      return {
        kind: "approved",
        decisionId: d.id,
        artifactId: d.authorisation_artifact.id,
        reasons,
        ...(d.authority_record ? { recordUrl: d.authority_record.url } : {}),
      };
    case "ESCALATE":
      if (!d.approval) throw new Error("ESCALATE without an approval link");
      return { kind: "escalated", decisionId: d.id, approvalUrl: d.approval.approval_url, reasons };
    case "REJECT":
      return { kind: "refused", decisionId: d.id, reasons };
    case "OBSERVE":
      return { kind: "observed", decisionId: d.id, wouldDecide: d.would_decide, reasons };
  }
}

export async function authorise(p: PaymentInstruction): Promise<Authority> {
  log("mnd8t", `asking for authority: ${gbp(p.amountPence)} to ${p.supplierId} at ${p.payTo}`, { invoice: p.invoiceNumber });
  const d = await mandate.decisions.authorize({
    agent_external_id: agentId,
    external_reference: p.invoiceNumber,
    action_type: "PAYMENT",
    // Hartwell pays in GBP and its policy currency is GBP: one figure, no rate.
    amount: { asset: "GBP", asset_amount_minor: p.amountPence },
    valuation: { policy_amount_minor: p.amountPence, policy_currency: "GBP", source: "HARTWELL_ERP" },
    counterparty_external_id: p.supplierId,
    // The account the money would actually go to. Without this, the
    // changed-bank-details invoice would sail through under Nimbus's name.
    destination: p.payTo,
    purpose: p.purpose,
    // Keyed on the supplier and invoice number: a resent invoice replays the
    // original decision (and its already-used artifact) instead of being
    // decided, and paid, a second time.
    idempotencyKey: `hartwell-payables:${p.supplierId}:${p.invoiceNumber}`,
  });
  log("mnd8t", `decision ${d.effective_decision}${d.effective_decision === "OBSERVE" ? ` (would ${d.would_decide})` : ""}: ${d.reason_codes.join(", ")}`, {
    invoice: p.invoiceNumber,
    detail: d,
  });
  return toAuthority(d);
}

export async function execute(
  a: Extract<Authority, { kind: "approved" }>,
  p: PaymentInstruction,
  pay: (p: PaymentInstruction) => Promise<string>,
): Promise<string> {
  const envelope = await mandate.artifacts.get(a.artifactId);
  if (envelope.status !== "ISSUED") {
    // A replayed decision for a duplicate invoice lands here: its artifact
    // was already used. Refuse rather than pay again.
    throw new Error(`authorisation ${a.artifactId} is ${envelope.status}; not paying (duplicate invoice?)`);
  }
  const check = await mandate.artifacts.verify(envelope.artifact);
  if (!check.valid) throw new Error(`authorisation signature invalid (${check.reason}); not paying`);
  log("mnd8t", `artifact ${a.artifactId} verified against the published key`, { invoice: p.invoiceNumber });

  await mandate.artifacts.claim(a.artifactId, EXECUTOR);
  log("mnd8t", "artifact claimed: single use, budget held until confirm or fail", { invoice: p.invoiceNumber });

  let ref: string;
  try {
    ref = await pay(p);
  } catch (err) {
    await mandate.artifacts.fail(a.artifactId, "PROVIDER_REJECTED");
    log("mnd8t", "reported the bank's rejection (fail, not cancel)", { invoice: p.invoiceNumber });
    throw err;
  }

  await mandate.decisions.confirm(a.decisionId, {
    provider: "HARTWELL_BANK",
    external_reference: ref,
    authorisation_artifact_id: a.artifactId,
    reported_by: "CUSTOMER_EXECUTOR",
    verification: { method: "PROVIDER_LOOKUP", verified: true },
  });
  log("mnd8t", `execution confirmed: ${ref}`, { invoice: p.invoiceNumber });
  return ref;
}

export async function checkEscalation(decisionId: string): Promise<Authority> {
  let d: { status: string; reason_codes?: string[]; artifacts?: Array<{ id: string; status: string }> };
  try {
    d = (await mandate.decisions.get(decisionId)) as typeof d;
  } catch (err) {
    if (err instanceof MandateError && err.status >= 500) return { kind: "pending", decisionId };
    throw err;
  }
  const reasons = d.reason_codes ?? [];
  if (d.status === "APPROVED") {
    const artifact = d.artifacts?.find((x) => x.status === "ISSUED");
    if (artifact) return { kind: "approved", decisionId, artifactId: artifact.id, reasons: ["APPROVED_BY_HUMAN"] };
  }
  if (d.status === "REJECTED" || d.status === "EXPIRED" || d.status === "CANCELLED") {
    return { kind: "refused", decisionId, reasons: [d.status === "REJECTED" ? "REJECTED_BY_HUMAN" : `APPROVAL_${d.status}`] };
  }
  return { kind: "pending", decisionId };
}
