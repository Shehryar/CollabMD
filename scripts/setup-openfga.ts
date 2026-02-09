import { existsSync, mkdirSync, chmodSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'

const VERSION = '1.8.9'
const CACHE_DIR = join(process.cwd(), 'node_modules', '.cache', 'openfga')

function getPlatformInfo(): { os: string; arch: string; ext: string } {
  const platform = process.platform
  const arch = process.arch

  const osMap: Record<string, string> = {
    darwin: 'darwin',
    linux: 'linux',
    win32: 'windows',
  }
  const archMap: Record<string, string> = {
    arm64: 'arm64',
    x64: 'amd64',
  }

  const os = osMap[platform]
  const mappedArch = archMap[arch]
  if (!os || !mappedArch) {
    throw new Error(`Unsupported platform: ${platform}/${arch}`)
  }

  return { os, arch: mappedArch, ext: platform === 'win32' ? '.exe' : '' }
}

function getBinaryPath(): string {
  const { ext } = getPlatformInfo()
  return join(CACHE_DIR, `openfga${ext}`)
}

function download(): string {
  const { os, arch } = getPlatformInfo()
  const binaryPath = getBinaryPath()

  if (existsSync(binaryPath)) {
    console.log(`OpenFGA binary already cached at ${binaryPath}`)
    return binaryPath
  }

  mkdirSync(CACHE_DIR, { recursive: true })

  const filename = `openfga_${VERSION}_${os}_${arch}.tar.gz`
  const url = `https://github.com/openfga/openfga/releases/download/v${VERSION}/${filename}`
  const tarPath = join(CACHE_DIR, filename)

  console.log(`Downloading OpenFGA v${VERSION} for ${os}/${arch}...`)
  execSync(`curl -fsSL -o "${tarPath}" "${url}"`, { stdio: 'inherit' })

  console.log('Extracting...')
  execSync(`tar -xzf "${tarPath}" -C "${CACHE_DIR}" openfga`, { stdio: 'inherit' })
  chmodSync(binaryPath, 0o755)

  execSync(`rm "${tarPath}"`)
  console.log(`OpenFGA binary ready at ${binaryPath}`)
  return binaryPath
}

export { download, getBinaryPath, VERSION }

if (import.meta.url === `file://${process.argv[1]}`) {
  download()
}
