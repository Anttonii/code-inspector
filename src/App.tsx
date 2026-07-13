import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  CSSProperties,
} from 'react'
import CodeMirror, {
  ReactCodeMirrorRef,
  Extension,
} from '@uiw/react-codemirror'
import { python } from '@codemirror/lang-python'
import {
  EditorView,
  Decoration,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { usePyodide } from './usePyodide'
import type { TraceStep } from './types'
import { groupTraceIntoIterations } from './processTrace'

const hideCursorTheme = EditorView.theme({
  '.cm-content': { caretColor: 'transparent' },
  '.cm-selectionBackground, .cm-selectionMatch': {
    backgroundColor: 'transparent !important',
  },
})

function debugLineHighlighter(activeLineNumber: number): Extension {
  return EditorView.decorations.of((view: EditorView) => {
    const builder = new RangeSetBuilder<Decoration>()
    if (activeLineNumber > 0 && activeLineNumber <= view.state.doc.lines) {
      const line = view.state.doc.line(activeLineNumber)
      builder.add(
        line.from,
        line.from,
        Decoration.line({ class: 'cm-debugLine' })
      )
    }
    return builder.finish()
  })
}

const customActiveLineHighlighter = ViewPlugin.fromClass(
  class {
    decorations: any
    constructor(view: EditorView) {
      this.decorations = this.getDecorations(view)
    }
    update(update: ViewUpdate) {
      if (update.selectionSet || update.docChanged) {
        this.decorations = this.getDecorations(update.view)
      }
    }
    getDecorations(view: EditorView) {
      const builder = new RangeSetBuilder<Decoration>()
      const { main } = view.state.selection
      if (main.empty) {
        const line = view.state.doc.lineAt(main.head)
        builder.add(
          line.from,
          line.from,
          Decoration.line({ class: 'cm-activeLine' })
        )
      }
      return builder.finish()
    }
  },
  { decorations: (v) => v.decorations }
)

const customSyntaxHighlighting = HighlightStyle.define([
  { tag: tags.variableName, color: '#005cc5' },
  { tag: tags.function(tags.variableName), color: '#6f42c1' },
  { tag: tags.number, color: '#d73a49' },
  { tag: tags.keyword, color: '#d73a49', fontWeight: 'bold' },
  { tag: tags.comment, color: '#6a737d', fontStyle: 'italic' },
])

interface PythonEditorProps {
  code: string
  onChange: (value: string) => void
  isDebugging: boolean
  activeLine: number | null
}

function PythonEditor({
  code,
  onChange,
  isDebugging,
  activeLine,
}: PythonEditorProps) {
  const editorRef = useRef<ReactCodeMirrorRef>(null)

  const extensions = useMemo(() => {
    const exts: Extension[] = [
      python(),
      syntaxHighlighting(customSyntaxHighlighting),
    ]

    if (isDebugging) {
      exts.push(hideCursorTheme)
      if (activeLine) {
        exts.push(debugLineHighlighter(activeLine))
      }
    } else {
      exts.push(customActiveLineHighlighter)
    }
    return exts
  }, [isDebugging, activeLine])

  // Auto-scroll effect to keep active line in view.
  useEffect(() => {
    if (activeLine && editorRef.current?.view && editorRef.current.state) {
      const view = editorRef.current.view
      const state = editorRef.current.state
      if (activeLine > 0 && activeLine <= state.doc.lines) {
        const lineInfo = state.doc.line(activeLine)
        view.dispatch({
          effects: EditorView.scrollIntoView(lineInfo.from, {
            y: 'center',
          }),
        })
      }
    }
  }, [activeLine])

  return (
    <div style={styles.editorPane}>
      <CodeMirror
        value={code}
        ref={editorRef}
        extensions={extensions}
        onChange={onChange}
        readOnly={isDebugging}
        editable={!isDebugging}
        basicSetup={{
          foldGutter: false,
          highlightActiveLine: false,
          lineNumbers: false,
        }}
      />
    </div>
  )
}

interface VariableInspectorProps {
  groupedTrace: TraceStep[][]
  currentStep: number
}

function VariableInspector({
  groupedTrace,
  currentStep,
}: VariableInspectorProps) {
  const activeRowRef = useRef<HTMLTableRowElement>(null)

  let activeBlockIndex = 0
  let stepsCounted = 0

  for (let i = 0; i < groupedTrace.length; i++) {
    stepsCounted += groupedTrace[i].length
    if (currentStep < stepsCounted) {
      activeBlockIndex = i
      break
    }
  }

  const activeIterationBlock = groupedTrace[activeBlockIndex] || []

  const allVarNames = Array.from(
    new Set(activeIterationBlock.flatMap((step) => Object.keys(step.vars)))
  )

  useEffect(() => {
    if (activeRowRef.current) {
      activeRowRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      })
    }
  }, [currentStep])

  return (
    <div style={styles.inspectorPane}>
      {activeIterationBlock.length > 1 && (
        <div style={{ marginTop: '24px' }}>
          <h4 style={{ margin: '0 0 10px 0', color: '#555' }}>
            Block Execution History
          </h4>
          <div
            style={{
              overflowX: 'auto',
              overflowY: 'auto',
              maxHeight: '250px',
              border: '1px solid #eee',
              borderRadius: '4px',
            }}
          >
            <table style={{ ...styles.varTable, fontSize: '12px' }}>
              <thead>
                <tr>
                  <th style={styles.tableHeader}>Line</th>
                  {allVarNames.map((name) => (
                    <th key={name} style={styles.tableHeader}>
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeIterationBlock.map((step, idx) => {
                  const isCurrentExactStep =
                    idx ===
                    currentStep - (stepsCounted - activeIterationBlock.length)

                  return (
                    <tr
                      key={idx}
                      ref={isCurrentExactStep ? activeRowRef : null}
                      style={{
                        backgroundColor: isCurrentExactStep
                          ? '#ffe0b2'
                          : 'transparent',
                      }}
                    >
                      <td style={styles.varName}>L{step.line}</td>
                      {allVarNames.map((name) => (
                        <td key={name} style={styles.varValue}>
                          {step.vars[name] || '-'}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export default function VisualDebugger() {
  const [code, setCode] = useState<string>(() => {
    const savedCode = localStorage.getItem('debugger_saved_code')

    return savedCode !== null
      ? savedCode
      : 'x = 10\nfor i in range(3):\n    x += i\nprint(x)'
  })

  useEffect(() => {
    localStorage.setItem('debugger_saved_code', code)
  }, [code])

  const [trace, setTrace] = useState<TraceStep[]>([])
  const [currentStep, setCurrentStep] = useState<number>(-1)
  const [isDebugging, setIsDebugging] = useState<boolean>(false)

  const { runCode, isRunning } = usePyodide()

  const groupedTrace = useMemo(() => groupTraceIntoIterations(trace), [trace])
  const activeLine: number | null =
    currentStep >= 0 ? (trace[currentStep]?.line ?? null) : null

  const startDebugging = async () => {
    setIsDebugging(true)
    setTrace([])
    setCurrentStep(-1)

    try {
      const rawTrace = await runCode(code)

      const shiftedTrace = rawTrace.map((step, index) => {
        const nextStep = rawTrace[index + 1]

        const isSameScope = nextStep && nextStep.depth === step.depth

        return {
          ...step,
          vars: isSameScope ? nextStep.vars : step.vars,
        }
      })

      setTrace(shiftedTrace)

      if (shiftedTrace.length > 0) {
        setCurrentStep(0)
      } else {
        alert('Execution finished without any traceable steps.')
        setIsDebugging(false)
      }
    } catch (error: any) {
      console.error('Python Execution Error:', error)
      alert('Error in Python code:\n' + error.message)
      setIsDebugging(false)
    }
  }

  const stopDebugging = () => {
    setIsDebugging(false)
    setTrace([])
    setCurrentStep(-1)
  }

  return (
    <div style={styles.container}>
      <div style={styles.toolbar}>
        {!isDebugging ? (
          <button onClick={startDebugging} disabled={isRunning}>
            {isRunning ? 'Running..' : 'Debug Code'}
          </button>
        ) : (
          <>
            <button onClick={stopDebugging} style={{ color: 'red' }}>
              Stop
            </button>
            <button
              disabled={currentStep <= 0}
              onClick={() => setCurrentStep((prev) => prev - 1)}
            >
              Step Back
            </button>
            <button
              disabled={currentStep === trace.length - 1}
              onClick={() => setCurrentStep((prev) => prev + 1)}
            >
              Step Forward
            </button>
            <span style={{ marginLeft: '10px', fontSize: '12px' }}>
              Step {currentStep + 1} / {trace.length}
            </span>
          </>
        )}
      </div>

      <div style={styles.layout}>
        <PythonEditor
          code={code}
          onChange={setCode}
          isDebugging={isDebugging}
          activeLine={activeLine}
        />
        <VariableInspector
          groupedTrace={groupedTrace}
          currentStep={currentStep}
        />
      </div>

      <style>{`
        .cm-activeLine { background-color: #e6f2ff !important; }
        .cm-debugLine { background-color: #ffe0b2 !important; }
      `}</style>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  container: {
    width: '90vw',
    maxWidth: '1000px',
    maxHeight: '100%',
    margin: '40px auto',
    fontFamily: 'sans-serif',
  },
  toolbar: {
    padding: '10px',
    backgroundColor: '#f0f0f0',
    border: '1px solid #ccc',
    borderBottom: 'none',
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
  },
  layout: {
    display: 'flex',
    maxHeight: '75vh',
    border: '1px solid #ccc',
    flexDirection: 'column',
  },
  editorPane: {
    flex: 2,
    borderRight: '1px solid #ccc',
    overflow: 'auto',
    textAlign: 'left',
  },
  inspectorPane: {
    flex: 1,
    padding: '10px',
    backgroundColor: '#fafafa',
    overflow: 'auto',
  },
  emptyVars: { color: '#888', fontStyle: 'italic', fontSize: '14px' },
  varTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '14px',
    fontFamily: 'monospace',
    textAlign: 'left',
  },
  varName: {
    borderBottom: '1px solid #eee',
    padding: '4px',
    color: '#0066cc',
    width: '40%',
  },
  varValue: { borderBottom: '1px solid #eee', padding: '4px', color: '#d14' },
  tableHeader: {
    borderBottom: '2px solid #ccc',
    padding: '4px',
    textAlign: 'left',
    color: '#333',
  },
}
