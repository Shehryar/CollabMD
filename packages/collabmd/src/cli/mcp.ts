import { spawnSync } from 'child_process'
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { dirname, resolve } from 'path'

const require = createRequire(import.meta.url)

interface McpCommandOptions {
  apiKey?: string
  serverUrl?: string
  baseUrl?: string
}

interface McpServerPackageJson {
  bin?: string | Record<string, string>
}

function resolveMcpBinPath(): string {
  const packageJsonPath = require.resolve('@collabmd/mcp-server/package.json')
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as McpServerPackageJson
  const binValue =
    typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin?.['collabmd-mcp']

  if (!binValue) {
    throw new Error('Could not locate collabmd-mcp bin in @collabmd/mcp-server package.json')
  }

  return resolve(dirname(packageJsonPath), binValue)
}

export function mcpCommand(options: McpCommandOptions): void {
  let binaryPath: string
  try {
    binaryPath = resolveMcpBinPath()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    console.error(`Failed to resolve MCP server binary: ${message}`)
    process.exitCode = 1
    return
  }

  const args: string[] = [binaryPath]
  const serverUrl = options.baseUrl || options.serverUrl
  if (serverUrl) args.push('--base-url', serverUrl)
  if (options.apiKey) args.push('--api-key', options.apiKey)

  const result = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    env: process.env,
  })

  if (result.error) {
    console.error(`Failed to start MCP server: ${result.error.message}`)
    process.exitCode = 1
    return
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exitCode = result.status
  }
}

export function mcpConfigCommand(options: McpCommandOptions): void {
  const serverUrl =
    options.baseUrl ||
    options.serverUrl ||
    process.env.COLLABMD_SERVER_URL ||
    'http://localhost:3000'
  if (options.apiKey) {
    console.error(
      'Warning: --api-key is not embedded verbatim in output. Replace <set-your-agent-api-key> before using the config snippet.',
    )
  }

  const config = {
    mcpServers: {
      collabmd: {
        command: 'pnpm',
        args: [
          'exec',
          'collabmd',
          'mcp',
          '--api-key',
          '<set-your-agent-api-key>',
          '--base-url',
          serverUrl,
        ],
      },
    },
  }

  console.log(JSON.stringify(config, null, 2))
}
