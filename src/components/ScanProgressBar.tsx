import { useEffect, useState } from 'react'
import { LoadingOutlined } from '@ant-design/icons'
import type { ScanState } from '../types'

interface Props {
  scan: ScanState
  path: string
}

const fmtEta = (seconds: number) => {
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`
}

/**
 * 扫描进行中的进度条：枚举目录阶段为不确定进度动画，
 * 读取视频信息阶段显示 done/total 与预计剩余时间。
 */
export default function ScanProgressBar({ scan, path }: Props) {
  const [, setTick] = useState(0)

  // 让「已用时 / 预计剩余」在扫描期间持续走动。
  useEffect(() => {
    if (!scan.active) return
    const timer = window.setInterval(() => setTick((value) => value + 1), 500)
    return () => window.clearInterval(timer)
  }, [scan.active])

  if (!scan.active) return null

  const probing = scan.phase === 'probe' && scan.total > 0
  const percent = probing ? Math.min(100, Math.round((scan.done / scan.total) * 100)) : 0
  const elapsedMs = Math.max(0, Date.now() - scan.startedAt)
  const elapsed = Math.round(elapsedMs / 1000)

  const eta =
    probing && scan.done >= 3 && scan.total > scan.done
      ? Math.max(1, Math.round(((elapsedMs / scan.done) * (scan.total - scan.done)) / 1000))
      : 0

  const current = scan.current || path
  const meta = probing
    ? `${scan.done} / ${scan.total} 个文件 · ${percent}%`
    : `已发现 ${scan.found} 个视频${scan.dirs ? ` · 已枚举 ${scan.dirs} 个目录` : ''}`

  return (
    <div className="scanbar" role="status" aria-live="polite">
      <div className="scanbar-head">
        <LoadingOutlined className="scanbar-spin" />
        <span className="scanbar-title">
          {probing ? '正在读取视频信息…' : '正在枚举目录…'}
        </span>
        <span className="scanbar-meta">{meta}</span>
        {eta > 0 && <span className="scanbar-meta">剩余约 {fmtEta(eta)}</span>}
        <span className="scanbar-time">已用时 {elapsed}s</span>
      </div>
      <div className={`scanbar-track${probing ? '' : ' indeterminate'}`}>
        <i style={probing ? { width: `${percent}%` } : undefined} />
      </div>
      <div className="scanbar-current" title={current}>
        {current}
      </div>
    </div>
  )
}
