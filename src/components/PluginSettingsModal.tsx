import { useEffect, useRef } from 'react'
import { Alert, Modal } from 'antd'
import type { ModeConfig } from '../types'

interface Props {
  open: boolean
  mode: ModeConfig | null
  onClose: () => void
  onSaved: (config: Partial<ModeConfig>) => void
}

export default function PluginSettingsModal({ open, mode, onClose, onSaved }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = (event.data || {}) as Record<string, any>
      if (!data || typeof data.type !== 'string') return
      if (data.pluginId && mode && data.pluginId !== mode.key) return

      if (data.type === 'plugin:ready') {
        frameRef.current?.contentWindow?.postMessage(
          { type: 'host:init', pluginId: mode?.key, config: mode },
          '*'
        )
      }
      if (data.type === 'plugin:close') onClose()
      if (data.type === 'plugin:saved') onSaved(data.config || {})
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [mode, onClose, onSaved])

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={720}
      title={mode ? `${mode.name} · 插件设置` : '插件设置'}
      destroyOnHidden
    >
      {mode?.settingsUrl ? (
        <iframe
          ref={frameRef}
          src={mode.settingsUrl}
          title="plugin-settings"
          style={{
            width: '100%',
            height: 520,
            border: '1px solid var(--line)',
            borderRadius: 4,
            background: 'var(--bg-elevated)'
          }}
          sandbox="allow-scripts allow-forms allow-same-origin"
        />
      ) : (
        <Alert
          type="warning"
          showIcon
          message="该模式没有提供设置界面"
          description="插件宿主未连接，或插件没有声明 settingsUrl。"
        />
      )}
    </Modal>
  )
}
