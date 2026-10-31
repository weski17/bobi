import { expect, test } from "bun:test"
import { applyDiscount, total } from "../src/checkout.ts"

test("total multiplies price and quantity", () => {
  expect(total([{ name: "Kaffee", priceCents: 450, qty: 2 }, { name: "Tasse", priceCents: 900, qty: 1 }])).toBe(1800)
})

test("total of an empty cart is 0", () => {
  expect(total([])).toBe(0)
})

test("discount codes", () => {
  expect(applyDiscount(1000, "SPRING10")).toBe(900)
  expect(applyDiscount(1000, "VIP20")).toBe(800)
  expect(applyDiscount(1000, "UNKNOWN")).toBe(1000)
})
