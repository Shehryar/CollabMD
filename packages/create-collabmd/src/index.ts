#!/usr/bin/env node

import prompts from 'prompts'
import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'

async function main() {
  const args = process.argv.slice(2)
  let projectName = args[0]

  if (!projectName) {
    const response = await prompts({
      type: 'text',
      name: 'name',
      message: 'Project name:',
      initial: 'my-collabmd',
    })
    projectName = response.name
    if (!projectName) {
      console.log('Cancelled.')
      process.exit(0)
    }
  }

  const { server } = await prompts({
    type: 'select',
    name: 'server',
    message: 'Where will this project sync?',
    choices: [
      { title: 'Local only (no server)', value: 'local' },
      { title: 'CollabMD Cloud', value: 'https://collabmd.dev' },
      { title: 'Self-hosted', value: 'self-hosted' },
    ],
    initial: 0,
  })

  let serverUrl: string | undefined
  if (server === 'self-hosted') {
    const res = await prompts({
      type: 'text',
      name: 'url',
      message: 'Server URL:',
      initial: 'http://localhost:3000',
    })
    serverUrl = res.url
  } else if (server === 'https://collabmd.dev') {
    serverUrl = server
  }

  const projectDir = resolve(process.cwd(), projectName)

  if (existsSync(projectDir)) {
    console.error(`Directory "${projectName}" already exists.`)
    process.exit(1)
  }

  mkdirSync(projectDir, { recursive: true })
  mkdirSync(join(projectDir, 'docs'))
  mkdirSync(join(projectDir, '.collabmd'))

  // collabmd.json
  const config: Record<string, unknown> = { name: projectName }
  if (serverUrl) config.server = serverUrl
  writeFileSync(join(projectDir, 'collabmd.json'), JSON.stringify(config, null, 2) + '\n')

  // COLLABMD.md
  writeFileSync(
    join(projectDir, 'COLLABMD.md'),
    `# ${projectName}\n\nThis project uses [CollabMD](https://collabmd.dev) for collaborative markdown editing.\n\nRun \`npx collabmd dev\` to start editing.\n`,
  )

  // docs/welcome.md
  writeFileSync(
    join(projectDir, 'docs', 'welcome.md'),
    `# Welcome\n\nThis is your first CollabMD document. Edit it locally or in the browser.\n`,
  )

  // .gitignore
  writeFileSync(join(projectDir, '.gitignore'), '.collabmd/\nnode_modules/\n')

  console.log(`\nCreated ${projectName}/`)
  console.log('')
  console.log('  collabmd.json')
  console.log('  COLLABMD.md')
  console.log('  docs/welcome.md')
  console.log('  .collabmd/')
  console.log('  .gitignore')
  console.log('')
  console.log('Next steps:')
  console.log(`  cd ${projectName}`)
  console.log('  npx collabmd dev')
  console.log('')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
