import * as certificates from "../attacks/certificates-and-withdrawals.js"
import * as mint from "../attacks/mint-and-validity.js"
import * as value from "../attacks/value-and-recipient.js"

/** The three groups of attack examples, each with the honest transaction its cases are one edit away from. */
export const groups = [
  { name: "value-and-recipient", title: "What it pays, and who it pays", ...value },
  { name: "certificates-and-withdrawals", title: "What it stakes, and what it drains", ...certificates },
  { name: "mint-and-validity", title: "What it creates, and how long it stays submittable", ...mint }
]
