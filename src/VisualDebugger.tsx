import React, { useState, useEffect, useMemo, useRef } from 'react'
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
  WidgetType,
} from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { usePyodide } from './usePyodide'
import type { TraceStep } from './types'
import { groupTraceIntoIterations, evaluateStepCondition } from './processTrace'
import './VisualDebugger.css'

class ActiveLineTextWidget extends WidgetType {
  text: string

  constructor(text: string) {
    super()
    this.text = text
  }

  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-activeLineText' // We will style this later
    span.textContent = this.text
    // Prevent the widget from hiding the actual code if the user clicks on it
    span.setAttribute('aria-hidden', 'true')
    return span
  }
}

const hideCursorTheme = EditorView.theme({
  '.cm-content': { caretColor: 'transparent' },
  '.cm-selectionBackground, .cm-selectionMatch': {
    backgroundColor: 'transparent !important',
  },
})

function debugLineHighlighter(
  activeLineNumber: number,
  activeLineText: string | null
): Extension {
  return EditorView.decorations.of((view: EditorView) => {
    const builder = new RangeSetBuilder<Decoration>()
    if (activeLineNumber > 0 && activeLineNumber <= view.state.doc.lines) {
      const line = view.state.doc.line(activeLineNumber)
      builder.add(
        line.from,
        line.from,
        Decoration.line({ class: 'cm-debugLine' })
      )

      if (activeLineText) {
        builder.add(
          line.to,
          line.to,
          Decoration.widget({
            widget: new ActiveLineTextWidget(activeLineText),
            side: 1,
          })
        )
      }
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

function errorLineHighlighter(activeLineNumber: number): Extension {
  return EditorView.decorations.of((view: EditorView) => {
    const builder = new RangeSetBuilder<Decoration>()
    if (activeLineNumber > 0 && activeLineNumber <= view.state.doc.lines) {
      const line = view.state.doc.line(activeLineNumber)
      builder.add(
        line.from,
        line.from,
        Decoration.line({ class: 'cm-errorLine' })
      )
    }
    return builder.finish()
  })
}

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
  activeLineText: string | null
  currentErrorLine: number
}

function PythonEditor({
  code,
  onChange,
  isDebugging,
  activeLine,
  activeLineText,
  currentErrorLine,
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
        if (!currentErrorLine) {
          exts.push(debugLineHighlighter(activeLine, activeLineText))
        } else {
          exts.push(errorLineHighlighter(currentErrorLine))
        }
      }
    } else {
      exts.push(customActiveLineHighlighter)
    }
    return exts
  }, [isDebugging, activeLine, currentErrorLine])

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
    <div className="editor-pane">
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

  const varToString = (v: any) => {
    if (v === undefined || v === null) {
      return ''
    }

    if (Array.isArray(v)) {
      return JSON.stringify(v)
    } else {
      return v
    }
  }

  useEffect(() => {
    if (activeRowRef.current) {
      activeRowRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      })
    }
  }, [currentStep])

  return (
    <div className="inspector-pane">
      {activeIterationBlock.length > 1 && (
        <div style={{ marginTop: '24px' }}>
          <h4 style={{ margin: '0 0 10px 0', color: '#555' }}>
            Block Execution History
          </h4>
          <div className="block-table">
            <table className="var-table font-small">
              <thead>
                <tr>
                  <th className="table-header">Line</th>
                  {allVarNames.map((name) => (
                    <th key={name} className="table-header">
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
                      <td className="var-name">L{step.line}</td>
                      {allVarNames.map((name) => (
                        <td key={name} className="var-value">
                          {varToString(step.vars[name])}
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

function ErrorInspector({ errorText }: { errorText: string }) {
  return (
    <div className="inspector-pane bg-grey">
      <h4 className="error-hero">Runtime Error</h4>
      <div className="stacktrace-container">{errorText}</div>
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
  const [currentError, setCurrentError] = useState<string>('')
  const [currentErrorLine, setCurrentErrorLine] = useState<number>(0)

  const { runCode, isRunning } = usePyodide()

  const groupedTrace = useMemo(() => groupTraceIntoIterations(trace), [trace])

  const activeLine: number | null =
    currentStep >= 0 ? (trace[currentStep]?.line ?? null) : null
  const activeLineText: string | null =
    currentStep >= 0 ? evaluateStepCondition(trace[currentStep]) : null

  const startDebugging = async () => {
    setIsDebugging(true)
    setTrace([])
    setCurrentStep(-1)
    setCurrentError('')
    setCurrentErrorLine(0)

    try {
      const rawTrace = await runCode(code)
      if (rawTrace[0].error) {
        setCurrentError(rawTrace[0].error)
        setCurrentErrorLine(rawTrace[0].line)
      }

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
      setCurrentError(error.message)
      setIsDebugging(false)
    }
  }

  const stopDebugging = () => {
    setIsDebugging(false)
    setTrace([])
    setCurrentStep(-1)
  }

  return (
    <div className="container">
      <div className="toolbar">
        {!isDebugging ? (
          <button
            className="toolbar-btn"
            onClick={startDebugging}
            disabled={isRunning}
          >
            {isRunning ? 'Executing..' : 'Execute'}
          </button>
        ) : (
          <>
            <div className="toolbar-container">
              <button className="toolbar-btn danger" onClick={stopDebugging}>
                Stop
              </button>
              <button
                className="toolbar-btn"
                disabled={currentStep <= 0}
                onClick={() => setCurrentStep((prev) => prev - 1)}
              >
                Step Back
              </button>
              <button
                className="toolbar-btn"
                disabled={currentStep === trace.length - 1}
                onClick={() => setCurrentStep((prev) => prev + 1)}
              >
                Step Forward
              </button>
            </div>
            <div className="toolbar-container">
              <span className="step-text">
                Step {currentStep + 1} / {trace.length}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="layout">
        <PythonEditor
          code={code}
          onChange={setCode}
          isDebugging={isDebugging}
          activeLine={activeLine}
          activeLineText={activeLineText}
          currentErrorLine={currentErrorLine}
        />
        {currentError ? (
          <ErrorInspector errorText={currentError} />
        ) : (
          <VariableInspector
            groupedTrace={groupedTrace}
            currentStep={currentStep}
          />
        )}
      </div>
    </div>
  )
}
