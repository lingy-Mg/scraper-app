import { useEffect, useState } from 'react'
import { Alert, Button, Modal, Tag } from 'antd'
import { CheckOutlined, ThunderboltOutlined } from '@ant-design/icons'
import type { AIConfig, Candidate, Row } from '../types'
import { errText } from '../utils'
import { native } from '../native'

const BG = [
  'linear-gradient(150deg,#4a5570,#232a38)',
  'linear-gradient(150deg,#5b4a52,#2c2229)',
  'linear-gradient(150deg,#3f5a55,#1e2b28)',
  'linear-gradient(150deg,#55496b,#292336)',
  'linear-gradient(150deg,#5a5340,#2b271d)',
  'linear-gradient(150deg,#43506b,#1f2531)'
]

interface Props {
  row: Row | null
  config: AIConfig
  onCancel: () => void
  onConfirm: (
    row: Row,
    candidate: Candidate,
    viaAI: boolean,
    confidence?: number
  ) => void
}

export default function CandidateModal({ row, config, onCancel, onConfirm }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle')
  const [pickId, setPickId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [confidence, setConfidence] = useState(0)
  const [fallback, setFallback] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const [covers, setCovers] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!row) {
      setCovers({})
      return
    }
    let cancelled = false
    setCovers({})
    void Promise.all(
      (row.candidates ?? [])
        .filter((candidate) => candidate.posterUrl)
        .map(async (candidate) => {
          try {
            const src = await native.coverSrc(candidate.posterUrl as string)
            if (!cancelled) setCovers((prev) => ({ ...prev, [candidate.id]: src }))
          } catch {
            // 封面失败保留渐变占位
          }
        })
    )
    return () => {
      cancelled = true
    }
  }, [row])

  useEffect(() => {
    if (row) {
      setSelected(null)
      setState('idle')
      setPickId(null)
      setReason('')
      setConfidence(0)
      setFallback(false)
      setElapsed(0)
      setError('')
    }
  }, [row])

  if (!row) return null
  const list = row.candidates || []
  const current = list.find((c) => c.id === selected)
  const recommended = list.find((c) => c.id === pickId)

  const runAI = async () => {
    if (!list.length) return
    setState('loading')
    setError('')
    try {
      const result = await native.aiPick(config, row.file, list)
      const matched = list.find((c) => c.id === result.pick)
      setPickId(matched ? result.pick : null)
      setSelected(matched ? result.pick : null)
      setConfidence(result.confidence)
      setReason(result.reason)
      setFallback(result.fallback)
      setElapsed(result.ms)
      setState('done')
    } catch (err) {
      setState('idle')
      setError(errText(err))
    }
  }

  return (
    <Modal
      open={!!row}
      onCancel={onCancel}
      width={720}
      title="选择匹配结果"
      footer={
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#636b76' }}>
            {current ? `已选：${current.title} (${current.year})` : '请选择一条结果'}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Button onClick={onCancel}>取消</Button>
            <Button
              type="primary"
              disabled={!current}
              onClick={() =>
                current &&
                onConfirm(
                  row,
                  current,
                  state === 'done' && selected === pickId,
                  state === 'done' && selected === pickId ? confidence : undefined
                )
              }
            >
              使用此结果
            </Button>
          </div>
        </div>
      }
    >
      <div className="cand-file">
        <span>原始文件</span>
        <code>{row.file}</code>
      </div>
      <div className="cand-file">
        <span>搜索关键词</span>
        <code>{row.query || row.title}</code>
      </div>

      <div className="cand-ai">
        <div className="grow">
          <div className="ai-label">
            <ThunderboltOutlined /> AI 自动选择
          </div>
          <div className="ai-hint">把原始文件名和 {list.length} 条候选一起交给模型判断</div>
        </div>
        <Button
          size="small"
          type="primary"
          ghost
          icon={<ThunderboltOutlined />}
          loading={state === 'loading'}
          disabled={!config.enabled || !list.length}
          onClick={runAI}
        >
          AI 选择
        </Button>
      </div>

      {state === 'done' && (
        <div className="cand-reason">
          AI 推荐{' '}
          <b>
            {recommended?.title || '—'}
            {recommended ? `（${recommended.year}）` : ''}
          </b>{' '}
          · 置信度 {Math.round(confidence * 100)}% · 耗时 {(elapsed / 1000).toFixed(2)} s
          {fallback && (
            <Tag color="orange" style={{ marginLeft: 6 }}>
              回退
            </Tag>
          )}
          <div style={{ marginTop: 2 }}>{reason}</div>
        </div>
      )}
      {error && (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 8 }}
          message="AI 选择失败"
          description={error}
        />
      )}
      {!config.enabled && (
        <div className="ai-hint" style={{ marginTop: 6 }}>
          AI 已关闭，请手动选择。
        </div>
      )}

      <div className="cand-list">
        {list.map((candidate) => (
          <div
            key={candidate.id}
            className={`cand ${selected === candidate.id ? 'on' : ''}`}
            onClick={() => setSelected(candidate.id)}
          >
            <div className="cand-check">{selected === candidate.id && <CheckOutlined />}</div>
            <div
              className="cand-poster"
              style={{ background: BG[Math.abs(candidate.poster) % BG.length] }}
            >
              {covers[candidate.id] && (
                <img src={covers[candidate.id]} alt="" />
              )}
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="cand-title">
                {candidate.title}{' '}
                <span className="cand-year">({candidate.year})</span>
                {state === 'done' && candidate.id === pickId && (
                  <Tag color="blue" style={{ marginLeft: 4 }}>
                    AI 推荐
                  </Tag>
                )}
              </div>
              <div className="cand-sub">
                {candidate.source} · {candidate.code} · 评分 {candidate.score}
              </div>
              <div className="cand-overview">{candidate.overview}</div>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
