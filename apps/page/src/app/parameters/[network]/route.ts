import type { Network } from "@cardano-slips/core"
import { Koios } from "@evolution-sdk/evolution/sdk/provider/Koios"

import { answerFor } from "./answer.js"

const koios: Readonly<Record<Network, Koios>> = {
  mainnet: new Koios("https://api.koios.rest/api/v1", process.env.KOIOS_TOKEN),
  preprod: new Koios("https://preprod.koios.rest/api/v1", process.env.KOIOS_TOKEN),
  preview: new Koios("https://preview.koios.rest/api/v1", process.env.KOIOS_TOKEN)
}

export const GET = answerFor((network) => koios[network].getProtocolParameters())
