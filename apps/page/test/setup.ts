import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

/**
 * The workspace runs with `globals: false`, so Testing Library never finds an
 * `afterEach` to hook itself onto and the tree one test rendered is still in
 * the document for the next one. Unmounting is ours to ask for.
 */
afterEach(cleanup)
