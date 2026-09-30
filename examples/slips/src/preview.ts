/** The examples on preview, which the slip page serves during development. Both wallets are recorded in `docs/team-wallets.json`. */
import { delegateSlip } from "./delegate.js"
import { tipSlip } from "./tip.js"

export const previewRecipient =
  "addr_test1qqwxxk8tjthrr8syjv2q3fdzusj8ps2ttj705y4pfq55ezv5frdaskp3avvresmn6flvgurlwxt7dhwcm8p9wg0ghc0sn8s9v3"

export const previewPool = "pool1mfc42za8tj74zc66ez3slwtq4mumdl7yrylaxajd5xugujmhd0c"

export const previewTip = tipSlip("preview", previewRecipient)

export const previewDelegate = delegateSlip("preview", previewPool)
