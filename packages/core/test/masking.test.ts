import { describe, expect, test } from "bun:test"
import { createMasker, MASK, maskDeep } from "../src/masking.ts"

const mask = createMasker(["super-secret-api-key-value"])

describe("masking", () => {
  test("replaces known secret values", () => {
    expect(mask("key is super-secret-api-key-value!")).toBe(`key is ${MASK}!`)
  })

  test.each([
    ["AWS key", "id=AKIAIOSFODNN7EXAMPLE"],
    ["GitHub token", "ghp_abcdefghijklmnopqrstuvwxyz0123456789"],
    ["GitLab token", "glpat-abcdefghijklmnopqrstu"],
    ["Slack token", "xoxb-1234567890-abcdef"],
    ["OpenAI-style key", "sk-proj-abcdefghijklmnopqrstuvwx"],
    ["JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"],
  ])("masks %s", (_, secret) => {
    expect(mask(`value: ${secret}`)).not.toContain(secret.slice(-12))
    expect(mask(`value: ${secret}`)).toContain(MASK)
  })

  test("masks private key blocks", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----"
    expect(mask(`before\n${pem}\nafter`)).toBe(`before\n${MASK}\nafter`)
  })

  test("masks bearer and basic credentials but keeps the scheme", () => {
    expect(mask("Authorization: Bearer abcdefgh12345678")).toBe(`Authorization: Bearer ${MASK}`)
    expect(mask("Authorization: Basic dXNlcjpwYXNzd29yZA==")).toBe(`Authorization: Basic ${MASK}`)
  })

  test("masks secret-looking assignments in env, YAML and JSON", () => {
    expect(mask("DB_PASSWORD=hunter22")).toBe(`DB_PASSWORD=${MASK}`)
    expect(mask("api_key: abc12345")).toBe(`api_key: ${MASK}`)
    expect(mask(`{"client_secret": "s3cr3tvalue"}`)).toBe(`{"client_secret": "${MASK}"}`)
    expect(mask("export GITLAB_TOKEN='abcd1234'")).toBe(`export GITLAB_TOKEN='${MASK}'`)
  })

  test("leaves normal text alone", () => {
    const text = "const token = getToken(); // reads the password field length"
    expect(mask("hello world")).toBe("hello world")
    expect(mask("password=")).toBe("password=")
    expect(createMasker([undefined, "abc"])("abc")).toBe("abc") // values shorter than 4 chars are ignored
    expect(mask(text)).toContain("getToken()")
    expect(mask("password = userInput")).toBe("password = userInput")
    expect(mask(`const apiKey = "abcd1234efgh"`)).toBe(`const apiKey = "${MASK}"`)
  })

})

describe("masking: formats found in the security review (2026-11-19, M4)", () => {
  test("masks the formats the review found unmasked", () => {
    // Fake values built at runtime, never real secrets.
    const secret = ["wJalrXUtnFEMI", "K7MDENG", "bPxRfiCYEXAMPLEKEY"].join("/")
    expect(mask(`aws_secret_access_key = ${secret}`)).toBe(`aws_secret_access_key = ${MASK}`)
    expect(mask("DATABASE_URL=postgres://admin:pw-123@db.intranet:5432/app")).toBe(`DATABASE_URL=postgres://admin:${MASK}@db.intranet:5432/app`)
    expect(mask("git clone https://dev:tok123456@git.intranet/x.git")).toBe(`git clone https://dev:${MASK}@git.intranet/x.git`)
    expect(mask("machine git.intranet login dev password s3cr3t-pw")).toBe(`machine git.intranet login dev password ${MASK}`)
    expect(mask("machine h\n  login dev\n  password s3cr3t-pw\n")).toBe(`machine h\n  login dev\n  password ${MASK}\n`)
    expect(mask(`{"auths":{"registry":{"auth":"ZGV2OnBhc3N3b3Jk"}}}`)).toBe(`{"auths":{"registry":{"auth":"${MASK}"}}}`)
    expect(mask("    client-key-data: LS0tLS1CRUdJTiBQUklWQVRF")).toBe(`    client-key-data: ${MASK}`)
    expect(mask(`password="correct horse battery staple"`)).toBe(`password="${MASK}"`)
    expect(mask("api_key = a1b2c3d4e5f6g7h8i9j0")).toBe(`api_key = ${MASK}`)
  })

  test("code and prose stay readable", () => {
    expect(mask("password = userInput")).toBe("password = userInput")
    expect(mask("const token = session.token")).toBe("const token = session.token")
    expect(mask("author: Jane Doe")).toBe("author: Jane Doe")
    expect(mask("Reset your password in the settings.")).toBe("Reset your password in the settings.")
    expect(mask("see https://example.com/a:b@c")).toBe("see https://example.com/a:b@c")
  })

  test("long runs of word characters do not make masking slow", () => {
    const text = `${"a".repeat(40_000)} ${"b_password".repeat(2_000)}`
    const began = performance.now()
    mask(text)
    expect(performance.now() - began).toBeLessThan(300)
  })

  test("maskDeep walks objects and arrays", () => {
    expect(maskDeep({ a: ["DB_PASSWORD=hunter22", 1], b: { c: "super-secret-api-key-value" }, d: null }, mask)).toEqual({
      a: [`DB_PASSWORD=${MASK}`, 1],
      b: { c: MASK },
      d: null,
    })
  })
})
