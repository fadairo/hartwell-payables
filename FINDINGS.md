# Findings

Friction, surprises and bugs met while integrating, as a customer would meet
them. Add to it as you go.

| # | Where | What happened | Severity |
|---|---|---|---|
| 1 | Dashboard → Mandates | A published mandate cannot be edited in the dashboard: there is no form for a new version. Switching SHADOW → ENFORCE, or adding a supplier to `allowed_counterparties`, needs `PATCH /v1/mandates/:id` plus a publish via the API. | friction |
| 2 | API → `PATCH /v1/mandates/:id` | `mode` is stored on the mandate, not on the version. A PATCH with `mode: "ENFORCE"` takes effect immediately, before the new version is published or attested. | design question |
| 3 | Approvals | The approval link is returned only in the decision response to the caller (the agent). There is no API to fetch it again, no notification to an approver (`EMAIL_PROVIDER` exists in config but nothing sends email), and the `decision.escalated` webhook payload omits `approval_url`. The customer's integration must deliver it, from the agent's process. | friction / docs |
| | | | |
