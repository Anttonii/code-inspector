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
  vars: Record<string, any>
  depth: number
  conditional?: Conditional
}

export interface ErrorInfo {
  line: number
  message: string
}

export interface TracerOutput {
  steps: TraceStep[]
  untracked_vars: string[]
  error?: ErrorInfo
}

export interface WorkerOutput {
  id: string
  trace?: TracerOutput
  error?: string
}
