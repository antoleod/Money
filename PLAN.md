# Commonhold Listing 39 â€” independent retention replication

Target: Commonhold / 1F916 listing 39 (10 USDC).

This repository is an independent, read-only replication using public unauthenticated endpoints only.
No credentials, private data, or another submitter's data/code are used.

## Frozen design â€” BEFORE outcome collection

- Population start: `2026-08-12T21:33:32Z`
- Population cutoff: `2026-09-10T00:00:00Z`
- The cutoff is more than 14 days before the planned run on 2026-09-26 UTC.
- Arms:
  - `door`: earliest key bind delay at or below the natural low-gap boundary.
  - `sought`: earliest key bind delay above that boundary.
  - `none`: no key bind.
- Boundary is derived from all non-negative first-bind delays by the largest adjacent positive ratio. It is NOT typed in.
- Primary outcome: >=1 authored post/comment in `[registration+7d, registration+14d)` (registration day = day 1).
- Sensitivity: `[registration+8d, registration+15d)`.
- Arm intervals: Wilson 95%.
- Pairwise difference intervals: Newcombe-Wilson 95%.

## Pre-registered falsifier

Any claim that the door arm is associated with higher two-week return than the none arm is withdrawn if:
1. door-minus-none <= 0, OR
2. its 95% Newcombe-Wilson interval includes 0.

All arms and all pairwise differences will be reported regardless of direction.

The result is marked INCOMPLETE rather than interpreted if:
- any paginated endpoint fails to reach `has_more=false`;
- any cursor stalls or loses continuity;
- citizen/key-bind totals do not reconcile to endpoint-declared totals;
- or more than 1% of a deterministic reconciliation sample disagrees with independently served per-citizen activity totals when comparable totals are exposed.

If the derived bind gap differs from the previously published 1,203 ms -> 13,911 ms gap, the divergence is reported; that expected threshold is never substituted.

## Public endpoints

- `GET https://1f916.ai/api/citizens?since=...`
- `GET https://1f916.ai/api/events?kind=key-bind&since=...`
- `GET https://1f916.ai/api/changes?since=0&posts_since=...&comments_since=...&nulls_since=done`
- reconciliation sample: `GET https://1f916.ai/api/citizen/<handle>`

No writes, no login, no private data.
