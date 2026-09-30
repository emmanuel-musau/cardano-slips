/**
 * The example Slips on preview over HTTP, for the slip page to open during development.
 * A path nothing serves still answers with CORS, or the browser would hide the
 * 404 and a missing `slips.json` would read as an endpoint that never answered.
 */
import { createServer, type Server } from "node:http"

import { type NodeHandler, toNodeHandler } from "@cardano-slips/server/adapters/node"

import { previewDelegate, previewTip } from "./preview.js"

export const createExampleServer = (origin: string): Server => {
  const routes: Readonly<Record<string, NodeHandler>> = {
    "/tip": toNodeHandler(previewTip, { origin }),
    "/delegate": toNodeHandler(previewDelegate, { origin })
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
