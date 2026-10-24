import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import OverlayApp from './overlay/OverlayApp'
import './index.css'

const isOverlay = new URLSearchParams(window.location.search).has('overlay')
if (isOverlay) document.documentElement.classList.add('overlay-mode')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isOverlay ? <OverlayApp /> : <App />}
  </React.StrictMode>,
)
