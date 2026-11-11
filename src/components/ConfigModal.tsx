import { useEffect, useState } from 'react'
import { Button, Checkbox, Input, Modal, Select } from 'antd'
import type { ModeConfig } from '../types'

interface Props {
  open: boolean
  config: ModeConfig
  onCancel: () => void
  onSave: (config: ModeConfig) => void
}

export default function ConfigModal({ open, config, onCancel, onSave }: Props) {
  const [sources, setSources] = useState<string[]>([])
  const [downloads, setDownloads] = useState<string[]>([])
  const [lang, setLang] = useState(config.lang)
  const [naming, setNaming] = useState(config.naming)
  const [organize, setOrganize] = useState(config.organize)
  const [tmdbApiKey, setTmdbApiKey] = useState(config.tmdbApiKey || '')
  const [tmdbLang, setTmdbLang] = useState(config.tmdbLang || 'zh-CN')
  const [bangumiToken, setBangumiToken] = useState(config.bangumiToken || '')

  useEffect(() => {
    if (!open) return
    setSources(config.sources.filter((s) => s.on).map((s) => s.label))
    setDownloads(config.downloads.filter((d) => d.on).map((d) => d.label))
    setLang(config.lang)
    setNaming(config.naming)
    setOrganize(config.organize)
    setTmdbApiKey(config.tmdbApiKey || '')
    setTmdbLang(config.tmdbLang || 'zh-CN')
    setBangumiToken(config.bangumiToken || '')
  }, [open, config])

  const save = () =>
    onSave({
      ...config,
      lang,
      naming,
      organize,
      tmdbApiKey,
      tmdbLang,
      bangumiToken,
      sources: config.sources.map((s) => ({ ...s, on: sources.includes(s.label) })),
      downloads: config.downloads.map((d) => ({ ...d, on: downloads.includes(d.label) }))
    })

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      title={`刮削配置 — ${config.name}`}
      width={560}
      footer={
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#636b76' }}>
            仅对「{config.name}」模式生效
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Button onClick={onCancel}>取消</Button>
            <Button type="primary" onClick={save}>
              保存
            </Button>
          </div>
        </div>
      }
    >
      <div className="dlg-body">
        <div className="field">
          <label>数据源</label>
          <Checkbox.Group
            value={sources}
            onChange={(v) => setSources(v as string[])}
            options={config.sources.map((s) => s.label)}
          />
        </div>

        {(config.key === 'movie' || config.key === 'tv') && (
          <>
            <div className="field">
              <label>TMDB API Key</label>
              <Input.Password
                value={tmdbApiKey}
                onChange={(e) => setTmdbApiKey(e.target.value)}
                placeholder="v3 API Key 或 v4 Read Access Token"
                style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
              />
              <div className="ai-hint">
                在 TMDB 账户设置中申请；只保存在本机，用于电影/电视剧刮削。
              </div>
            </div>
            <div className="field">
              <label>TMDB 语言</label>
              <Input
                value={tmdbLang}
                onChange={(e) => setTmdbLang(e.target.value)}
                placeholder="zh-CN"
                style={{ fontFamily: 'var(--mono)', fontSize: 11, width: 140 }}
              />
            </div>
          </>
        )}

        {config.key === 'anime' && (
          <div className="field">
            <label>Bangumi Token（可选）</label>
            <Input.Password
              value={bangumiToken}
              onChange={(e) => setBangumiToken(e.target.value)}
              placeholder="留空则匿名访问"
              style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
            />
            <div className="ai-hint">用于提高 Bangumi API 限额；只保存在本机。</div>
          </div>
        )}

        <div className="field">
          <label>语言</label>
          <Select
            size="small"
            value={lang}
            onChange={setLang}
            style={{ width: 130 }}
            options={[{ value: '中文' }, { value: '日语' }, { value: '英文' }]}
          />
        </div>

        <div className="field">
          <label>下载内容</label>
          <Checkbox.Group
            value={downloads}
            onChange={(v) => setDownloads(v as string[])}
            options={config.downloads.map((d) => d.label)}
          />
        </div>

        <div className="field">
          <label>命名规则</label>
          <Input
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
            style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
          />
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label>整理规则</label>
          <Input
            value={organize}
            onChange={(e) => setOrganize(e.target.value)}
            style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
          />
        </div>
      </div>
    </Modal>
  )
}
