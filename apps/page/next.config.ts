import type { NextConfig } from "next"

const config: NextConfig = {
  poweredByHeader: false,
  // `next dev` otherwise writes its own AGENTS.md and CLAUDE.md here; the repo root carries ours.
  agentRules: false
}

export default config
