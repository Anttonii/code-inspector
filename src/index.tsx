import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import VisualDebugger from './VisualDebugger'

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement)
root.render(
  <React.StrictMode>
    <VisualDebugger />
  </React.StrictMode>
)
