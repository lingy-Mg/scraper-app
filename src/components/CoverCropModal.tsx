import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, SyntheticEvent } from 'react'
import { Alert, Button, Modal, Spin } from 'antd'
import type { CropRect, Row } from '../types'
import { native } from '../native'
import { errText } from '../utils'

const MAX_WIDTH = 620
const MAX_HEIGHT = 460
const MIN_SIZE = 24

type DragMode = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const HANDLES: DragMode[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max))

interface Props {
  row: Row | null
  onCancel: () => void
  onApply: (row: Row, crop: CropRect, src: string) => void
}

export default function CoverCropModal({ row, onCancel, onApply }: Props) {
  const [src, setSrc] = useState('')
  const [natural, setNatural] = useState({ width: 0, height: 0 })
  const [rect, setRect] = useState<CropRect>({ x: 0, y: 0, width: 0, height: 0 })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const dragRef = useRef<{
    mode: DragMode
    startX: number
    startY: number
    rect: CropRect
    scale: number
  } | null>(null)

  useEffect(() => {
    if (!row?.posterUrl) {
      setSrc('')
      setNatural({ width: 0, height: 0 })
      return
    }
    let cancelled = false
    setLoading(true)
    setError('')
    setSrc('')
    setNatural({ width: 0, height: 0 })
    void native
      .coverSrc(row.posterUrl)
      .then((value) => {
        if (!cancelled) setSrc(value)
      })
      .catch((err) => {
        if (!cancelled) setError(errText(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [row])

  const scale =
    natural.width > 0
      ? Math.min(MAX_WIDTH / natural.width, MAX_HEIGHT / natural.height, 1)
      : 1

  const onImageLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget
    const width = image.naturalWidth
    const height = image.naturalHeight
    setNatural({ width, height })
    const saved = row?.posterCrop
    if (saved && saved.width > 1 && saved.height > 1) {
      setRect({
        x: clamp(saved.x, 0, width - 1),
        y: clamp(saved.y, 0, height - 1),
        width: clamp(saved.width, 1, width - clamp(saved.x, 0, width - 1)),
        height: clamp(saved.height, 1, height - clamp(saved.y, 0, height - 1))
      })
    } else {
      setRect({ x: 0, y: 0, width, height })
    }
  }

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || !natural.width || !natural.height) return
      const dx = (event.clientX - drag.startX) / drag.scale
      const dy = (event.clientY - drag.startY) / drag.scale
      let { x, y, width, height } = drag.rect

      if (drag.mode === 'move') {
        x = clamp(drag.rect.x + dx, 0, natural.width - width)
        y = clamp(drag.rect.y + dy, 0, natural.height - height)
      } else {
        if (drag.mode.includes('e')) {
          width = clamp(drag.rect.width + dx, MIN_SIZE, natural.width - drag.rect.x)
        }
        if (drag.mode.includes('s')) {
          height = clamp(drag.rect.height + dy, MIN_SIZE, natural.height - drag.rect.y)
        }
        if (drag.mode.includes('w')) {
          const nextX = clamp(drag.rect.x + dx, 0, drag.rect.x + drag.rect.width - MIN_SIZE)
          width = drag.rect.width + (drag.rect.x - nextX)
          x = nextX
        }
        if (drag.mode.includes('n')) {
          const nextY = clamp(drag.rect.y + dy, 0, drag.rect.y + drag.rect.height - MIN_SIZE)
          height = drag.rect.height + (drag.rect.y - nextY)
          y = nextY
        }
      }

      setRect({
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height)
      })
    }
    const onUp = () => {
      dragRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [natural])

  const startDrag = (event: ReactPointerEvent, mode: DragMode) => {
    if (!natural.width) return
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      rect,
      scale
    }
  }

  const apply = async () => {
    if (!row?.posterUrl || rect.width < 1 || rect.height < 1) return
    setSaving(true)
    setError('')
    try {
      const value = await native.coverCrop(row.posterUrl, rect)
      onApply(row, rect, value)
    } catch (err) {
      setError(errText(err))
    } finally {
      setSaving(false)
    }
  }

  const full = () => setRect({ x: 0, y: 0, width: natural.width, height: natural.height })
  const rightHalf = () => {
    const half = Math.floor(natural.width / 2)
    setRect({ x: half, y: 0, width: natural.width - half, height: natural.height })
  }
  const leftHalf = () => {
    const half = Math.floor(natural.width / 2)
    setRect({ x: 0, y: 0, width: half, height: natural.height })
  }

  const boxStyle: CSSProperties = {
    left: rect.x * scale,
    top: rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale
  }

  return (
    <Modal
      open={!!row}
      title="手动裁剪封面"
      width={720}
      centered
      destroyOnHidden
      onCancel={saving ? undefined : onCancel}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: '#636b76' }}>
            {rect.width > 0
              ? `裁剪区域 ${rect.width} × ${rect.height}`
              : '正在加载封面…'}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Button onClick={onCancel} disabled={saving}>
              取消
            </Button>
            <Button
              type="primary"
              loading={saving}
              disabled={!src || rect.width < 1}
              onClick={() => void apply()}
            >
              应用裁剪
            </Button>
          </div>
        </div>
      }
    >
      <div className="ai-hint" style={{ marginBottom: 8, lineHeight: '18px' }}>
        默认显示完整封面。拖动选框移动位置，拖拽边角调整大小；不需要裁剪时直接关闭即可。
      </div>
      {error && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 8 }}
          message="封面处理失败"
          description={error}
        />
      )}
      {loading ? (
        <div style={{ height: 280, display: 'grid', placeItems: 'center' }}>
          <Spin />
        </div>
      ) : src ? (
        <>
          <div
            className="crop-stage"
            style={{
              width: natural.width ? natural.width * scale : 0,
              height: natural.height ? natural.height * scale : 0
            }}
          >
            <img src={src} alt="" draggable={false} onLoad={onImageLoad} />
            {natural.width > 0 && (
              <div className="crop-box" style={boxStyle} onPointerDown={(event) => startDrag(event, 'move')}>
                {HANDLES.map((handle) => (
                  <span
                    key={handle}
                    className={`crop-handle ${handle}`}
                    onPointerDown={(event) => startDrag(event, handle)}
                  />
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            <Button size="small" onClick={full}>
              完整
            </Button>
            <Button size="small" onClick={leftHalf}>
              左半
            </Button>
            <Button size="small" onClick={rightHalf}>
              右半
            </Button>
          </div>
        </>
      ) : (
        <div style={{ padding: 24, color: '#8a929c' }}>没有可用的封面地址</div>
      )}
    </Modal>
  )
}
