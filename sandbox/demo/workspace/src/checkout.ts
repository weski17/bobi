export type Item = { name: string; priceCents: number; qty: number }

/** Gesamtpreis eines Warenkorbs in Cent. */
export function total(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.priceCents, 0)
}

/** Wendet einen Rabattcode an (Prozent vom Gesamtpreis). Unbekannte Codes geben den Preis unverändert zurück. */
export function applyDiscount(totalCents: number, code: string): number {
  const percent = code === "SPRING10" ? 10 : code === "VIP20" ? 20 : 0
  return Math.round(totalCents * (1 - percent / 100))
}
