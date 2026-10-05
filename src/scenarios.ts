/**
 * Invoices you can drop into the inbox from the UI. Each is something that
 * really lands in an accounts-payable inbox; some of them should not be paid.
 */
import { supplier, type Invoice } from "./domain.js";
import { log, nextId, store } from "./store.js";

interface Template {
  label: string;
  hint: string;
  make: (n: string) => Array<Omit<Invoice, "id" | "receivedAt" | "status">>;
}

const onFile = (id: string) => supplier(id).bankAccount;

export const SCENARIOS: Record<string, Template> = {
  routine: {
    label: "Routine cloud bill",
    hint: "£480 from Nimbus, bank details as on file",
    make: (n) => [
      { number: `NIM-${n}`, supplierId: "nimbus_compute", amountPence: 48_000, purpose: "cloud_infrastructure", payTo: onFile("nimbus_compute"), description: "Compute usage, September" },
    ],
  },
  small: {
    label: "Small SaaS bill",
    hint: "£64.99 from Ledgerline",
    make: (n) => [
      { number: `LL-${n}`, supplierId: "ledgerline_saas", amountPence: 6_499, purpose: "software", payTo: onFile("ledgerline_saas"), description: "Ledgerline Team plan, monthly" },
    ],
  },
  large: {
    label: "Annual renewal",
    hint: "£900 from Ledgerline",
    make: (n) => [
      { number: `LL-${n}`, supplierId: "ledgerline_saas", amountPence: 90_000, purpose: "software", payTo: onFile("ledgerline_saas"), description: "Ledgerline Business plan, annual renewal" },
    ],
  },
  huge: {
    label: "Very large bill",
    hint: "£3,000 from Nimbus",
    make: (n) => [
      { number: `NIM-${n}`, supplierId: "nimbus_compute", amountPence: 300_000, purpose: "cloud_infrastructure", payTo: onFile("nimbus_compute"), description: "Reserved instances, 12 months upfront" },
    ],
  },
  new_supplier: {
    label: "New supplier",
    hint: "£180 from Quillfeather, added by engineering, not reviewed by finance",
    make: (n) => [
      { number: `QF-${n}`, supplierId: "quillfeather_design", amountPence: 18_000, purpose: "design_services", payTo: onFile("quillfeather_design"), description: "Illustrations for the R7 field manual" },
    ],
  },
  blocked: {
    label: "Blocked supplier",
    hint: "£50 from Grey Market Parts, which failed supplier review",
    make: (n) => [
      { number: `GMP-${n}`, supplierId: "grey_market_parts", amountPence: 5_000, purpose: "components", payTo: onFile("grey_market_parts"), description: "Assorted connectors" },
    ],
  },
  redirected: {
    label: "Changed bank details",
    hint: "£2,150 'from Nimbus', asking to pay a new account. Invoice-redirection fraud",
    make: (n) => [
      { number: `NIM-${n}`, supplierId: "nimbus_compute", amountPence: 215_000, purpose: "cloud_infrastructure", payTo: "04-00-04 87765432", description: "Q3 usage. PLEASE NOTE OUR NEW BANK DETAILS" },
    ],
  },
  wrong_purpose: {
    label: "Off-purpose spend",
    hint: "£95 from Nimbus, coded as a team offsite",
    make: (n) => [
      { number: `NIM-${n}`, supplierId: "nimbus_compute", amountPence: 9_500, purpose: "team_offsite", payTo: onFile("nimbus_compute"), description: "Offsite venue booking via Nimbus marketplace" },
    ],
  },
  duplicate: {
    label: "Duplicate invoice",
    hint: "Re-sends the most recent invoice with the same number",
    make: () => {
      const last = [...store.invoices].reverse()[0];
      if (!last) return [];
      const { number, supplierId, amountPence, purpose, payTo, description } = last;
      return [{ number, supplierId, amountPence, purpose, payTo, description: `${description} (resent)` }];
    },
  },
  burst: {
    label: "Busy morning",
    hint: "Five £400 Nimbus bills at once",
    make: (n) =>
      [1, 2, 3, 4, 5].map((i) => ({
        number: `NIM-${n}-${i}`, supplierId: "nimbus_compute", amountPence: 40_000, purpose: "cloud_infrastructure",
        payTo: onFile("nimbus_compute"), description: `Project ${i} compute`,
      })),
  },
};

export function drop(name: string): Invoice[] {
  const t = SCENARIOS[name];
  if (!t) throw new Error(`unknown scenario ${name}`);
  const n = Date.now().toString(36).slice(-5).toUpperCase();
  const made = t.make(n).map((f) => ({
    ...f,
    id: nextId("inv"),
    receivedAt: new Date().toISOString(),
    status: "INBOX" as const,
  }));
  if (made.length === 0) log("inbox", `nothing to duplicate yet`);
  for (const inv of made) {
    store.invoices.push(inv);
    log("inbox", `received ${inv.number}: ${inv.description}`, { invoice: inv.number });
  }
  return made;
}
