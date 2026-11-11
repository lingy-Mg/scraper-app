import React from 'react'
import ReactDOM from 'react-dom/client'
import 'antd/dist/reset.css'
import './styles.css'
import ThemeRoot from './ThemeRoot'
import ScraperApp from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeRoot>
      <ScraperApp />
    </ThemeRoot>
  </React.StrictMode>
)
