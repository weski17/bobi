// Code tips (requirement 14): local static analysis, no model call. Shared by Bobi IDE (diagnostics) and `bobi tips`.

export type Severity = "warning" | "info"

export type Tip = {
  /** Stable rule id, e.g. "complexity". */
  readonly rule: string
  readonly severity: Severity
  readonly message: string
  /** 1-based lines; the range the tip is about (e.g. the whole function). */
  readonly line: number
  readonly endLine: number
  /** Name of the function or paragraph, when the tip is about one. */
  readonly symbol?: string
}

export type Limits = {
  /** Cyclomatic complexity per function. */
  readonly complexity: number
  /** Lines per function (TS/JS) or paragraph (COBOL). */
  readonly functionLines: number
  /** Nesting depth of blocks inside a function. */
  readonly nesting: number
  readonly parameters: number
}

export const DEFAULT_LIMITS: Limits = { complexity: 10, functionLines: 60, nesting: 4, parameters: 5 }
