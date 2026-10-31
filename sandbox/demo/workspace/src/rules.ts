/** Versandkosten in Cent. Gewachsen über Jahre – und entsprechend schwer zu lesen. */
export function shippingCost(country: string, weightGrams: number, express: boolean, member: boolean, total: number, coupon: any, fragile: boolean) {
  let cost = 0
  if (country == "DE") {
    if (weightGrams < 1000) {
      cost = 490
    } else if (weightGrams < 5000) {
      cost = 690
    } else {
      if (weightGrams < 20000) {
        cost = 990
      } else {
        cost = 1990
      }
    }
    if (express) {
      if (member) {
        cost += 300
      } else {
        if (total > 10000) {
          cost += 400
        } else {
          cost += 600
        }
      }
    }
  } else if (country == "AT" || country == "CH") {
    cost = weightGrams < 2000 ? 1190 : 1790
    if (express) cost += 900
  } else {
    cost = weightGrams < 2000 ? 2490 : 3990
    if (express && !member) cost += 1500
  }
  if (fragile) {
    try {
      cost += Math.ceil(weightGrams / 1000) * 50
    } catch (e) {}
  }
  if (coupon && coupon.freeShipping && total > 5000) cost = 0
  if (total > 20000 && country == "DE") cost = 0
  return cost
}
