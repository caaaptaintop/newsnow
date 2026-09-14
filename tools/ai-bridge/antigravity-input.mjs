export function inputParts(payload) {
  const chars = Array.from(payload)
  const parts = []
  for (let i = 0; i < chars.length; i += 1000) parts.push(chars.slice(i, i + 1000).join(""))
  return parts
}

export class InputReceipt {
  constructor(expected) {
    this.expected = expected
    this.completed = new Set()
  }

  receive(step) {
    if (step.step_type !== "unknown" || step.state !== "DONE" || !Number.isInteger(step.step_index) || step.step_index < 1 || step.step_index > this.expected) return false
    this.completed.add(step.step_index)
    return true
  }

  get complete() {
    return this.completed.size === this.expected
  }
}
