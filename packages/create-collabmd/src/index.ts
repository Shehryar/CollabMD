#!/usr/bin/env node

import { runOnboardingFlow } from '../../collabmd/src/cli/onboarding.js'

export async function runCreateCollabmd(argv: string[] = process.argv.slice(2)): Promise<void> {
  await runOnboardingFlow({
    argv,
    cwdMode: false,
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCreateCollabmd().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
