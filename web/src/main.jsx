import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { SecurityProvider } from './context/SecurityContext'

console.log("DEBUG: main.jsx loading...");
console.log("DEBUG: ReactDOM exports:", ReactDOM);

window.onerror = function (msg, url, line, col, error) {
  console.error("DEBUG: Global Error:", msg, error);
  document.body.innerHTML += `<div style="color:red; background:white; padding:20px; z-index:9999; position:fixed; top:0;">Error: ${msg}</div>`;
};

try {
  const root = document.getElementById('root');
  if (!root) console.error("DEBUG: Root element not found!");
  else console.log("DEBUG: Root element found:", root);

  if (!createRoot) {
    throw new Error("createRoot is undefined!");
  }

  createRoot(root).render(
    <StrictMode>
      <div style={{ color: 'blue', fontSize: '2rem', padding: '2rem' }}>
        <h1>Debug: Hello World (v3)</h1>
        <p>React is mounting via ReactDOM namespace.</p>
      </div>
    </StrictMode>,
  );
  console.log("DEBUG: Render called");
} catch (e) {
  console.error("DEBUG: Render failed:", e);
  document.body.innerHTML += `<div style="color:red">Render Exec Failed: ${e.message}</div>`;
}
