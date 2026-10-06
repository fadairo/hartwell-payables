# Findings

Friction, surprises and bugs met while integrating, as a customer would meet
them. Add to it as you go.

| # | Where | What happened | Severity |
|---|---|---|---|
| 1 | Dashboard → Mandates | No way to edit a mandate in the dashboard, not even a draft before publishing. **Resolved in mandate PR #68:** drafts get **Edit draft**; published mandates are final by design, and get **Create replacement** (copy, change, publish, revoke the old). | friction → fixed |
| 2 | API → `PATCH /v1/mandates/:id` | `mode` was stored on the mandate, not the version, so a PATCH with `mode: "ENFORCE"` switched a published mandate to enforcement immediately, with no publication or attestation. **Resolved in mandate PR #68:** PATCH on a published mandate now returns 409; change is revoke and replace. | bug → fixed |
| 3 | Approvals | The approval link is returned only in the decision response to the caller (the agent). There is no API to fetch it again, no notification to an approver (`EMAIL_PROVIDER` exists in config but nothing sends email), and the `decision.escalated` webhook payload omits `approval_url`. The customer's integration must deliver it, from the agent's process. | friction / docs |
| 4 | API → decision lookup | An agent was evaluated against its most recently *updated* mandate. Drafting a replacement switched the live mandate off (`MANDATE_NOT_PUBLISHED`), and revoking the old one after publishing a replacement made every decision `MANDATE_REVOKED`. **Resolved in mandate PR #68:** the most recently published, unrevoked mandate governs. | bug → fixed |
| | | | |
