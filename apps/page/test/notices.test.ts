import { ExchangeError } from "@cardano-slips/flow"
import { describe, expect, it } from "vitest"

import { noticeFor, retryDelay } from "../src/slip-page/notices.js"

const failure = (fields: Partial<ConstructorParameters<typeof ExchangeError>[0]>) =>
  new ExchangeError({ errorClass: "terminal", detail: "", ...fields })

describe("the notice for a failed read", () => {
  it.each([
    ["a NOT_FOUND the endpoint sent", { code: "NOT_FOUND" }, "This link doesn't point to anything", "site"],
    ["a bare 404", { status: 404 }, "This link doesn't point to anything", "site"],
    ["a bare 410", { status: 410 }, "This link doesn't point to anything", "site"],
    ["no answer at all", { code: "UNREACHABLE", errorClass: "transient" }, "linktap.example didn't respond", "retry"],
    ["a bare 502", { status: 502, errorClass: "transient" }, "linktap.example didn't respond", "retry"],
    ["a rate limit", { code: "RATE_LIMITED", errorClass: "transient" }, "Too many requests just now", "retry"],
    ["a newer protocol", { code: "UNSUPPORTED_VERSION" }, "This link speaks a newer version", "site"],
    [
      "an unreadable Slip",
      { code: "MALFORMED_RESPONSE" },
      "linktap.example sent something this page can't read",
      "site"
    ],
    ["a code the spec does not define", { code: "TRY_LATER" }, "linktap.example couldn't open this action", "site"]
  ] as const)("names the host and one move for %s", (_, fields, title, move) => {
    const notice = noticeFor(failure(fields), "linktap.example")
    expect(notice.title).toBe(title)
    expect(notice.move).toBe(move)
  })

  // 8d, as drawn, says what is missing instead: there was never anything to sign.
  it("says nothing was signed where an answer never came", () => {
    for (const fields of [{ code: "UNREACHABLE", errorClass: "transient" as const }, { status: 500 }]) {
      expect(noticeFor(failure(fields), "linktap.example").text).toMatch(/Nothing was signed|nothing was signed/)
    }
  })

  it("keeps the endpoint's words apart from its own, and the code out of the sentence", () => {
    const notice = noticeFor(failure({ code: "NOT_FOUND", endpointMessage: "No such shop." }), "linktap.example")
    expect(notice.said).toBe("No such shop.")
    expect(notice.code).toBe("NOT_FOUND")
    expect(notice.text).not.toContain("NOT_FOUND")
  })
})

describe("the wait before a retry", () => {
  it("is at least a second, and grows with each attempt", () => {
    expect([0, 1, 2, 3].map((retries) => retryDelay(retries, undefined))).toEqual([1, 2, 4, 8])
  })

  it("is never shorter than the endpoint asked for", () => {
    expect(retryDelay(0, 30)).toBe(30)
    expect(retryDelay(6, 30)).toBe(64)
  })
})
