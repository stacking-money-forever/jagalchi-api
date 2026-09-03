# Job-source intake boundary

This directory is a persistence-free foundation for the durable target-import
workflow. `JOB_SOURCE_PROVIDER=fixture` accepts only
`https://fixture.invalid/jobs/software-engineer` and performs no DNS or network
work. `JOB_SOURCE_PROVIDER=live` selects the allowlisted live adapter; production
wiring must provide a `PinnedJobSourceTransport` and the system DNS resolver.
`JobSourceModule` provides that binding locally from the already validated
`JOB_SOURCE_PROVIDER`; a parent module may import it when workflow wiring lands.

The transport contract is intentionally stricter than `fetch`: it receives the
addresses already approved by URL/DNS preflight, must connect to one of those
addresses while retaining the original hostname for TLS SNI and certificate
verification, and must return redirects without following them. This prevents a
second uncontrolled DNS lookup from reopening an SSRF/DNS-rebinding path.
The concrete `NodePinnedJobSourceTransport` uses Node HTTPS with the vetted IP as
the socket hostname, disables agent reuse and redirects, and retains the source
hostname in `Host`, TLS SNI, and explicit certificate hostname verification.

Every initial URL and redirect is HTTPS-only, exact-host allowlisted, resolved,
and rejected if any DNS answer is private, loopback, link-local, multicast,
documentation, benchmark, transition, or otherwise reserved. Fetches have a
total deadline, redirect cap, response byte cap, and text-only content-type
allowlist. Output is UTF-8 decoded, HTML-reduced, Unicode NFKC normalized, and
identified by a SHA-256 of the normalized text plus capture/provenance version.

Manual capture is an explicit `DEGRADED_MANUAL_CAPTURE`, never fetched or
reported as live success. It requires bounded source text/title and one of the
closed degradation reasons. Its optional HTTPS URL is attribution only.

Later integration must:

1. Bind the selected adapter from validated `JOB_SOURCE_PROVIDER` configuration.
2. Implement a pinned-IP HTTPS transport without automatic redirects.
3. Enqueue fetches in `WorkflowOperation` and persist the returned capture and
   source hash atomically in immutable target/capture versions.
4. Map `JobSourceError.code` to the closed public operation error vocabulary,
   without logging URLs, DNS answers, response bodies, or underlying errors.
