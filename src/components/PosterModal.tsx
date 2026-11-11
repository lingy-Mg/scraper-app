import { Button, Modal } from 'antd'
import { PlayCircleOutlined, ScissorOutlined, UndoOutlined } from '@ant-design/icons'
import type { Row } from '../types'
import { baseName, fmtDur } from '../utils'
import MagnetList from './MagnetList'

const BG = [
  'linear-gradient(150deg,#4a5570,#232a38)',
  'linear-gradient(150deg,#5b4a52,#2c2229)',
  'linear-gradient(150deg,#3f5a55,#1e2b28)'
]

interface Props {
  row: Row | null
  onClose: () => void
  onCrop: (row: Row) => void
  onReset: (row: Row) => void
}

function Meta({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 11.5, lineHeight: '18px' }}>
      <span style={{ color: 'var(--muted)', flex: 'none', width: 40 }}>{label}</span>
      <span style={{ minWidth: 0, wordBreak: 'break-word' }}>{value}</span>
    </div>
  )
}

export default function PosterModal({ row, onClose, onCrop, onReset }: Props) {
  return (
    <Modal
      open={!!row}
      onCancel={onClose}
      footer={
        row ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            {row.posterCrop && (
              <Button icon={<UndoOutlined />} onClick={() => onReset(row)}>
                恢复完整
              </Button>
            )}
            <Button
              type="primary"
              ghost
              icon={<ScissorOutlined />}
              disabled={!row.posterUrl}
              onClick={() => onCrop(row)}
            >
              手动裁剪
            </Button>
          </div>
        ) : null
      }
      width={380}
      centered
    >
      {row && (
        <>
          {row.posterSrc ? (
            <img className="poster-big" src={row.posterSrc} alt={row.title} />
          ) : (
            <div className="poster-big" style={{ background: BG[Math.abs(row.poster) % BG.length] }}>
              {row.code || '?'}
            </div>
          )}
          {row.posterUrl && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
              {row.posterCrop
                ? `已手动裁剪 · ${row.posterCrop.width}×${row.posterCrop.height}`
                : '完整封面 · 需要时再手动裁剪'}
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
              {row.code || '未识别'}
            </div>
            <div style={{ fontSize: 13, marginTop: 2, fontWeight: 500 }}>{row.title}</div>
            {row.overview && (
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>{row.overview}</div>
            )}
            <div style={{ marginTop: 10, display: 'grid', gap: 4 }}>
              <Meta label="片商" value={row.maker} />
              <Meta label="年份" value={row.year} />
              <Meta label="演员" value={row.actors} />
              <Meta
                label="时长"
                value={row.dur > 0 ? fmtDur(row.dur) : undefined}
              />
              <Meta
                label="评分"
                value={typeof row.score === 'number' && row.score > 0 ? row.score.toFixed(1) : undefined}
              />
              <Meta label="来源" value={row.src || undefined} />
              <Meta label="上映" value={row.releaseDate} />
              <Meta label="导演" value={row.director} />
              <Meta label="系列" value={row.series} />
              {row.tags && row.tags.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                  {row.tags.slice(0, 10).map((tag) => (
                    <span className="tag" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {row.trailerUrl && (
              <div style={{ marginTop: 10 }}>
                <Button
                  size="small"
                  icon={<PlayCircleOutlined />}
                  href={row.trailerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  预告片{row.trailerSite ? ` · ${row.trailerSite}` : ''}
                </Button>
              </div>
            )}

            <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 4 }}>字幕</div>
              {row.subtitlesLoading || row.subtitles === undefined ? (
                <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>正在匹配字幕…</div>
              ) : row.subtitlesError ? (
                <div style={{ fontSize: 11.5, color: 'var(--amber)' }}>
                  字幕匹配失败：{row.subtitlesError}
                </div>
              ) : row.subtitles.length === 0 ? (
                <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>未找到字幕</div>
              ) : (
                <div style={{ display: 'grid', gap: 3 }}>
                  {row.subtitles.map((subtitle) => (
                    <div
                      key={subtitle.path}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}
                    >
                      <span
                        title={subtitle.path}
                        style={{
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {baseName(subtitle.path)}
                      </span>
                      {subtitle.language && (
                        <span className="tag" style={{ flex: 'none' }}>
                          {subtitle.language}
                        </span>
                      )}
                      <span style={{ flex: 'none', color: 'var(--muted)' }}>
                        {subtitle.format.toUpperCase()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <MagnetList
              magnets={row.magnets}
              loading={row.magnetsLoading}
              error={row.magnetsError}
            />
          </div>
        </>
      )}
    </Modal>
  )
}
