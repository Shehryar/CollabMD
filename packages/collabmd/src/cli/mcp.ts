import { spawnSync } from 'child_process'
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { dirname, resolve } from 'path'

const require = createRequire(import.meta.url)

interface McpCommandOptions {
  apiKey?: string
  serverUrl?: string
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
  if (options.serverUrl) args.push('--server-url', options.serverUrl)
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
  const serverUrl = options.serverUrl || process.env.COLLABMD_SERVER_URL || 'http://localhost:3000'
  if (options.apiKey) {
    console.error(
      'Warning: --api-key is not embedded in output to avoid leaking secrets. Set COLLABMD_API_KEY in the MCP env block.',
    )
  }

  const config = {
    mcpServers: {
      collabmd: {
        command: 'npx',
        args: ['collabmd-mcp', '--server-url', serverUrl],
        env: {
          COLLABMD_API_KEY: '<set-your-agent-api-key>',
        },
      },
    },
  }

  console.log(JSON.stringify(config, null, 2))
}
