---
"@cardano-slips/core": minor
---

Add the `slips.json` domain mapping: the schema, the fetch, and the resolution that turns a shared human URL into the endpoint behind it.

`decodeSlipsJson` also refuses the two things the JSON Schema cannot see — an `apiPath` whose wildcards disagree with its `pathPattern`, and the same `pathPattern` declared twice — because both are visible in the payload and there is no later step that would catch them.

`fetchDomainMapping` keeps the distinction the spec turns on: `404` and `410` mean the origin serves no mapping and the link is its own endpoint, while a timeout, a `5xx`, an oversized body or a refused request are `UNREACHABLE` rather than absent, and a file that arrives and does not conform is `MALFORMED_RESPONSE` with no fall back to the human path. It refuses a redirect that leaves the origin, and refuses any scheme but `https:`, admitting `http:` on a loopback host for development.

`resolvePath` runs the resolution table the CIP publishes, including the cases that separate it from a naive rewriter: one hop with no re-matching of its own output, dot segments removed before matching, an encoded slash that stays inside its segment, and a trailing slash that is not equivalent to its absence. `resolveSlipUrl` takes the origin from the link and never from the file, which is what makes the same-origin constraint structural.
