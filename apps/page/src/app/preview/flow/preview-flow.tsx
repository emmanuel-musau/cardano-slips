"use client"

import { useState } from "react"

import { SlipPage } from "../../../slip-page/slip-page.js"
import { previewHost, type Scenario } from "./wallet.js"

/** Built in the browser: a wallet is functions, and those cannot cross from a server component. */
export const PreviewFlow = ({ link, scenario }: { readonly link: string | undefined; readonly scenario: Scenario }) => {
  const [host] = useState(() => previewHost(scenario))
  return <SlipPage link={link} walletHost={host} />
}
