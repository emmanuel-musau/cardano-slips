---
"@cardano-slips/core": patch
---

Read a parameter value as unfilled unless the values object owns it.

The parameter name pattern admits `constructor`, `toString` and the rest of `Object.prototype`, and a plain object answers for every one of them. A parameter named `constructor` that nobody filled substituted `function Object() { [native code] }` into both the button label and the request URL, and a required parameter named `toString` passed the required check while still empty. Lookups are own-property only now.
