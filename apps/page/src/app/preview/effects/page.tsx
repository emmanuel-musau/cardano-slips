import { EffectsPanel } from "@cardano-slips/flow"
import { notFound } from "next/navigation.js"

import { examples } from "./examples.js"

// Example data rendered as if it were a transaction: never on a hosted page.
export const dynamic = "force-dynamic"

export default function EffectsPreview() {
  if (process.env.NODE_ENV === "production") notFound()

  const now = BigInt(Date.now())
  return (
    <main>
      <h1>Effects preview</h1>
      <p>
        Example transactions, one per state the effects panel draws. The letters are the states on the design sheet.
      </p>
      {examples(now).map((example) => (
        <section key={example.id} id={example.id}>
          <h2>{example.title}</h2>
          <EffectsPanel
            claim={example.claim}
            description={example.description}
            origin="linktap.example"
            derived={example.derived}
            verdict={example.reasons === undefined ? { _tag: "match" } : { _tag: "mismatch", reasons: example.reasons }}
          />
        </section>
      ))}
    </main>
  )
}
