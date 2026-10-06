import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type EvidenceReceiptEnvelope, type MandateClient } from "@mnd8t/sdk";

export interface StoredReceipt {
  receiptId: string;
  decisionId: string;
  invoiceNumber: string;
  storedAt: string;
  envelope: EvidenceReceiptEnvelope;
}

export interface ReceiptSummary {
  receiptId: string;
  decisionId: string;
  invoiceNumber: string;
  storedAt: string;
}

const archiveDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".data",
  "mnd8t-receipts",
);

function archivePath(receiptId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(receiptId)) {
    throw new Error("invalid mnd8t receipt id");
  }
  return join(archiveDirectory, `${receiptId}.json`);
}

export async function storeReceipt(
  envelope: EvidenceReceiptEnvelope,
  decisionId: string,
  invoiceNumber: string,
): Promise<StoredReceipt> {
  const path = archivePath(envelope.id);
  await mkdir(archiveDirectory, { recursive: true });

  let storedAt = new Date().toISOString();
  try {
    const existing = JSON.parse(await readFile(path, "utf8")) as StoredReceipt;
    storedAt = existing.storedAt || storedAt;
  } catch {
    // A first write, or an unreadable previous archive entry, is replaced below.
  }

  const saved: StoredReceipt = {
    receiptId: envelope.id,
    decisionId,
    invoiceNumber,
    storedAt,
    envelope,
  };
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(saved, null, 2), {
    flag: "wx",
  });
  await rename(temporaryPath, path);
  return saved;
}

export async function getStoredReceipt(
  receiptId: string,
): Promise<StoredReceipt | undefined> {
  try {
    return JSON.parse(
      await readFile(archivePath(receiptId), "utf8"),
    ) as StoredReceipt;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function listStoredReceipts(): Promise<ReceiptSummary[]> {
  let names: string[];
  try {
    names = await readdir(archiveDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const receipts: ReceiptSummary[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const saved = JSON.parse(
        await readFile(join(archiveDirectory, name), "utf8"),
      ) as StoredReceipt;
      receipts.push({
        receiptId: saved.receiptId,
        decisionId: saved.decisionId,
        invoiceNumber: saved.invoiceNumber,
        storedAt: saved.storedAt,
      });
    } catch {
      // Ignore incomplete/corrupt entries rather than breaking the UI listing.
    }
  }
  return receipts.sort((a, b) => b.storedAt.localeCompare(a.storedAt));
}

export async function archiveDecisionReceipts(
  mandate: MandateClient,
  decisionId: string,
  invoiceNumber: string,
): Promise<ReceiptSummary[]> {
  const decision = await mandate.decisions.get(decisionId);
  const receiptIds = new Set<string>();
  if (typeof decision.evidence_receipt_id === "string") {
    receiptIds.add(decision.evidence_receipt_id);
  }
  if (Array.isArray(decision.receipts)) {
    for (const item of decision.receipts) {
      if (item && typeof item === "object" && typeof item.id === "string") {
        receiptIds.add(item.id);
      }
    }
  }

  const archived: ReceiptSummary[] = [];
  for (const receiptId of receiptIds) {
    const envelope = await mandate.receipts.get(receiptId);
    const saved = await storeReceipt(envelope, decisionId, invoiceNumber);
    archived.push({
      receiptId: saved.receiptId,
      decisionId: saved.decisionId,
      invoiceNumber: saved.invoiceNumber,
      storedAt: saved.storedAt,
    });
  }
  return archived;
}
