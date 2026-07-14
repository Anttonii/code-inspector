import type { TraceStep, Conditional, CompareCondition } from './types'

export function groupTraceIntoIterations(trace: TraceStep[]): TraceStep[][] {
  const iterations: TraceStep[][] = []
  let currentIteration: TraceStep[] = []

  for (let i = 0; i < trace.length; i++) {
    const step = trace[i]
    const prevStep = trace[i - 1]

    // If the current line is less than or equal to the previous line,
    // we have jumped backwards (starting a new loop iteration)
    // Additionally check if there has been a change in stack depth.
    if (
      prevStep &&
      (step.line <= prevStep.line || step.depth !== prevStep.depth)
    ) {
      iterations.push(currentIteration)
      currentIteration = [step]
    } else {
      currentIteration.push(step)
    }
  }

  if (currentIteration.length > 0) {
    iterations.push(currentIteration)
  }

  return iterations
}

// Parse a string value (number, string, boolean, or variable reference)
function parseValue(value: string, data: Record<string, any>): any {
  if (/^-?\d+\.?\d*$/.test(value)) {
    return Number(value)
  }

  if (value === 'true') return true
  if (value === 'false') return false

  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1)
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1)
  }

  if (value in data) {
    return data[value]
  }

  return value
}

export function evaluateCompare(
  condition: CompareCondition,
  vars: Record<string, string>
): boolean {
  const leftValue = vars[condition.left]
  const rightValue = parseValue(condition.right, vars)

  switch (condition.op) {
    case '==':
    case 'is':
      return leftValue === rightValue
    case '!=':
    case 'is not':
      return leftValue !== rightValue
    case '<':
      return leftValue < rightValue
    case '<=':
      return leftValue <= rightValue
    case '>':
      return leftValue > rightValue
    case '>=':
      return leftValue >= rightValue
    case 'in':
      return Array.isArray(rightValue) && rightValue.includes(leftValue)
    case 'not in':
      return Array.isArray(rightValue) && !rightValue.includes(leftValue)
    default:
      throw new Error(`Unknown operator: ${condition.op}`)
  }
}

export function evaluateCondition(
  condition: Conditional,
  vars: Record<string, string>
): boolean {
  if (condition.type == 'compare') {
    return evaluateCompare(condition, vars)
  }

  if (condition.type === 'bool') {
    const results = condition.conditions.map((c) => evaluateCondition(c, vars))

    if (condition.operator === 'and') {
      return results.every((r) => r === true)
    } else if (condition.operator === 'or') {
      return results.some((r) => r === true)
    }
  }

  throw new Error(`Unknown condition type: ${(condition as any).type}`)
}

function conditionToString(
  condition: Conditional,
  vars: Record<string, string>,
  parentOperator?: 'and' | 'or'
): string {
  if (condition.type === 'compare') {
    const leftValue = vars[condition.left]
    const rightValue = parseValue(condition.right, vars)

    return `${leftValue} ${condition.op} ${rightValue}`
  }

  if (condition.type === 'bool') {
    const parts = condition.conditions.map((cond) => {
      if (cond.type === 'bool') {
        // Add parentheses if parent operator requires it
        // 'and' has higher precedence than 'or'
        const needsParens = parentOperator === 'or' && cond.operator === 'and'
        const inner = conditionToString(cond, vars, condition.operator)
        return needsParens ? `(${inner})` : inner
      }
      return conditionToString(cond, vars, condition.operator)
    })

    return parts.join(` ${condition.operator} `)
  }

  throw new Error(`Unknown condition type: ${(condition as any).type}`)
}

export function evaluateStepCondition(input: TraceStep): string {
  if (!input.conditional) {
    return ''
  }

  const truthy = '✅'
  const falsy = '❌'
  const evaluation = evaluateCondition(input.conditional, input.vars)

  return ` # ${conditionToString(input.conditional, input.vars)} ${evaluation ? truthy : falsy}`
}
