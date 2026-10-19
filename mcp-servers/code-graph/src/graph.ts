// Static code graph for TypeScript/JavaScript projects (requirement 16): symbols, call edges and file imports,
// resolved with the TypeScript compiler. Dynamic calls (computed property access, eval, reflection) are not visible.
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import ignore, { type Ignore } from "ignore"
import ts from "typescript"
import { BobiIgnore } from "@bobi/core/bobiignore"

export type SymbolKind = "function" | "method" | "class" | "variable" | "module"

export type CodeSymbol = {
  /** `<relative file>#<qualified name>`, e.g. `src/user.ts#UserService.save`; `#<module>` for top-level code. */
  readonly id: string
  readonly name: string
  readonly kind: SymbolKind
  readonly file: string
  readonly line: number
}

const EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"])
const ALWAYS_SKIPPED = new Set(["node_modules", ".git", ".bobi", "dist", "build", "out", "coverage"])
const MAX_FILES = 20_000

export class CodeGraph {
  readonly symbols = new Map<string, CodeSymbol>()
  readonly calls = new Map<string, Set<string>>()
  readonly callers = new Map<string, Set<string>>()
  readonly imports = new Map<string, Set<string>>()
  readonly importers = new Map<string, Set<string>>()
  private stamps = new Map<string, number>()

  private constructor(readonly root: string) {}

  static build(root: string): CodeGraph {
    const graph = new CodeGraph(path.resolve(root))
    graph.index(listSourceFiles(graph.root))
    return graph
  }

  /** True when files were added, removed or changed since the graph was built. */
  stale(): boolean {
    const files = listSourceFiles(this.root)
    if (files.length !== this.stamps.size) return true
    return files.some((f) => this.stamps.get(f) !== statSync(f, { throwIfNoEntry: false })?.mtimeMs)
  }

  rel(file: string): string {
    return path.relative(this.root, file).replaceAll("\\", "/")
  }

  private link(map: Map<string, Set<string>>, from: string, to: string) {
    let set = map.get(from)
    if (!set) map.set(from, (set = new Set()))
    set.add(to)
  }

  private index(files: string[]) {
    for (const f of files) this.stamps.set(f, statSync(f).mtimeMs)
    const options: ts.CompilerOptions = {
      allowJs: true,
      noEmit: true,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.Preserve,
      skipLibCheck: true,
      types: [],
      allowImportingTsExtensions: true,
    }
    const program = ts.createProgram(files, options)
    const checker = program.getTypeChecker()
    const fileSet = new Set(files)
    const declared = new Map<ts.Node, string>()
    const sources = program.getSourceFiles().filter((sf) => fileSet.has(path.resolve(sf.fileName)))

    // Pass 1: declarations.
    for (const sf of sources) {
      const file = this.rel(path.resolve(sf.fileName))
      const add = (node: ts.Node, name: string, kind: SymbolKind) => {
        const id = `${file}#${name}`
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
        this.symbols.set(id, { id, name: name.split(".").at(-1)!, kind, file, line })
        declared.set(node, id)
      }
      this.symbols.set(`${file}#<module>`, { id: `${file}#<module>`, name: "<module>", kind: "module", file, line: 1 })
      const visit = (node: ts.Node, owner?: string) => {
        if (ts.isFunctionDeclaration(node) && node.name) add(node, node.name.text, "function")
        else if (ts.isClassDeclaration(node) && node.name) {
          add(node, node.name.text, "class")
          for (const member of node.members) {
            if ((ts.isMethodDeclaration(member) || ts.isGetAccessor(member) || ts.isSetAccessor(member)) && member.name && ts.isIdentifier(member.name))
              add(member, `${node.name.text}.${member.name.text}`, "method")
            else if (ts.isConstructorDeclaration(member)) add(member, `${node.name.text}.constructor`, "method")
            else if (ts.isPropertyDeclaration(member) && member.initializer && isFunctionLike(member.initializer) && ts.isIdentifier(member.name))
              add(member, `${node.name.text}.${member.name.text}`, "method")
          }
        } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isFunctionLike(node.initializer) && !owner)
          add(node, node.name.text, "variable")
        const inside = ts.isFunctionLike(node) ? (owner ?? "fn") : owner
        ts.forEachChild(node, (child) => visit(child, inside))
      }
      visit(sf)
    }

    // Pass 2: call edges and imports.
    const resolveDeclaration = (expr: ts.Expression): string | undefined => {
      const target = ts.isPropertyAccessExpression(expr) ? expr.name : expr
      let symbol = checker.getSymbolAtLocation(target)
      if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
      for (const decl of symbol?.declarations ?? []) {
        const id = declared.get(decl) ?? (ts.isClassDeclaration(decl) ? undefined : declared.get(decl.parent))
        if (id) return id
      }
      return undefined
    }
    for (const sf of sources) {
      const absolute = path.resolve(sf.fileName)
      const file = this.rel(absolute)
      const addImport = (specifier: string) => {
        const resolved = ts.resolveModuleName(specifier, absolute, options, ts.sys).resolvedModule?.resolvedFileName
        if (resolved && fileSet.has(path.resolve(resolved))) {
          const target = this.rel(path.resolve(resolved))
          if (target !== file) {
            this.link(this.imports, file, target)
            this.link(this.importers, target, file)
          }
        }
      }
      const visit = (node: ts.Node, current: string) => {
        const own = declared.get(node)
        const scope = own && this.symbols.get(own)?.kind !== "class" ? own : current
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
          addImport(node.moduleSpecifier.text)
        if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
          const arg = node.arguments?.[0]
          const isImportCall = ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))
          if (isImportCall && arg && ts.isStringLiteralLike(arg)) addImport(arg.text)
          else {
            let callee = resolveDeclaration(node.expression)
            // `new Foo()` calls the constructor when there is one.
            if (callee && ts.isNewExpression(node) && this.symbols.has(`${callee}.constructor`)) callee = `${callee}.constructor`
            if (callee && callee !== scope) {
              this.link(this.calls, scope, callee)
              this.link(this.callers, callee, scope)
            }
          }
        }
        ts.forEachChild(node, (child) => visit(child, scope))
      }
      visit(sf, `${file}#<module>`)
    }
  }
}

function isFunctionLike(node: ts.Node): boolean {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node)
}

function loadIgnore(root: string): Ignore | undefined {
  try {
    return ignore().add(readFileSync(path.join(root, ".gitignore"), "utf8"))
  } catch {
    return undefined
  }
}

/** Source files under root, without node_modules, build output, .gitignore'd and .bobiignore'd files. */
export function listSourceFiles(root: string): string[] {
  const gitignore = loadIgnore(root)
  const bobiignore = new BobiIgnore(root)
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= MAX_FILES) return
      const full = path.join(dir, entry.name)
      const relative = path.relative(root, full).replaceAll("\\", "/")
      if (entry.isDirectory()) {
        if (ALWAYS_SKIPPED.has(entry.name) || gitignore?.ignores(`${relative}/`) || bobiignore.ignores(full)) continue
        walk(full)
      } else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name)) && !entry.name.endsWith(".d.ts")) {
        if (gitignore?.ignores(relative) || bobiignore.ignores(full)) continue
        out.push(full)
      }
    }
  }
  walk(root)
  return out
}
