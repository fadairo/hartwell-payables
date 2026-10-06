# Hartwell Payables

Internal testing only. This is a simulated mnd8t customer, not customer-facing
material.

Hartwell Field Robotics Ltd is a fictional UK company. This is its
accounts-payable app: invoices arrive, and an AI agent reads each one and pays
it through the company's bank. The agent is credulous. It pays the amount,
supplier and bank account printed on the invoice, and never asks anyone.

You play Hartwell's developer. Your job is to put the agent under mnd8t:
install the SDK, set up the company in the mnd8t dashboard, write the
integration, and watch mnd8t act as the authority layer between the agent and
the bank.

## Run it

Node 22 or later.

```bash
npm install
cp .env.example .env
npm start             # http://localhost:5050
```

On the left, drop invoices into the inbox, then press **Run agent now**, or
turn on **Auto-run**. **Bank outage** makes the bank reject payments.
Invoices, payments, and activity are in memory: **Reset** or a server restart
clears them. Signed mnd8t receipts are also archived locally under
`.data/mnd8t-receipts/`; they survive reset and restart and are listed in the
**Stored mnd8t receipts** panel. The archive is ignored by Git.

## Before you integrate

Drop every kind of invoice and run the agent. It pays all of them:

- the £3,000 bill nobody approved
- the supplier that failed review
- the invoice with "new bank details", which is fraud: the money goes to someone else
- the offsite booking coded to the cloud budget
- the duplicate, paid twice

Note the total in **Bank: payments sent**. That number is what the
integration exists to change.

## Then integrate

Follow [INTEGRATION.md](INTEGRATION.md). All the code you write goes in
`src/mnd8t.ts`. Keep notes on anything that was harder than it should have
been in [FINDINGS.md](FINDINGS.md); that is the point of the exercise.

## Layout

| File                                 | What it is                                                      | Touch it?                  |
| ------------------------------------ | --------------------------------------------------------------- | -------------------------- |
| `src/mnd8t.ts`                       | the integration seam: `authorise`, `execute`, `checkEscalation` | **yes, this is your work** |
| `src/agent.ts`                       | the AI agent: reads invoices, calls the seam, pays              | no                         |
| `src/bank.ts`                        | the simulated bank: pays anything it is told to                 | no                         |
| `src/domain.ts`                      | supplier master (with bank accounts on file), invoice types     | no                         |
| `src/scenarios.ts`                   | the invoices you can drop                                       | add your own if you like   |
| `src/server.ts`, `public/index.html` | the app and its UI                                              | no                         |

A worked solution is on the `solution` branch. Only look if you are stuck.
