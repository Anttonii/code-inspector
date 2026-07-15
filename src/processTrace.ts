import type {
  TraceStep,
  Conditional,
  CompareCondition,
  FrameMap,
  TraceStepNode,
} from './types'

export function buildLinkedTrace(
  trace: TraceStep[],
  startIndex = 0,
  prevNode: TraceStepNode | null = null,
  frameMap: FrameMap = {}
): {
  head: TraceStepNode | null
  tail: TraceStepNode | null
  resumeIndex: number
} {
  if (startIndex >= trace.length) {
    return { head: null, tail: null, resumeIndex: startIndex }
  }

  const startStep = trace[startIndex]
  frameMap[startStep.frame_id] = [startStep]

  const head: TraceStepNode = {
    step: startStep,
    stepIndex: startIndex,
    frameIndex: 0,
    next: null,
    prev: prevNode,
  }
  let current = head
  let i = startIndex + 1

  while (i < trace.length) {
    const step = trace[i]

    if (step.parent_frame_id === current.step.frame_id) {
      let {
        head: childHead,
        resumeIndex,
        tail: childTail,
      } = buildLinkedTrace(trace, i, null, frameMap)
      if (childHead && childTail) {
        childHead.prev = current
        current.next = childHead
        current = childTail
      }
      i = resumeIndex + 1
    } else {
      const frameIndex = frameMap[step.frame_id].length
      frameMap[step.frame_id].push(step)

      const newNode: TraceStepNode = {
        step,
        stepIndex: i,
        frameIndex: frameIndex,
        next: null,
        prev: current,
      }
      current.next = newNode
      current = newNode
      i++
    }
  }

  // Return the linked list head, and where the parent should resume reading
  return { head, resumeIndex: i, tail: current }
}

function resolvePath(path: string, data: Record<string, any>): any {
  if (!path) return undefined

  if (/^-?\d+\.?\d*$/.test(path)) {
    return Number(path)
  }

  if (path === 'true') return true
  if (path === 'false') return false
  if (path === 'null') return null
  if (path === 'undefined') return undefined
  if (
    (path.startsWith('"') && path.endsWith('"')) ||
    (path.startsWith("'") && path.endsWith("'"))
  ) {
    return path.slice(1, -1)
  }

  const tokens = tokenizePath(path)
  let current: any = data

  for (const token of tokens) {
    if (current === undefined || current === null) {
      return undefined
    }

    if (Array.isArray(current)) {
      if (typeof token === 'number') {
        current = current[token]
      } else if (typeof token === 'string') {
        current = current[data[token]]
      }
    } else {
      if (typeof token === 'number') {
        current = current[token]
      } else if (typeof token === 'string') {
        current = current[token]
      }
    }
  }

  return current
}

/**
 * Tokenize a path expression into parts.
 * Example: "arr[0]" -> ["arr", 0]
 *          "obj.key" -> ["obj", "key"]
 *          "data.users[0].age" -> ["data", "users", 0, "age"]
 */
function tokenizePath(path: string): (string | number)[] {
  const tokens: (string | number)[] = []
  let current = ''
  let i = 0

  while (i < path.length) {
    const char = path[i]

    if (char === '[') {
      // Start of array index
      if (current) {
        tokens.push(current)
        current = ''
      }

      // Parse the index until closing bracket
      let indexStr = ''
      i++ // Skip '['
      while (i < path.length && path[i] !== ']') {
        indexStr += path[i]
        i++
      }

      // Parse as number if possible
      const index = Number(indexStr)
      tokens.push(isNaN(index) ? indexStr : index)
      i++ // Skip ']'
      continue
    }

    if (char === '.') {
      // Property access
      if (current) {
        tokens.push(current)
        current = ''
      }
      i++
      continue
    }

    current += char
    i++
  }

  if (current) {
    tokens.push(current)
  }

  return tokens
}

export function evaluateCompare(
  condition: CompareCondition,
  vars: Record<string, any>
): boolean {
  const leftValue = resolvePath(condition.left, vars)
  const rightValue = resolvePath(condition.right, vars)

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
  vars: Record<string, any>
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
  vars: Record<string, any>,
  parentOperator?: 'and' | 'or'
): string {
  if (condition.type === 'compare') {
    const leftValue = resolvePath(condition.left, vars)
    const rightValue = resolvePath(condition.right, vars)

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
