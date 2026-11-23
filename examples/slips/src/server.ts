/**
 * The example Slips on preview over HTTP, for the slip page to open during development.
 * A path nothing serves still answers with CORS, or the browser would hide the
 * 404 and a missing `slips.json` would read as an endpoint that never answered.
 */
import { createServer, type Server } from "node:http"

import type { SlipEndpoint } from "@cardano-slips/server"
import { type NodeHandler, toNodeHandler } from "@cardano-slips/server/adapters/node"

import { previewDelegate, previewTip } from "./preview.js"

export type ExampleSlips = { readonly tip: SlipEndpoint; readonly delegate: SlipEndpoint }

export const createExampleServer = (
  origin: string,
  slips: ExampleSlips = { tip: previewTip, delegate: previewDelegate }
): Server => {
  const routes: Readonly<Record<string, NodeHandler>> = {
    "/tip": toNodeHandler(slips.tip, { origin }),
    "/delegate": toNodeHandler(slips.delegate, { origin })
  }

  return createServer((request, response) => {
    const handler = routes[new URL(request.url ?? "/", origin).pathname]
    if (handler === undefined) {
      response.writeHead(404, { "access-control-allow-origin": "*" }).end()
      return
    }
    void handler(request, response)
  })
}
