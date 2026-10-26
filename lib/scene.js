/**
 * 当前说话的场合。
 *
 * 同一个大脑在 DSH 窗口里是「助理」，在 QQ 里得是「朋友」。这两套话术不能靠模型自己猜，
 * 得由宿主明确告诉它：这一轮到底在哪说话、对面是谁。
 */
let current = null

export function setScene(next) {
  current = next && typeof next === 'object' ? next : null
}

export function getScene() {
  return current
}

export function clearScene() {
  current = null
}
