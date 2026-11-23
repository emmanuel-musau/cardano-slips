/** The preview examples for the browser tests, with the stake key read as unregistered instead of asking Koios. */
import { createExampleServer, delegateSlip, previewPool, previewTip } from "@cardano-slips/example-slips"

const examplesPort = 4011

createExampleServer(`http://localhost:${examplesPort}`, {
  tip: previewTip,
  delegate: delegateSlip("preview", previewPool, async () => false)
}).listen(examplesPort)
