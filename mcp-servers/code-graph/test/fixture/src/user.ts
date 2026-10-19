import { double } from "./util/math"

export class UserService {
  constructor(private readonly factor: number) {}
  score(base: number) {
    return double(base) * this.factor
  }
  save() {
    return this.score(1)
  }
}
