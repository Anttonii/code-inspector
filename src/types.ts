export interface WorkerInput {
  id: string
  code: string
}

export interface BooleanCondition {
  type: 'bool'
  operator: 'and' | 'or'
  conditions: (BooleanCondition | Conditional)[]
}

export interface CompareCondition {
  type: 'compare'
  left: string
  right: string
  op: string
}

export type Conditional = BooleanCondition | CompareCondition

export interface TraceStep {
  line: number
  vars: Record<string, string>
  depth: number
  error?: string
  conditional?: Conditional
}

export interface WorkerOutput {
  id: string
  trace?: TraceStep[]
  error?: string
}
