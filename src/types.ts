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

export type TracerStdOutput = { [key: number]: string }

export interface TraceStep {
  line: number
  vars: Record<string, any>
  depth: number
  conditional?: Conditional
  func_name: string
  frame_id: number
  parent_frame_id?: number
}

export interface TraceStepNode {
  step: TraceStep
  stepIndex: number
  frameIndex: number
  next: TraceStepNode | null
  prev: TraceStepNode | null
}

export interface ErrorInfo {
  line: number
  message: string
}

export interface TracerOutput {
  steps: TraceStep[]
  untracked_vars: string[]
  error?: ErrorInfo
  stdout: TracerStdOutput
}

export interface WorkerOutput {
  id: string
  trace?: TracerOutput
  error?: string
}

export type FrameMap = { [key: number]: TraceStep[] }
