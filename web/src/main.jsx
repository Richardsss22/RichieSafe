import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { SecurityProvider } from './context/SecurityContext'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <div style={{ color: 'red', fontSize: '2rem', padding: '2rem' }}>
      <h1>Debug: Hello World</h1>
      <p>If you see this, React is mounting.</p>
    </div>
    {/* <SecurityProvider>
      <App />
    </SecurityProvider> */}
  </StrictMode>,
)
