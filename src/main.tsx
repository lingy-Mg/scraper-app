import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider, App as AntdApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import 'antd/dist/reset.css'
import './styles.css'
import { appTheme } from './theme'
import ScraperApp from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={appTheme}>
      <AntdApp>
        <ScraperApp />
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>
)
