/** `pnpm --filter @cardano-slips/example-slips serve`: the examples on localhost, one origin for all of them. */
import { createExampleServer } from "./server.js"

const port = Number(process.env.PORT ?? 4010)
const origin = `http://localhost:${port}`

createExampleServer(origin).listen(port, () => {
  process.stdout.write(`Example Slips at ${origin}/tip and ${origin}/delegate\n`)
})
