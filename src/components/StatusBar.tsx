import type { NativeMode } from '../types'

interface Props {
  modeName: string
  count: number
  selected: number
  size: string
  note: string
  task: string
  aiEnabled: boolean
  aiModel: string
  ffprobe: boolean
  nativeMode: NativeMode
}

const NATIVE_LABEL: Record<NativeMode, string> = {
  http: 'HTTP'
}

export default function StatusBar({
  modeName,
  count,
  selected,
  size,
  note,
  task,
  aiEnabled,
  aiModel,
  ffprobe,
  nativeMode
}: Props) {
  return (
    <div className="statusbar">
      <div className="sb">{task === '空闲' ? '就绪' : task}</div>
      <div className="sb">{modeName} 模式</div>
      <div className="sb">
        <b>{count}</b> 个视频
      </div>
      <div className="sb">
        已选 <b>{selected}</b>
      </div>
      <div className="sb">
        总大小 <b>{size}</b>
      </div>
      <div className="sb grow">{note}</div>
      <div className="sb">{NATIVE_LABEL[nativeMode]}后端</div>
      <div className="sb">
        <span style={{ color: aiEnabled ? 'var(--green)' : 'var(--muted-2)' }}>●</span>{' '}
        {aiEnabled ? `AI · ${aiModel}` : 'AI 已关闭'}
      </div>
      <div className="sb">
        <span className={ffprobe ? 'ok' : undefined} style={ffprobe ? undefined : { color: 'var(--muted-2)' }}>
          ●
        </span>{' '}
        {ffprobe ? 'ffprobe 就绪' : 'ffprobe 不可用'}
      </div>
      <div className="sb">任务 · {task}</div>
      <div className="grip" />
    </div>
  )
}
