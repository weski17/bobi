import { UserService } from "./user"
import * as math from "./util/math"

export function main() {
  const service = new UserService(2)
  service.save()
  return math.add(1, 2)
}

main()
