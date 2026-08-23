import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The security considerations (#20).
 *
 * CIP-13's own security considerations warn about links that misrepresent
 * where they lead, and this proposal's answer to that warning is the reason it
 * exists. A reviewer reads this section before any other part of the
 * specification, so what it must not do is contradict the rest of the document
 * or invent guarantees the rest does not deliver.
 *
 * That is most of what this file checks. The rules themselves are prose, and a
 * test can only assert that the prose says them; the cross-checks are where it
 * earns its place — every reason and every failure code this section cites is
 * checked against the tables that define them, so a section that drifts from
 * the mechanism it summarises fails here rather than in public review.
 */

const root = join(import.meta.dirname, "..")
const source = readFileSync(join(root, "spec", "CIP-XXXX", "README.md"), "utf8")

/**
 * The text under a heading, up to the next heading at the same level or
 * higher. Unlike the helper in spec-effects.test.ts this keeps the level-4
 * subsections, because this section is mostly made of them.
 */
const slice = (heading: string, level: number): string => {
  const marker = `${"#".repeat(level)} ${heading}\n`
  const start = source.indexOf(marker)
  expect(start, `no "${marker.trim()}" section in the CIP`).toBeGreaterThan(-1)
  const rest = source.slice(start + marker.length)
  const end = rest.search(new RegExp(`^#{2,${level}} `, "m"))
  return end === -1 ? rest : rest.slice(0, end)
}

/** Every markdown table in a chunk of text, as rows of trimmed cells. */
const tables = (text: string): Array<Array<Array<string>>> => {
  const found: Array<Array<Array<string>>> = []
  let current: Array<Array<string>> | undefined

  for (const line of text.split("\n")) {
    if (line.startsWith("|")) {
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim())
      if (current === undefined) {
        current = []
        found.push(current)
      }
      if (!cells.every((cell) => /^-+$/.test(cell))) current.push(cells)
    } else {
      current = undefined
    }
  }
  return found
}

const unquote = (cell: string): string => cell.replaceAll("`", "")

const security = slice("Security considerations", 3)

/** Codes the failure table defines, and the reasons the block table names. */
const failureCodes = (tables(slice("Failure responses", 3))[1] ?? []).slice(1).map((row) => unquote(row[0] ?? ""))
const reasons = (tables(slice("Blocking", 3)).at(-1) ?? []).slice(1).map((row) => unquote(row[0] ?? ""))

describe("where the section sits", () => {
  it("is a subsection of Specification rather than a heading of its own", () => {
    // CIP-0001 fixes the H2 set; spec-skeleton.test.ts enforces it. This is
    // the same rule read from the other side: the section exists, and it
    // exists as an H3.
    expect(source).toContain("### Security considerations")
    expect(source).not.toMatch(/^## Security considerations$/m)
  })

  it("reads after the mechanism it describes and before the cross-cutting sections", () => {
    const at = (heading: string): number => source.indexOf(`### ${heading}\n`)
    expect(at("Security considerations")).toBeGreaterThan(at("Blocking"))
    expect(at("Security considerations")).toBeLessThan(at("Failure responses"))
    expect(at("Security considerations")).toBeLessThan(at("Protocol versioning"))
  })

  it("covers the four threats this section owes a reader", () => {
    for (const heading of [
      "A malicious endpoint",
      "Metadata that lies",
      "Replay",
      "Origin spoofing",
      "Server-balanced builds, and what they disclose",
      "Publisher identity",
      "What this document does not defend against"
    ]) {
      expect(security, `no "${heading}" subsection`).toContain(`#### ${heading}\n`)
    }
  })
})

describe("what the section says is trusted", () => {
  const trusted = slice("What is trusted", 4)

  it("names each party and what it is not trusted for", () => {
    const rows = (tables(trusted)[0] ?? []).slice(1).map((row) => row[0] ?? "")
    expect(rows).toEqual(["the endpoint", "the client", "the wallet", "the transport"])
    // The endpoint is trusted for nothing: that is the whole proposal, stated
    // where a reviewer meets it first.
    expect(trusted).toMatch(/\| the endpoint \| nothing \|/)
  })

  it("admits that a compromised client is below every rule in the document", () => {
    expect(trusted).toMatch(/A client an attacker controls has already won/)
  })

  it("requires https, with a loopback carve-out and nothing else", () => {
    expect(trusted).toMatch(/MUST resolve a Slip over `https:`, and MUST refuse any other scheme/)
    expect(trusted).toMatch(/MAY additionally admit `http:` on a loopback host/)
    expect(trusted).toMatch(/MUST\s+NOT admit it anywhere else/)
  })

  it("closes the redirect route out of the origin, with a defined code", () => {
    // Linked actions and slips.json each close one route to another host. A
    // redirect is the third, and it is the one no schema can reach.
    expect(trusted).toMatch(/MUST NOT follow a redirect to another origin/)
    expect(trusted).toMatch(/MUST fail with\s+`MALFORMED_RESPONSE`/)
    expect(trusted).toMatch(/MAY follow a same-origin redirect, and MUST bound how many/)
  })

  it("keeps a publisher's payload as data", () => {
    expect(trusted).toMatch(/MUST NOT execute anything an endpoint returns/)
    expect(trusted).toMatch(/would be handing every\s+publisher script execution/)
  })

  it("bounds what a client will read and how long it will wait", () => {
    expect(trusted).toMatch(/MUST bound what it reads/)
    expect(trusted).toMatch(/MUST impose a limit on the\s+size of a response/)
    expect(trusted).toMatch(/`UNREACHABLE`/)
  })
})

describe("the malicious endpoint", () => {
  const malicious = slice("A malicious endpoint", 4)

  it("says plainly that in this version the endpoint does not build the transaction", () => {
    // The honest statement of the mode. A reader who thinks the endpoint
    // returns CBOR will misjudge every rule that follows.
    expect(malicious).toMatch(/the endpoint does not build the transaction; the client\s+does/)
    expect(malicious).toMatch(/by the client's own balancer/)
  })

  it("answers every attempt with a reason the block table defines", () => {
    const cited = [...malicious.matchAll(/`([a-z]+\.[a-z-]+)`/g)].map((match) => match[1])
    expect(cited.length).toBeGreaterThan(8)
    const undefined_ = [...new Set(cited)].filter((reason) => !reasons.includes(reason))
    expect(undefined_, "the threat table cites a reason nothing defines").toEqual([])
  })

  it("leaves every reason in the block table reachable from a stated attempt", () => {
    // The other direction: a reason nobody can say what it is for suggests
    // either a rule with no threat behind it or a threat nobody wrote down.
    const rendered = reasons.filter((reason) => malicious.includes(reason))
    expect(reasons.filter((reason) => !rendered.includes(reason))).toEqual([])
  })

  it("concedes the attack no arithmetic reaches", () => {
    expect(malicious).toMatch(/exactly what it declares and still not what the person wanted/)
    expect(malicious).toMatch(/It does not guarantee that what it does is a good idea/)
  })

  it("states what an endpoint learns, including what it does not", () => {
    expect(malicious).toMatch(/Discovery is anonymous by construction/)
    expect(malicious).toMatch(/one payment address and a\s+network/)
    expect(malicious).toMatch(/never learns is what the wallet\s+holds/)
  })
})

describe("metadata that lies", () => {
  const lying = slice("Metadata that lies", 4)

  it("separates the words from the declaration", () => {
    expect(lying).toMatch(/only one of them is\s+compared/)
    expect(lying).toMatch(/a schema cannot read a sentence/)
    expect(lying).toMatch(/The intent is the declaration/)
  })

  it("gathers the three rules that only work together", () => {
    expect(lying).toMatch(/MUST NOT render the\s+publisher's words in their place/)
    expect(lying).toMatch(/no override, no allowlist/)
    expect(lying).toMatch(/MUST NOT be answered by rebuilding/)
  })

  it("names grinding as the thing a helpful implementation gets wrong", () => {
    expect(lying).toMatch(/cannot grind its way past the gate/)
    expect(lying).toMatch(/A retry\s+that eventually succeeds is indistinguishable/)
  })
})

describe("replay", () => {
  const replay = slice("Replay", 4)

  it("keeps a shared link safe to reshare, and forbids a secret in one", () => {
    expect(replay).toMatch(/The link is meant to be replayed/)
    expect(replay).toMatch(/MUST NOT place a secret in one/)
    expect(replay).toMatch(/MUST NOT authenticate by anything a client is forbidden to send/)
  })

  it("explains why an intent and an unsigned transaction replay harmlessly", () => {
    expect(replay).toMatch(/A partial intent replays harmlessly/)
    expect(replay).toMatch(/spends\s+their own funds/)
    expect(replay).toMatch(/An unsigned transaction is not a bearer instrument/)
  })

  it("gives the eUTxO answer for a submitted transaction and names the window before it", () => {
    expect(replay).toMatch(/the ledger\s+consumes its inputs/)
    expect(replay).toMatch(/the input set is the anti-replay\s+device/)
    expect(replay).toMatch(/submitted by anyone who obtains it/)
    expect(replay).toMatch(/cannot recall it/)
  })

  it("ties the window to the interval rules that bound it", () => {
    expect(replay).toMatch(/MUST NOT set\s+an interval ending after `validUntil`/)
    expect(replay).toMatch(/SHOULD set a shorter one/)
    expect(replay).toMatch(/MUST NOT\s+retain a signed transaction beyond the submission/)
  })
})

describe("origin spoofing", () => {
  const spoofing = slice("Origin spoofing", 4)

  it("makes the origin the identity the protocol establishes, and requires showing it", () => {
    expect(spoofing).toMatch(/only identity this protocol establishes on its own/)
    expect(spoofing).toMatch(/MUST show that origin where the person can see it at\s+the moment they act/)
  })

  it("keeps a publisher's own string out of the place the origin goes", () => {
    expect(spoofing).toMatch(/MUST NOT render a publisher-supplied string in place of the origin/)
    expect(spoofing).toMatch(/it is the attacker's own field/)
  })

  it("says a link preview proves nothing", () => {
    expect(spoofing).toMatch(/A link preview is not evidence/)
    expect(spoofing).toMatch(/never run the comparison/)
  })

  it("concedes the lookalike domain and hands it to the identity layer", () => {
    expect(spoofing).toMatch(/no derivation can separate them/)
    expect(spoofing).toMatch(/\[CIP-13\]/)
    expect(spoofing).toMatch(/identity\s+layer exists to narrow/)
  })
})

describe("server-balanced builds", () => {
  const modeB = slice("Server-balanced builds, and what they disclose", 4)

  it("states the v1 privacy property as structural rather than promised", () => {
    // Hard invariant 2 in CLAUDE.md: the client never sends the UTxO set. In
    // v1 there is no field it could travel in, and that is the claim.
    expect(modeB).toMatch(/closed object of two\s+fields/)
    expect(modeB).toMatch(/no shape in this version through which a UTxO set could travel/)
  })

  it("says what the disclosure costs, and that it cannot be taken back", () => {
    expect(modeB).toMatch(/picture of everything the person holds/)
    expect(modeB).toMatch(/A signature can be refused after\s+the fact. A disclosure cannot/)
  })

  it("requires the endpoint to declare the mode", () => {
    expect(modeB).toMatch(/MUST declare `build: "server"`/)
    expect(modeB).toMatch(/MUST NOT ask for a wallet's unspent\s+outputs under any other declaration/)
  })

  it("requires the client to warn, and refuses outright in this version", () => {
    expect(modeB).toMatch(/MUST NOT disclose the wallet's unspent outputs without first\s+telling the person/)
    expect(modeB).toMatch(/agreement MUST NOT be\s+remembered as a default/)
    expect(modeB).toMatch(/MUST fail with\s+`UNSUPPORTED_BUILD_MODE`/)
    expect(failureCodes).toContain("UNSUPPORTED_BUILD_MODE")
  })

  it("leaves the comparison untouched by the mode", () => {
    expect(modeB).toMatch(/Nothing about the mode touches \[The comparison\]/)
    expect(modeB).toMatch(/same derivation and the same block/)
  })
})

describe("publisher identity", () => {
  const identity = slice("Publisher identity", 4)

  it("separates what a transaction proves from what an attestation proves", () => {
    expect(identity).toMatch(/The comparison proves what a transaction does/)
    expect(identity).toMatch(/says nothing about who\s+published the link/)
  })

  it("describes the CIP-170 hook and what CIP-170 does not supply", () => {
    // ADR-0006: the CIP anchors a digest of arbitrary data and has no
    // domain-to-identifier discovery. Claiming otherwise in a public spec is
    // the mistake that ADR exists to prevent us repeating.
    expect(identity).toMatch(/\[CIP-170\]/)
    expect(identity).toMatch(/key event log/)
    expect(identity).toMatch(/label `170`/)
    expect(identity).toMatch(/defines no\s+publisher payload/)
    expect(identity).toMatch(/which identifier should I trust/)
    expect(identity).toMatch(/\[CIP-186\]/)
  })

  it("defines the relationship rather than the mechanism", () => {
    expect(identity).toMatch(/This version defines neither that payload nor its resolution/)
  })

  it("forbids identity from relaxing the effects gate", () => {
    // Hard invariant 3, seen from the identity layer. This is the sentence a
    // commercial partner asks to have softened.
    expect(identity).toMatch(/An attestation MUST NOT relax any rule in \[The\s+comparison\]/)
    expect(identity).toMatch(/an allowlist\s+is the registry this protocol exists in order not to need/)
  })

  it("keeps an unresolved attestation from blocking and from rendering as verified", () => {
    expect(identity).toMatch(/MUST NOT block a Slip, and MUST NOT\s+render as verified/)
    expect(identity).toMatch(/Absent, malformed, expired, revoked and valid/)
    expect(identity).toMatch(/MUST NOT require an attestation in order to render a Slip/)
  })

  it("keeps a badge from standing in for the arithmetic", () => {
    expect(identity).toMatch(/never in place of the\s+derived effects/)
    expect(identity).toMatch(/badge is what an attacker buys/)
  })

  it("agrees with the blocking section, which already forbids a verified badge relaxing the rule", () => {
    expect(slice("Blocking", 3)).toMatch(/no verified badge that\s+relaxes the rule/)
  })
})

describe("the limits the section admits to", () => {
  const limits = slice("What this document does not defend against", 4)

  it("names the person who signs a transaction that does what it says", () => {
    expect(limits).toMatch(/an honest Slip paying an attacker's address is\s+an honest Slip/)
  })

  it("names the compromised client and the compromised wallet", () => {
    expect(limits).toMatch(/A compromised client/)
    expect(limits).toMatch(/nothing in this document\s+reaches below it/)
    expect(limits).toMatch(/A compromised or hostile wallet/)
  })

  it("does not claim to make a counterparty trustworthy", () => {
    expect(limits).toMatch(/does not make the counterparty\s+trustworthy/)
    // Hard invariant 5: nothing here ever holds funds, so there is no dispute
    // mechanism to offer and the section says so rather than implying one.
    expect(limits).toMatch(/nothing here\s+ever holds anyone's funds/)
  })
})

describe("the codes and links the section cites", () => {
  it("cites only failure codes the failure table defines", () => {
    const methods = ["GET", "POST", "OPTIONS"]
    const cited = [...security.matchAll(/`([A-Z][A-Z_]+)`/g)]
      .map((match) => match[1])
      .filter((token) => !methods.includes(token))
    expect(cited.length).toBeGreaterThan(0)
    expect([...new Set(cited)].filter((code) => !failureCodes.includes(code))).toEqual([])
  })

  it("defines every link reference it uses", () => {
    const used = new Set([...security.matchAll(/\[(CIP-\d+|RFC \d+|CPS-\d+)\]/g)].map((match) => match[1]))
    const undefinedRefs = [...used].filter((label) => !source.includes(`\n[${label}]: `))
    expect(undefinedRefs).toEqual([])
  })

  it("points every section link at a heading that exists", () => {
    const anchors = [...security.matchAll(/\]\(#([a-z0-9-]+)\)/g)].map((match) => match[1])
    expect(anchors.length).toBeGreaterThan(4)
    const headings = [...source.matchAll(/^#{2,4} (.+)$/gm)].map((match) =>
      match[1]
        .toLowerCase()
        .replace(/[^a-z0-9 -]/g, "")
        .replaceAll(" ", "-")
    )
    expect([...new Set(anchors)].filter((anchor) => !headings.includes(anchor))).toEqual([])
  })
})
