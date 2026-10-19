import { describe, expect, test } from "bun:test"
import { createTwoFilesPatch } from "diff"
import { applyPatch, PatchError } from "../src/patch.ts"

// Patches are produced exactly like the engine does (file-diff.ts: createTwoFilesPatch).
const cases: [string, string, string][] = [
  ["new file", "", "hello\nworld\n"],
  ["new file without trailing newline", "", "single line"],
  ["modify middle", "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n", "a\nb\nc\nD\ne\nf\ng\nh\nI\nj\n"],
  ["append", "one\ntwo\n", "one\ntwo\nthree\n"],
  ["delete everything", "one\ntwo\n", ""],
  ["remove trailing newline", "x\ny\n", "x\ny"],
  ["add trailing newline", "x\ny", "x\ny\n"],
  ["far apart hunks", Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n") + "\n", Array.from({ length: 40 }, (_, i) => (i === 2 || i === 35 ? `changed ${i}` : `line ${i}`)).join("\n") + "\n"],
  ["unicode", "grüße\n", "grüße 👋\n"],
]

describe("applyPatch", () => {
  test.each(cases)("%s", (_, before, after) => {
    const patch = createTwoFilesPatch("f.txt", "f.txt", before, after)
    expect(applyPatch(before, patch)).toBe(after)
  })

  test("an empty patch keeps the content", () => {
    expect(applyPatch("same\n", createTwoFilesPatch("f", "f", "same\n", "same\n"))).toBe("same\n")
  })

  test("refuses a patch that does not match the current file", () => {
    const patch = createTwoFilesPatch("f", "f", "a\nb\n", "a\nB\n")
    expect(() => applyPatch("a\nchanged meanwhile\n", patch)).toThrow(PatchError)
  })

  test("refuses overlapping hunks", () => {
    expect(() => applyPatch("a\nb\n", "@@ -2,1 +2,1 @@\n-b\n+B\n@@ -1,1 +1,1 @@\n-a\n+A\n")).toThrow(/overlapping/)
  })
})

test("round-trips 300 random edits", () => {
  let seed = 42
  const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n)
  const words = ["a", "b", "c", "", "foo", "bar baz", "  indented", "x"]
  const randomText = () => {
    const lines = Array.from({ length: rand(12) }, () => words[rand(words.length)]!)
    const text = lines.join("\n")
    return rand(2) ? text : text + (text ? "\n" : "")
  }
  for (let i = 0; i < 300; i++) {
    const before = randomText()
    const lines = before.split("\n")
    for (let k = 0; k < 3; k++) {
      const at = rand(lines.length + 1)
      if (rand(2)) lines.splice(at, 1)
      else lines.splice(at, 0, words[rand(words.length)]!)
    }
    const after = lines.join("\n")
    expect(applyPatch(before, createTwoFilesPatch("f", "f", before, after))).toBe(after)
  }
})
