export interface WorkerInput {
  id: string
  code: string
}

export interface TraceStep {
  line: number
  vars: Record<string, string>
  depth: number
  error?: string
}

export interface WorkerOutput {
  id: string
  trace?: TraceStep[]
  error?: string
}
