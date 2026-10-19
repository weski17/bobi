const { add } = require("./util/math")
function sum(list) {
  return list.reduce((a, b) => add(a, b), 0)
}
module.exports = { sum }
