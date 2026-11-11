import { CloseOutlined, MinusOutlined, BorderOutlined } from '@ant-design/icons'

interface Props {
  subtitle: string
  showControls?: boolean
  onMinimize?: () => void
  onMaximize?: () => void
  onClose?: () => void
}

export default function TitleBar({
  subtitle,
  showControls = false,
  onMinimize,
  onMaximize,
  onClose
}: Props) {
  return (
    <div className="titlebar" data-tauri-drag-region onDoubleClick={onMaximize}>
      <div className="appicon" data-tauri-drag-region>
        刮
      </div>
      <span className="appname" data-tauri-drag-region>
        刮削器
      </span>
      <span className="subtitle" data-tauri-drag-region>
        {subtitle}
      </span>
      {showControls && (
        <div className="win-controls">
          <button className="wc" title="最小化" onClick={onMinimize}>
            <MinusOutlined />
          </button>
          <button className="wc" title="最大化 / 还原" onClick={onMaximize}>
            <BorderOutlined />
          </button>
          <button className="wc close" title="关闭" onClick={onClose}>
            <CloseOutlined />
          </button>
        </div>
      )}
    </div>
  )
}
