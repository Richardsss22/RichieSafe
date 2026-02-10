import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { SecurityProvider } from './context/SecurityContext'
import ErrorBoundary from './components/ErrorBoundary'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <SecurityProvider>
        <App />
      </SecurityProvider>
    </ErrorBoundary>
  </StrictMode>,
)
