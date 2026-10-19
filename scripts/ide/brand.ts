// Applies Bobi branding to vendor/code-oss (ADR-0008, ADR-0012). Idempotent: always starts from the pinned
// upstream product.json. Icon from $BOBI_BRANDING_DIR/icon.svg (company pack) or branding/default/icon.svg.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..", "..")
export const CODE_OSS = path.join(ROOT, "vendor", "code-oss")

/** Keys removed from product.json: Copilot/chat entitlement wiring and services outside the company network. */
export const REMOVED_KEYS = [
  "defaultChatAgent",
  "trustedExtensionAuthAccess",
  "voiceWsUrl",
  "webviewContentExternalBaseUrlTemplate",
  "agentsTelemetryAppName",
  "extensionsGallery",
  "updateUrl",
]

export const BRANDING = {
  nameShort: "Bobi IDE",
  nameLong: "Bobi IDE",
  applicationName: "bobi-ide",
  dataFolderName: ".bobi-ide",
  sharedDataFolderName: ".bobi-ide-shared",
  serverApplicationName: "bobi-ide-server",
  serverDataFolderName: ".bobi-ide-server",
  tunnelApplicationName: "bobi-ide-tunnel",
  urlProtocol: "bobi-ide",
  darwinBundleIdentifier: "dev.bobi.ide",
  darwinProfileUUID: "6B1D5C8E-1F0B-4E57-9C2A-0B0B1D0E1D01",
  darwinProfilePayloadUUID: "6B1D5C8E-1F0B-4E57-9C2A-0B0B1D0E1D02",
  linuxDesktopName: "bobi-ide",
  linuxIconName: "bobi-ide",
  win32DirName: "Bobi IDE",
  win32NameVersion: "Bobi IDE",
  win32RegValueName: "BobiIDE",
  win32AppUserModelId: "Bobi.IDE",
  win32ShellNameShort: "B&obi IDE",
  win32MutexName: "bobiide",
  win32TunnelMutex: "bobiide-tunnel",
  win32TunnelServiceMutex: "bobiide-tunnelservice",
  win32x64AppId: "{6B1D5C8E-1F0B-4E57-9C2A-0B0B1D0E1D10}",
  win32arm64AppId: "{6B1D5C8E-1F0B-4E57-9C2A-0B0B1D0E1D11}",
  win32x64UserAppId: "{6B1D5C8E-1F0B-4E57-9C2A-0B0B1D0E1D12}",
  win32arm64UserAppId: "{6B1D5C8E-1F0B-4E57-9C2A-0B0B1D0E1D13}",
  licenseName: "MIT",
  licenseUrl: "https://github.com/weski17/bobi/blob/main/LICENSE",
  reportIssueUrl: "https://github.com/weski17/bobi/issues/new",
  // Required list (iterated at startup); upstream lists the Copilot extension here.
  builtInExtensionsEnabledWithAutoUpdates: [],
} as const

const git = (...args: string[]) => {
  const r = Bun.spawnSync(["git", "-C", CODE_OSS, ...args], { stdout: "pipe", stderr: "pipe" })
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`)
  return r.stdout.toString()
}

export function brandedProduct(upstream: Record<string, unknown>): Record<string, unknown> {
  const product: Record<string, unknown> = { ...upstream, ...BRANDING }
  for (const key of REMOVED_KEYS) delete product[key]
  return product
}

function run(cmd: string[]) {
  const r = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" })
  if (r.exitCode !== 0) throw new Error(`${cmd[0]} failed: ${r.stderr.toString()}`)
}

/** macOS: SVG → .icns with system tools (qlmanage, sips, iconutil). */
export function buildIcns(svg: string, target: string) {
  const work = mkdtempSync(path.join(tmpdir(), "bobi-icon-"))
  try {
    run(["qlmanage", "-t", "-s", "1024", "-o", work, svg])
    const png = path.join(work, readdirSync(work).find((f) => f.endsWith(".png"))!)
    const iconset = path.join(work, "bobi.iconset")
    mkdirSync(iconset)
    for (const size of [16, 32, 128, 256, 512]) {
      run(["sips", "-z", String(size), String(size), png, "--out", path.join(iconset, `icon_${size}x${size}.png`)])
      run(["sips", "-z", String(size * 2), String(size * 2), png, "--out", path.join(iconset, `icon_${size}x${size}@2x.png`)])
    }
    run(["iconutil", "-c", "icns", iconset, "-o", target])
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  const upstream = JSON.parse(git("show", "HEAD:product.json")) as Record<string, unknown>
  writeFileSync(path.join(CODE_OSS, "product.json"), `${JSON.stringify(brandedProduct(upstream), null, "\t")}\n`)
  const pack = process.env.BOBI_BRANDING_DIR ? path.resolve(process.env.BOBI_BRANDING_DIR) : path.join(ROOT, "branding", "default")
  const svg = path.join(pack, "icon.svg")
  if (process.platform === "darwin" && existsSync(svg)) {
    buildIcns(svg, path.join(CODE_OSS, "resources", "darwin", "code.icns"))
    console.log(`branded vendor/code-oss (icon: ${path.relative(ROOT, svg)})`)
  } else console.log("branded vendor/code-oss product.json (icon unchanged: not macOS or no icon.svg)")
}
