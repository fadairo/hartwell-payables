# Integrating mnd8t into Hartwell Payables

You are Hartwell's developer. Finance has agreed the rules the payables agent
must work within. Your job is to make mnd8t enforce them, using the hosted
service at https://mnd8t.com and the public SDK, as any customer would.

Public docs for reference: https://mnd8t.com/docs/quickstart and
https://mnd8t.com/docs/developer-guide.

## The rules finance agreed

The payables agent may pay **Nimbus Compute** and **Ledgerline** for cloud
infrastructure and software:

- up to **£750** a payment on its own
- up to **£2,500** with a named approver; never more than £2,500
- no more than **£1,500 a day** and **£5,000 a month** in total
- only to the bank account on file for each supplier

Quillfeather Design is in Hartwell's supplier master but finance has not
reviewed it. Grey Market Parts failed review and must never be paid.

## 1. Get an account and an admin key

Sign in at https://mnd8t.com. On **Dashboard → Developers**, copy your admin
sandbox key (`mdt_test_…`). It is shown once. The admin key is for setting
things up; the agent will get its own, narrower key in step 3.

## 2. Set Hartwell up in the dashboard

**Agents → New agent**

| Field | Value |
|---|---|
| External ID | `hartwell_payables_agent` |
| Name | Hartwell Payables Agent |

**Counterparties**: one per supplier. The external ID must equal the supplier
id in `src/domain.ts`, and the destination must be the bank account on file,
character for character, because the agent will send the invoice's `payTo` as
the destination.

| External ID | Display name | Destination | Status |
|---|---|---|---|
| `nimbus_compute` | Nimbus Compute Ltd | `40-11-62 31926819` | APPROVED |
| `ledgerline_saas` | Ledgerline Software Ltd | `20-45-77 50438812` | APPROVED |
| `quillfeather_design` | Quillfeather Design | `30-96-34 11872245` | PENDING |
| `grey_market_parts` | Grey Market Parts | `60-83-71 99120044` | BLOCKED |

**Mandates → New mandate**. Amounts are in pence.

| Field | Value |
|---|---|
| Agent | Hartwell Payables Agent |
| Mode | ENFORCE, or SHADOW to trial it first (see step 6) |
| Allowed assets | `GBP` |
| Allowed counterparties | `nimbus_compute, ledgerline_saas` |
| Autonomous limit | `75000` |
| Absolute limit | `250000` |
| Approval above | `75000` |
| Daily budget / Monthly budget | `150000` / `500000` |
| Allowed purposes | `cloud_infrastructure, software` |
| New counterparties need approval | on |
| Schedule | off, or the agent will be refused outside the hours you set |

Open the mandate, use **Simulate** to check a few amounts. Fix anything with
**Edit draft**, then **Attest and publish** (role: Finance Director; source:
corporate policy).

Check it before you publish: **a published mandate is final**. To change it
later you create a replacement, publish that, and revoke the original (see
"Changing a mandate" below).

**Developers → New API key**, preset **AGENT**. This is the key the payables
agent carries. It can ask for decisions and use artifacts; it cannot change
suppliers, mandates or keys.

## 3. Install the SDK and configure

```bash
npm install @mnd8t/sdk
```

In `.env`:

```bash
MANDATE_API_URL=https://mnd8t.com/api
MANDATE_AGENT_KEY=mdt_test_...        # the AGENT key, not the admin key
MANDATE_AGENT_ID=hartwell_payables_agent
```

`src/server.ts` loads `.env` at startup.

## 4. Write the integration in `src/mnd8t.ts`

Three functions. The agent already calls them in the right places, and acts
on whatever `Authority` you return. Log as you go with
`log("mnd8t", message, { invoice, detail })`; it appears in the Activity feed.

### `authorise(p)`: ask before paying

Create a `MandateClient` and call `decisions.authorize(...)`. Things to decide
for yourself:

- **Amount.** Hartwell pays in GBP and the policy currency is GBP, so the
  asset is `GBP` and the asset amount and policy valuation are both
  `p.amountPence`. The valuation's `source` names the system you trust for
  the figure (your ERP), never the agent.
- **Destination.** Send `p.payTo`. This is what lets mnd8t catch the
  changed-bank-details invoice. Ask yourself what happens if you leave it out.
- **Idempotency key.** The SDK generates one if you do not pass
  `idempotencyKey`. What should it be, so that a duplicate invoice is not paid
  twice?
- **Mapping.** `effective_decision` is `APPROVE`, `ESCALATE`, `REJECT`, or
  `OBSERVE` (shadow mode). Map it to `approved` (with
  `authorisation_artifact.id`), `escalated` (with `approval.approval_url`),
  `refused`, or `observed` (with `would_decide`). Return `reason_codes` as the
  reasons.

### `execute(a, p, pay)`: pay with the authority

The sequence mnd8t expects from your executor:

1. `artifacts.get(a.artifactId)`, then `artifacts.verify(envelope.artifact)`:
   refuse to pay if the signature does not verify
2. `artifacts.claim(a.artifactId, "<your executor name>")`: single use
3. `pay(p)`: Hartwell's bank, which mnd8t never touches
4. success: `decisions.confirm(a.decisionId, { provider, external_reference, authorisation_artifact_id, reported_by: "CUSTOMER_EXECUTOR" })`
5. failure (pay throws): `artifacts.fail(a.artifactId, "PROVIDER_REJECTED")`, then rethrow.
   Not `decisions.cancel`: once claimed, money may have moved.

### `checkEscalation(decisionId)`: has a human decided?

`decisions.get(decisionId)` returns the decision with its `status` and
`artifacts`. `APPROVED` with an `ISSUED` artifact means `approved`.
`REJECTED` or `EXPIRED` means `refused`. Anything else is `pending`. The
agent calls this on every run for invoices awaiting approval.

Finally, change `integrationStatus` so the header shows you are live.

## 5. Watch it work

Reset, drop each invoice in this order, and run the agent. With the mandate
above, in ENFORCE mode, on a day with no spend yet:

| Invoice | What should happen |
|---|---|
| Routine cloud bill, £480 | `APPROVE`: paid |
| Small SaaS bill, £64.99 | `APPROVE`: paid |
| Annual renewal, £900 | `ESCALATE`: appears in the Approver inbox, with £900 of budget reserved. Open the link, approve, then run the agent: paid |
| Very large bill, £3,000 | `REJECT` `ABSOLUTE_LIMIT_EXCEEDED` |
| New supplier (Quillfeather) | `REJECT`: purpose not allowed, supplier not approved |
| Blocked supplier | `REJECT` `COUNTERPARTY_BLOCKED` |
| Changed bank details, £2,150 | `REJECT` `DESTINATION_NOT_AUTHORISED`. The fraud is stopped |
| Off-purpose spend | `REJECT` `PURPOSE_NOT_ALLOWED` |
| Duplicate invoice (drop it right after a routine one) | depends on your idempotency key. Not paid twice is the goal |
| Busy morning, 5 × £400 | after the rows above (£1,444.99 committed today) all five are `DAILY_BUDGET_EXCEEDED`. Run it first on a fresh day and the cut-off lands mid-batch, after three |
| Any approved invoice with **Bank outage** on | approved, claimed, bank rejects, failure reported: `FAILED`, budget still held |

A refusal lists every rule that failed, so most rows above show extra reason
codes (usually `DAILY_BUDGET_EXCEEDED` too); the one named is the deciding one.

The budget lives in mnd8t, not in this app: **Reset** clears the app but
does not give the day's budget back.

Compare **Total paid out** with your "before" run. Follow each **decision**
link into the mnd8t dashboard to see the evaluation trace, the mandate version
that applied, and the signed record.

## 6. Shadow first (optional, and how a cautious customer would do it)

Publish the mandate in SHADOW instead. The agent keeps paying everything, but
every invoice shows what mnd8t *would* have decided. When you are satisfied,
go live by **replacing** the mandate with an ENFORCE one, as below. A
published mandate's mode cannot be switched in place.

## Changing a mandate

Published mandates are never amended. Every decision names a mandate whose
terms have not changed since they were attested. To change limits, suppliers,
purposes or mode:

1. On the mandate's page, choose **Create replacement**. The builder opens
   with the current terms copied in, including any the form does not show.
2. Make the change (for example, Mode → ENFORCE), save the draft, and
   **Attest and publish** it. From that moment the agent is evaluated against
   the replacement: an agent always runs under its most recently published,
   unrevoked mandate.
3. Revoke the original mandate, so it cannot come back into force if the
   replacement is ever revoked.

Drafting the replacement does not affect the live mandate, so there is no gap
in authority while you prepare it. Via the API it is the same three steps:
`POST /v1/mandates`, `POST /v1/mandates/<new>/publish`, then
`POST /v1/mandates/<old>/revoke`, all with the admin key. A `PATCH` on a
published mandate returns `409`.

> **Deployment note.** Revoke-and-replace, **Edit draft** and **Create
> replacement** arrive with mnd8t PR #68. Until that is deployed, mnd8t.com
> still accepts `PATCH` on a published mandate and has no edit or
> replacement screens. Use the API steps above rather than an in-place
> amendment, so your integration does not depend on behaviour that is going
> away.

## 7. Further exercises

- **Onboard Quillfeather.** Approve it on the Counterparties page, then
  replace the mandate with one that adds `quillfeather_design` to the
  allowed counterparties and `design_services` to the purposes. Publish it,
  revoke the old one, and resend the invoice. Watch the decision link: it now
  names the new mandate.
- **Replace without a gap.** Drop a routine invoice while the replacement is
  still a draft, and again after publishing it. Both should be decided: the
  first under the old mandate, the second under the new one.
- **Verify the record yourself.** In `execute`, after confirming, fetch the
  decision's receipt and check it with `receipts.verify(...)`, offline,
  against the published keys.
- **Webhooks.** Register an endpoint on the Developers page and watch
  `decision.*` events arrive.
- **Try to cheat.** From the agent's key, try to create a counterparty or
  publish a mandate. It should get 403.

Write down anything that surprised you in `FINDINGS.md`.
