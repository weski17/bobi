// Tips for TypeScript and JavaScript, from the TypeScript compiler's syntax tree (no type checking needed).
import ts from "typescript"
import type { Limits, Tip } from "./types.ts"

type FunctionLike = ts.FunctionLikeDeclaration & { body?: ts.Node }

const BRANCHES = new Set([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.CaseClause,
  ts.SyntaxKind.CatchClause,
])
const NESTING = new Set([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.SwitchStatement,
  ts.SyntaxKind.TryStatement,
])

function scriptKind(file: string): ts.ScriptKind {
  if (/\.tsx$/.test(file)) return ts.ScriptKind.TSX
  if (/\.jsx$/.test(file)) return ts.ScriptKind.JSX
  if (/\.[mc]?js$/.test(file)) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function functionName(node: FunctionLike): string {
  if (node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) || ts.isPrivateIdentifier(node.name))) {
    const owner = ts.isClassLike(node.parent) && node.parent.name ? `${node.parent.name.text}.` : ""
    return `${owner}${node.name.text}`
  }
  if (ts.isConstructorDeclaration(node)) return "constructor"
  const parent = node.parent
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text
  if (parent && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) return parent.name.text
  return "(anonymous function)"
}

/** Complexity and nesting of one function body, not descending into nested functions. */
function measure(body: ts.Node): { complexity: number; nesting: number } {
  let complexity = 1
  let deepest = 0
  const visit = (node: ts.Node, depth: number) => {
    if (ts.isFunctionLike(node)) return
    if (BRANCHES.has(node.kind)) complexity++
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) complexity++
    // `else if` continues the same level.
    const elseIf = ts.isIfStatement(node) && ts.isIfStatement(node.parent) && node.parent.elseStatement === node
    const next = NESTING.has(node.kind) && !elseIf ? depth + 1 : depth
    deepest = Math.max(deepest, next)
    ts.forEachChild(node, (child) => visit(child, next))
  }
  ts.forEachChild(body, (child) => visit(child, 0))
  return { complexity, nesting: deepest }
}

export function analyzeTypeScript(text: string, file: string, limits: Limits): Tip[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file))
  const tips: Tip[] = []
  const line = (pos: number) => source.getLineAndCharacterOfPosition(pos).line + 1
  const isTs = !/\.[mc]?jsx?$/.test(file)
  const visit = (node: ts.Node) => {
    if (ts.isFunctionLike(node) && (node as FunctionLike).body) {
      const fn = node as FunctionLike
      const name = functionName(fn)
      const start = line(fn.getStart(source))
      const end = line(fn.getEnd())
      const { complexity, nesting } = measure(fn.body!)
      const at = { line: start, endLine: end, symbol: name }
      if (complexity > limits.complexity)
        tips.push({ rule: "complexity", severity: "warning", message: `${name} has cyclomatic complexity ${complexity} (limit ${limits.complexity}). Split it into smaller functions.`, ...at })
      if (end - start + 1 > limits.functionLines)
        tips.push({ rule: "function-length", severity: "warning", message: `${name} is ${end - start + 1} lines long (limit ${limits.functionLines}).`, ...at })
      if (nesting > limits.nesting)
        tips.push({ rule: "nesting", severity: "warning", message: `${name} nests blocks ${nesting} levels deep (limit ${limits.nesting}). Return early or extract helpers.`, ...at })
      if (fn.parameters.length > limits.parameters)
        tips.push({ rule: "parameters", severity: "info", message: `${name} takes ${fn.parameters.length} parameters (limit ${limits.parameters}). Consider an options object.`, ...at })
    }
    if (ts.isCatchClause(node) && node.block.statements.length === 0 && !/\/\/|\/\*/.test(node.block.getText(source)))
      tips.push({ rule: "empty-catch", severity: "warning", message: "Empty catch block hides errors. Handle, log or comment why it is safe to ignore.", line: line(node.getStart(source)), endLine: line(node.getEnd()) })
    if (isTs && node.kind === ts.SyntaxKind.AnyKeyword)
      tips.push({ rule: "explicit-any", severity: "info", message: "Explicit `any` turns off type checking here. Prefer `unknown` or a precise type.", line: line(node.getStart(source)), endLine: line(node.getEnd()) })
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(node.operatorToken.kind)) {
      const nullCheck = [node.left, node.right].some((side) => side.kind === ts.SyntaxKind.NullKeyword)
      if (!nullCheck)
        tips.push({ rule: "loose-equality", severity: "info", message: `\`${node.operatorToken.getText(source)}\` converts types before comparing. Use \`${node.operatorToken.getText(source)}=\`.`, line: line(node.getStart(source)), endLine: line(node.getEnd()) })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return tips
}
