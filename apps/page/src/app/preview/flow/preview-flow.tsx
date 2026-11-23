"use client"

import { useState } from "react"

import { SlipPage } from "../../../slip-page/slip-page.js"
import { type PreviewNetwork, previewHost, type Scenario } from "./wallet.js"

/** Built in the browser: a wallet is functions, and those cannot cross from a server component. */
export const PreviewFlow = ({
  link,
  network,
  scenario
}: {
  readonly link: string | undefined
  readonly network: PreviewNetwork
  readonly scenario: Scenario
}) => {
  const [host] = useState(() => previewHost(scenario, { network }))
  return <SlipPage link={link} walletHost={host} />
}
