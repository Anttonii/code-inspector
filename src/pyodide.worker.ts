/// <reference lib="webworker" />
import type { WorkerInput, TracerOutput } from './types'
import { loadPyodide } from 'pyodide'
import tracerPythonCode from './tracer.py?raw'

declare const self: DedicatedWorkerGlobalScope & {
  pyodide: any
}

let pyodideReadyPromise: Promise<void>

async function initPyodide() {
  self.pyodide = await loadPyodide()
  console.log('Pyodide is loaded and ready.')
}

pyodideReadyPromise = initPyodide()

self.onmessage = async (event: MessageEvent<WorkerInput>) => {
  const { id, code } = event.data

  try {
    await pyodideReadyPromise

    self.pyodide.runPython(tracerPythonCode)
    self.pyodide.globals.set('user_code_string', code)
    const resultJson = self.pyodide.runPython(
      'execute_and_trace(user_code_string)'
    )

    const trace: TracerOutput = JSON.parse(resultJson)

    self.postMessage({ id, trace })
  } catch (error: any) {
    self.postMessage({ id, error: error.message })
  }
}
