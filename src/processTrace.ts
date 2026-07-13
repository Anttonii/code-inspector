import type { TraceStep } from './types'

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
