import { join } from "node:path"
import { describeDependencyRules } from "../../../test/support/workspace.js"

/**
 * `server` never imports `flow` or `verifier`. Reaching for `verifier` to check
 * an intent before returning it looks reasonable and is still wrong: the
 * comparison runs in the client, so an endpoint would be checking its own work.
 */
describeDependencyRules("server", {
  packageRoot: join(import.meta.dirname, ".."),
  forbidden: ["@cardano-slips/flow", "@cardano-slips/verifier"],
  // No framework: a second copy of a publisher's framework is a bug we would have shipped them.
  allowed: ["@cardano-slips/core", "effect"],
  nodeBuiltins: true
})
