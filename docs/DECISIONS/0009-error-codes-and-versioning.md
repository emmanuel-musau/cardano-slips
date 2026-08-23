# ADR-0009: Classify failures by what a client does next, and version the protocol with a single integer per URL

**Status:** Accepted
**Date:** 2026-08-21
**Issue:** #18

## Context

The GET discovery response (#15) left two forward references, and nothing below
them can be written until both are answered.

The first is failure. `disabled` and its `reason` describe a Slip that was
served successfully and currently offers nothing to sign; the spec says so
normatively and rejects any attempt to report that state with a non-2xx status.
It does not say what a genuine failure looks like — the endpoint that is down,
the parameter that was rejected, the deadline that passed between discovery and
submission. Every ticket from #17 onward produces one of those, and `server`,
`flow` and the slip page each need to render them. `CLAUDE.md` already
requires that user-facing failures map to spec error codes with human-readable
messages and never to raw stack traces, which is a rule with nothing behind it
until the codes exist.

The second is versioning. `version` is already specified as a decimal string
matched rather than pinned, explicitly so that a client meeting a future major
version can tell an unsupported protocol from a malformed response — and the
sentence that says so ends by deferring what the client then *does* to this
decision.

Three facts constrain both answers. A client MUST reject a response carrying an
undefined member, so no field can be added to a shape compatibly. Discovery MUST
NOT vary by requester and SHOULD be cacheable, because the same bytes go to the
person who clicked the link and to the crawler that unfurled it. And a client
runs in a page on an origin the publisher does not control, so anything the
browser will not hand it does not exist.

## Decision

**One failure body: `type: "error"`, with `version`, `code`, `message`, and an
optional `field`.** It is a fifth shape alongside discovery, not a variant of
it. `message` is written for the person and MUST NOT carry markup or internal
detail; `field` names the rejected parameter so a client can attach the message
to the input that caused it. The body MUST be served with
`Access-Control-Allow-Origin: *` and MUST NOT be cached — CORS on the happy path
alone means the browser withholds every failure body, including the ones the
person could have corrected.

**Eleven codes in three classes, and the class is what a client acts on.**
`request` (`INVALID_PARAMETER`, `WRONG_NETWORK`) means the person or the client
can act; `WRONG_NETWORK` is the one code both parties can raise, because the
same disagreement is visible to a client before it sends and to an endpoint
reading `network` out of what arrived. `terminal` (`NOT_FOUND`, `UNAVAILABLE`,
`EXPIRED`, plus the client-raised `MALFORMED_RESPONSE` and
`UNSUPPORTED_VERSION`) means this Slip will not produce a transaction.
`transient` (`RATE_LIMITED`, `UPSTREAM_FAILURE`, `INTERNAL_ERROR`, plus the
client-raised `UNREACHABLE`) means the same request may succeed later. Codes
name what happens next, not what broke inside the endpoint, which is why the
list is small enough to implement exhaustively.

**The class is a property of the code, fixed by the spec, and is never
transmitted.** An endpoint able to declare its own failure retryable is an
endpoint able to keep a client asking.

**Each endpoint code carries exactly one HTTP status**, and the two say the same
thing: `400` for the request class, `404`/`409`/`410` for terminal — `410`
specifically for `EXPIRED`, whose permanence HTTP already has a word for — and
`429`/`500`/`502` for transient. Classification is an ordered rule, not three
independent ones: a body that does not satisfy the client schema is not a
failure response and is classified by status alone, with none of it rendered —
an unreadable body is as likely to be an intermediary's HTML error page as the
publisher's words; otherwise an undefined `code` is terminal; otherwise the
`code` governs and a contradicting status is ignored.

**Retries carry a floor as well as a ceiling** — at least one second where
`Retry-After` is absent, on a growing interval, bounded. `Retry-After` is only a
SHOULD on the endpoint, and a client without a floor is indistinguishable from
one hammering a publisher that is already failing.

**Three codes are raised only by a client and never appear on the wire.**
`MALFORMED_RESPONSE`, `UNSUPPORTED_VERSION` and `UNREACHABLE` are absent from
the endpoint schema, so an endpoint cannot claim a condition only the client can
observe, and they exist so a client renders every failure through one vocabulary
rather than the publisher's words for one half and a browser exception for the
other.

**The failure body gets two schemas, because the obligation differs by party.**
An endpoint conforms to `slip-error-response-endpoint.schema.json`, where `code`
is the closed eight-value enum. A client validates against
`slip-error-response.schema.json`, where `code` is only constrained to the shape
of a code. Collapsing them into one enum was the first draft of this decision
and it was incoherent: an unrecognised code would fail validation, which would
route it to the classify-by-status fallback and to the rule against rendering an
unvalidated body — so the same response was simultaneously terminal with a
message shown and transient with the message discarded. Splitting the schemas
makes an unrecognised code a *readable* body carrying an *undefined* value,
which is what it actually is.

**An unrecognised code is terminal, and a disagreeing status does not override
it.** The other two classes each authorise the client to act again — by
retrying, or by resubmitting a corrected request — and neither is safe on a
failure whose meaning is unknown; an uninterpretable code arriving with a status
that says to try again is precisely the combination that could hold a client in
a loop it cannot reason about. This rule is about a *non-conforming* endpoint,
not a newer one: a response from a later major version is caught by the version
check before any code is read, so it never reaches here.

**`version` is a major version and nothing else, and one URL speaks one major
version.** There are no minor versions, because strict member rejection means a
compatible addition is not expressible: a change that cannot be ignored is not a
minor change. There is no negotiation — no version in the request, no
`Accept-Version`, no `Vary` — and a publisher supporting two majors publishes
one URL per major, exactly as it already publishes one URL per network. A client
MUST read `version` before validating anything else, and on a major it does not
implement MUST fail with `UNSUPPORTED_VERSION`, render no part of the response
as something the user can act on, and not `POST`.

## Alternatives considered

**RFC 9457 `application/problem+json`.** The obvious standard, and a reviewer
will ask. Rejected on three counts. Its `type` member is a URI, and ours is
already a shape discriminator carrying `"slip"` — colliding on the one field a
client switches on to tell the shapes apart is a bad trade for conformance with
a document nobody in this ecosystem is reading. Its registry is open by design,
which is the opposite of what a closed, exhaustively implementable client
vocabulary needs. And it is a `Content-Type` change on the failure path only,
which adds a second media type to every endpoint and adapter for no behaviour a
client gains.

**Free-form codes, or an open registry, with the class carried in the body.**
Cheaper for publishers and worse for everyone else: the client can no longer
handle failures exhaustively, and an endpoint that marks its own failure
transient can hold a client in a retry loop it did not choose. The `reason.code`
on the discovery side is deliberately open precisely because nothing acts on it
— it decorates a state the client already renders. A failure code drives
behaviour, and behaviour has to be enumerable.

**HTTP status alone, with only `message` in the body.** Solana Actions
effectively does this, and it is why its clients cannot distinguish a rejected
parameter from a dead endpoint without reading English. Statuses are also
rewritten by CDNs and proxies far more readily than bodies are, so a protocol
that carries its meaning only in the status line loses it in transit.

**Minor versions with additive optional fields.** The standard answer, and it is
foreclosed by a rule we would not give up: a client MUST reject undefined
members, because a member it silently ignores is a claim about the transaction
it did not check. Keeping strict rejection means every shape change is major.
That is the trade, made knowingly.

**Header negotiation — `Accept-Version`, or `Vary` on a custom header.** Lets
one URL serve several majors, and breaks the two properties discovery is built
on: identical bytes for every requester, and cacheability. A link unfurler sends
no such header, so the preview and the page would disagree about what the Slip
is.

**A `retryable` boolean, or `Retry-After` mirrored into the body.** Redundant
with the class in the first case and with a header HTTP already defines in the
second. Two sources for one fact is one source too many.

## Consequences

**Every later ticket inherits a fixed vocabulary.** `server` maps thrown errors
onto eight codes and eight statuses; `core` decodes one more schema; `flow` and
the slip page switch on three classes rather than on wording. #17 in particular
needs no version field in the POST body, because the URL already fixes the
version — one decision it no longer has to make.

**A v2 is a visible, expensive event, and that is intended.** Every shape change
means a new major, new URLs for publishers who want both, and — per
`WORKFLOW.md` — a spec PR, a schema bump, and `core` schemas and tests in the
same change. The cost is deliberate; it is what keeps strict member rejection
affordable.

**Publishers carry real obligations on the failure path.** CORS headers and
`no-store` on non-2xx responses, statuses that match codes, and messages written
for a person rather than piped from an exception. These are the things
implementations get wrong, so the examples under `spec/examples/error` include a
payload per endpoint code and two payloads that satisfy both schemas and still
violate the `message` rules — a stack trace and an internal hostname — which no
validator can catch.

**Some conditions are named but not yet specified.** A contradiction between
derived effects and declared metadata, a refused signature, a rejected
submission: all are client conditions in this vocabulary, and each is defined
where its step is specified (#19 and #17). This ADR fixes the shape of that
vocabulary, not its full membership; adding a client-raised code later is a spec
edit, not a version bump, because those codes never travel.

**Reversing the class model is cheap; reversing the version model is not.**
Classes, codes and the schema split are still pre-freeze and can be reworked
until #21. The
one-URL-one-major rule becomes load-bearing the moment a third-party publisher
serves a URL against it.
