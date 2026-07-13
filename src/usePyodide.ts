import { useEffect, useRef, useState, useCallback } from 'react'
import type { TraceStep, WorkerOutput } from './types'

import PyodideWorker from './pyodide.worker?worker'

interface UsePyodideReturn {
  runCode: (code: string) => Promise<TraceStep[]>
  isReady: boolean
  isRunning: boolean
}

export function usePyodide(): UsePyodideReturn {
  const workerRef = useRef<Worker | null>(null)
  const [isReady, setIsReady] = useState<boolean>(false)
  const [isRunning, setIsRunning] = useState<boolean>(false)

  useEffect(() => {
    workerRef.current = new PyodideWorker()

    setIsReady(true)

    return () => {
      workerRef.current?.terminate()
    }
  }, [])

  const runCode = useCallback((code: string): Promise<TraceStep[]> => {
    return new Promise((resolve, reject) => {
      if (!workerRef.current) {
        reject(new Error('Worker not initialized'))
        return
      }

      setIsRunning(true)
      const executionId = crypto.randomUUID()

      const handleMessage = (event: MessageEvent<WorkerOutput>) => {
        const { id, trace, error } = event.data

        if (id === executionId) {
          workerRef.current?.removeEventListener('message', handleMessage)
          setIsRunning(false)

          if (error) {
            reject(new Error(error))
          } else if (trace) {
            resolve(trace)
          } else {
            reject(new Error('Unknown execution error'))
          }
        }
      }

      workerRef.current.addEventListener('message', handleMessage)
      workerRef.current.postMessage({ id: executionId, code })
    })
  }, [])

  return { runCode, isReady, isRunning }
}
