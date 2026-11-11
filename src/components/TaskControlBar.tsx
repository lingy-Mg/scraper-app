import { Button } from 'antd'
import {
  CloseOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  StopOutlined
} from '@ant-design/icons'
import type { TaskQueueProgress, TaskQueueState } from '../taskQueue'

interface Props {
  label: string
  progress: TaskQueueProgress
  onPause: () => void
  onResume: () => void
  onCancel: () => void
  onDismiss: () => void
}

const STATE_LABEL: Record<TaskQueueState, string> = {
  idle: '准备中',
  running: '运行中',
  paused: '已暂停',
  cancelled: '已取消',
  done: '已完成'
}

/**
 * 批量任务控制条：显示已完成/总数（失败 N），提供暂停、继续与取消。
 * 取消只停止派发并中断在途请求，已完成结果保留。
 */
export default function TaskControlBar({
  label,
  progress,
  onPause,
  onResume,
  onCancel,
  onDismiss
}: Props) {
  const percent =
    progress.total > 0
      ? Math.min(100, Math.round(((progress.done + progress.failed) / progress.total) * 100))
      : 100
  const active = progress.state === 'running' || progress.state === 'paused'

  return (
    <div className={`taskbar taskbar-${progress.state}`} role="status" aria-live="polite">
      <div className="taskbar-head">
        <span className="taskbar-title">{label}</span>
        <span className="taskbar-state">{STATE_LABEL[progress.state]}</span>
        <span className="taskbar-meta">
          已完成 <b>{progress.done}</b> / {progress.total}
          {progress.failed ? (
            <span className="taskbar-failed">（失败 {progress.failed}）</span>
          ) : null}
        </span>
        {progress.running > 0 && (
          <span className="taskbar-meta">执行中 {progress.running}</span>
        )}
        <span className="taskbar-percent">{percent}%</span>
        <div className="taskbar-actions">
          {progress.state === 'running' && (
            <Button size="small" icon={<PauseCircleOutlined />} onClick={onPause}>
              暂停
            </Button>
          )}
          {progress.state === 'paused' && (
            <Button size="small" type="primary" icon={<PlayCircleOutlined />} onClick={onResume}>
              继续
            </Button>
          )}
          {active && (
            <Button size="small" danger icon={<StopOutlined />} onClick={onCancel}>
              取消
            </Button>
          )}
          {!active && (
            <Button size="small" icon={<CloseOutlined />} onClick={onDismiss}>
              关闭
            </Button>
          )}
        </div>
      </div>
      <div className="taskbar-track">
        <i style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
