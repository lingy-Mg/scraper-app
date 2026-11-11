import { useMemo, useState } from 'react'
import { App as AntdApp, Alert, Button, Input, Modal, Tooltip } from 'antd'
import { CopyOutlined } from '@ant-design/icons'
import type { Magnet } from '../types'

/** 磁力链接只做展示与复制，不调用任何下载接口。 */
export function magnetLink(magnet: Magnet): string {
  return `magnet:?xt=urn:btih:${magnet.hash}&dn=${encodeURIComponent(magnet.name)}`
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 非 HTTPS / 无剪贴板权限时走手动复制
  }
  return false
}

interface Props {
  magnets?: Magnet[]
  loading?: boolean
  error?: string
}

export default function MagnetList({ magnets = [], loading, error }: Props) {
  const { message } = AntdApp.useApp()
  const [fallback, setFallback] = useState<string | null>(null)
  const links = useMemo(() => magnets.map(magnetLink), [magnets])

  const copy = async (text: string) => {
    if (await copyText(text)) {
      message.success('已复制到剪贴板')
      return
    }
    setFallback(text)
    message.warning('当前环境无法自动复制，请手动复制')
  }

  if (loading) {
    return <div style={{ fontSize: 11, color: '#8a929c', marginTop: 12 }}>磁力加载中…</div>
  }

  if (error) {
    return (
      <div style={{ marginTop: 12 }}>
        <Alert type="warning" showIcon message="磁力获取失败" description={error} />
      </div>
    )
  }

  if (!magnets.length) {
    return <div style={{ fontSize: 11, color: '#8a929c', marginTop: 12 }}>暂无磁力数据</div>
  }

  return (
    <div style={{ marginTop: 14, borderTop: '1px solid #eef0f2', paddingTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 500 }}>磁力（{magnets.length}）</span>
        <Button
          size="small"
          icon={<CopyOutlined />}
          style={{ marginLeft: 'auto' }}
          onClick={() => void copy(links.join('\n'))}
        >
          复制全部
        </Button>
      </div>
      <div style={{ display: 'grid', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
        {magnets.map((magnet, index) => (
          <div
            key={`${magnet.hash}-${index}`}
            style={{
              border: '1px solid #eef0f2',
              borderRadius: 4,
              padding: '6px 8px',
              background: '#fafbfc'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              <Tooltip title={magnet.name}>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: 11.5
                  }}
                >
                  {magnet.name}
                </span>
              </Tooltip>
              <Button
                type="link"
                size="small"
                icon={<CopyOutlined />}
                style={{ flex: 'none', height: 20, padding: '0 4px' }}
                onClick={() => void copy(magnetLink(magnet))}
              >
                复制
              </Button>
            </div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 6,
                fontSize: 10.5,
                color: '#636b76',
                marginTop: 3
              }}
            >
              {magnet.size && <span>{magnet.size}</span>}
              {magnet.cnsub && <span className="tag move">中文字幕</span>}
              {magnet.hd && <span className="tag move">高清</span>}
              {typeof magnet.filesCount === 'number' && magnet.filesCount > 0 && (
                <span>{magnet.filesCount} 个文件</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <Modal
        open={fallback !== null}
        title="手动复制磁力链接"
        width={560}
        onCancel={() => setFallback(null)}
        footer={<Button onClick={() => setFallback(null)}>关闭</Button>}
      >
        <p style={{ fontSize: 11.5, color: '#636b76', marginTop: 0 }}>
          无法自动写入剪贴板（需要 HTTPS 或剪贴板权限），请全选下方文本手动复制：
        </p>
        <Input.TextArea
          value={fallback ?? ''}
          readOnly
          autoSize={{ minRows: 3, maxRows: 8 }}
          onFocus={(event) => event.currentTarget.select()}
        />
      </Modal>
    </div>
  )
}
