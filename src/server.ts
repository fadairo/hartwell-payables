/**
 * Hartwell Payables: the web app finance and engineering look at. Serves the
 * UI and a small JSON API it polls. No framework: node:http only.
 */
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

try {
  process.loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), "..", ".env"));
} catch {
  // No .env yet: fine until you integrate.
}

const { runOnce } = await import("./agent.js");
const { SCENARIOS, drop } = await import("./scenarios.js");
const { SUPPLIERS } = await import("./domain.js");
const { integrationStatus } = await import("./mnd8t.js");
const { log, reset, store } = await import("./store.js");

const PORT = Number(process.env.PORT ?? 5050);
const UI = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "index.html");

function send(res: ServerResponse, status: number, body: unknown, type = "application/json"): void {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body) : String(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/") return send(res, 200, readFileSync(UI, "utf8"), "text/html; charset=utf-8");

    if (req.method === "GET" && url.pathname === "/api/state") {
      return send(res, 200, {
        integrationStatus,
        agentAuto: store.agentAuto,
        bankOutage: store.bankOutage,
        invoices: [...store.invoices].reverse(),
        payments: [...store.payments].reverse(),
        log: store.log.slice(-200).reverse(),
        suppliers: SUPPLIERS,
        scenarios: Object.entries(SCENARIOS).map(([key, s]) => ({ key, label: s.label, hint: s.hint })),
      });
    }

    const scenario = url.pathname.match(/^\/api\/scenarios\/(\w+)$/);
    if (req.method === "POST" && scenario) return send(res, 201, drop(scenario[1]!));

    if (req.method === "POST" && url.pathname === "/api/agent/run") {
      await runOnce();
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/api/agent/auto") {
      store.agentAuto = Boolean((await readJson(req))["on"]);
      log("system", `agent auto-run ${store.agentAuto ? "on" : "off"}`);
      return send(res, 200, { agentAuto: store.agentAuto });
    }
    if (req.method === "POST" && url.pathname === "/api/bank/outage") {
      store.bankOutage = Boolean((await readJson(req))["on"]);
      log("system", `bank outage ${store.bankOutage ? "ON: payments will be rejected" : "off"}`);
      return send(res, 200, { bankOutage: store.bankOutage });
    }
    if (req.method === "POST" && url.pathname === "/api/reset") {
      reset();
      return send(res, 200, { ok: true });
    }
    send(res, 404, { error: "not found" });
  } catch (err) {
    send(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, () => {
  log("system", `Hartwell Payables on http://localhost:${PORT} (${integrationStatus})`);
});
