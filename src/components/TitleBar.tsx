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
    <div className="titlebar" onDoubleClick={onMaximize}>
      <div className="appicon">刮</div>
      <span className="appname">刮削器</span>
      <span className="subtitle">{subtitle}</span>
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
