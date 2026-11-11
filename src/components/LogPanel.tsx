import { Button } from 'antd'
import type { LogLine } from '../types'

interface Props {
  logs: LogLine[]
  height: number
  onResizeStart: (event: React.MouseEvent) => void
  onClose: () => void
  onClear: () => void
}

export default function LogPanel({
  logs,
  height,
  onResizeStart,
  onClose,
  onClear
}: Props) {
  return (
    <div className="logpanel" style={{ height }}>
      <div className="log-resize" onMouseDown={onResizeStart} title="拖动调整日志高度" />
      <div className="loghead">
        <span>日志</span>
        <div className="r">
          <Button type="text" size="small" onClick={onClear}>
            清空
          </Button>
          <Button type="text" size="small" onClick={onClose}>
            ×
          </Button>
        </div>
      </div>
      <div className="logbody">
        {logs.map((line, i) => (
          <div key={i}>
            <span className="t">{line.time}</span>
            <span className={line.level === 'ok' ? 'ok' : line.level === 'warn' ? 'warn' : ''}>
              {line.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
