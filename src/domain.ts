/**
 * Hartwell's accounts-payable domain: its supplier master, the invoices that
 * arrive, and the shape of a payment the agent wants to make.
 *
 * Amounts are integer pence. Destinations are UK sort code + account number,
 * written "SS-SS-SS AAAAAAAA". All of it is fictional.
 */

export interface Supplier {
  /** Hartwell's supplier id. Use the same value as the counterparty external_id in mnd8t. */
  id: string;
  name: string;
  /** The bank account on file in Hartwell's supplier master. */
  bankAccount: string;
  category: string;
}

export const SUPPLIERS: Supplier[] = [
  { id: "nimbus_compute", name: "Nimbus Compute Ltd", bankAccount: "40-11-62 31926819", category: "cloud_infrastructure" },
  { id: "ledgerline_saas", name: "Ledgerline Software Ltd", bankAccount: "20-45-77 50438812", category: "software" },
  { id: "quillfeather_design", name: "Quillfeather Design", bankAccount: "30-96-34 11872245", category: "design_services" },
  { id: "grey_market_parts", name: "Grey Market Parts", bankAccount: "60-83-71 99120044", category: "components" },
];

export function supplier(id: string): Supplier {
  const s = SUPPLIERS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown supplier ${id}`);
  return s;
}

export type InvoiceStatus =
  | "INBOX"
  | "PROCESSING"
  | "PAID"
  | "AWAITING_APPROVAL"
  | "BLOCKED"
  | "FAILED";

export interface Invoice {
  /** Internal id. */
  id: string;
  /** The supplier's invoice number. Duplicates share it. */
  number: string;
  supplierId: string;
  amountPence: number;
  /** What the invoice is for, as Hartwell codes it. */
  purpose: string;
  /** The bank account printed on the invoice. Usually the one on file. */
  payTo: string;
  description: string;
  receivedAt: string;
  status: InvoiceStatus;
  /** Why it ended where it did, in words a finance person reads. */
  outcome?: string;
  /** Provider transaction reference, once paid. */
  paymentRef?: string;
  /** Anything your mnd8t integration wants shown against this invoice. */
  authority?: {
    decisionId?: string;
    decision?: string;
    reasons?: string[];
    approvalUrl?: string;
    recordUrl?: string;
  };
}

/** What the agent hands to payment: the instruction derived from an invoice. */
export interface PaymentInstruction {
  invoiceId: string;
  invoiceNumber: string;
  supplierId: string;
  supplierName: string;
  /** Where the money would go. Taken from the invoice. */
  payTo: string;
  amountPence: number;
  currency: "GBP";
  purpose: string;
}

export function gbp(pence: number): string {
  return `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
