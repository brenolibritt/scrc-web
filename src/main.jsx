import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: 16 }}>
      <App />
    </div>
  </React.StrictMode>
)
