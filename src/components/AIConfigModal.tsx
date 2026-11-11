import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
  Tabs,
  Tag
} from 'antd'
import { ApiOutlined, ThunderboltOutlined } from '@ant-design/icons'
import type { AIConfig } from '../types'
import { cleanFilename, errText } from '../utils'
import { native } from '../native'

const PRESETS: Record<string, { baseUrl: string; model: string } | null> = {
  DeepSeek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  'OpenAI 兼容': { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  通义千问: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus'
  },
  'Ollama 本地': { baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b' },
  'OpenCode API': {
    baseUrl: 'https://opencode.ai/inference/go/openai/v1',
    model: 'deepseek-v4.1-flash'
  },
  'OpenCode CLI': { baseUrl: '', model: 'opencode-go/deepseek-v4.1-flash' },
  自定义: null
}

interface Props {
  open: boolean
  config: AIConfig
  onCancel: () => void
  onSave: (config: AIConfig) => void
}

export default function AIConfigModal({ open, config, onCancel, onSave }: Props) {
  const [enabled, setEnabled] = useState(config.enabled)
  const [provider, setProvider] = useState(config.provider)
  const [baseUrl, setBaseUrl] = useState(config.baseUrl)
  const [apiKey, setApiKey] = useState(config.apiKey)
  const [model, setModel] = useState(config.model)
  const [temperature, setTemperature] = useState(config.temperature)
  const [timeout, setTimeoutValue] = useState(config.timeout)
  const [clean, setClean] = useState(config.cleanFilename)
  const [infer, setInfer] = useState(config.inferCode)
  const [verify, setVerify] = useState(config.verify)
  const [fallback, setFallback] = useState(config.fallback)
  const [autoPick, setAutoPick] = useState(config.autoPick)
  const [autoPickThreshold, setAutoPickThreshold] = useState(config.autoPickThreshold)
  const [prompt, setPrompt] = useState(config.prompt)

  const [testingConn, setTestingConn] = useState(false)
  const [connResult, setConnResult] = useState('')
  const [sample, setSample] = useState('489155.com@IDPC-001.mp4')
  const [testing, setTesting] = useState(false)
  const [testError, setTestError] = useState('')
  const [result, setResult] = useState<{
    cleaned: string
    code: string
    title: string
    confidence: number
    ms: number
    fallback: boolean
  } | null>(null)

  useEffect(() => {
    if (!open) return
    setEnabled(config.enabled)
    setProvider(config.provider)
    setBaseUrl(config.baseUrl)
    setApiKey(config.apiKey)
    setModel(config.model)
    setTemperature(config.temperature)
    setTimeoutValue(config.timeout)
    setClean(config.cleanFilename)
    setInfer(config.inferCode)
    setVerify(config.verify)
    setFallback(config.fallback)
    setAutoPick(config.autoPick)
    setAutoPickThreshold(config.autoPickThreshold)
    setPrompt(config.prompt)
    setConnResult('')
    setResult(null)
    setTestError('')
  }, [open, config])

  const currentConfig = (): AIConfig => ({
    enabled,
    provider,
    baseUrl,
    apiKey,
    model,
    temperature,
    timeout,
    cleanFilename: clean,
    inferCode: infer,
    verify,
    fallback,
    autoPick,
    autoPickThreshold,
    prompt
  })

  const changeProvider = (value: string) => {
    setProvider(value)
    const preset = PRESETS[value]
    if (preset) {
      setBaseUrl(preset.baseUrl)
      setModel(preset.model)
      if (value === 'OpenCode API') setTimeoutValue(60)
    }
  }

  const testConnection = async () => {
    if (!baseUrl && provider !== 'OpenCode CLI') {
      setConnResult('请先填写 Base URL')
      return
    }
    setTestingConn(true)
    setConnResult('')
    try {
      const res = await native.aiTest(currentConfig())
      setConnResult(
        `${res.ok ? '连接成功' : '连接失败'} · 延迟 ${res.latencyMs} ms${res.ok ? '' : ` · ${res.message}`}`
      )
    } catch (error) {
      setConnResult(`连接失败 · ${errText(error)}`)
    } finally {
      setTestingConn(false)
    }
  }

  const runTest = async () => {
    if (!sample.trim()) return
    setTesting(true)
    setResult(null)
    setTestError('')
    try {
      const res = await native.aiIdentify(currentConfig(), sample.trim())
      setResult({
        cleaned: clean ? cleanFilename(sample.trim()) : sample.trim(),
        code: res.code || '未识别',
        title: res.title || '—',
        confidence: res.confidence,
        ms: res.ms,
        fallback: res.fallback
      })
    } catch (error) {
      setTestError(errText(error))
    } finally {
      setTesting(false)
    }
  }

  const save = () =>
    onSave({
      enabled,
      provider,
      baseUrl,
      apiKey,
      model,
      temperature,
      timeout,
      cleanFilename: clean,
      inferCode: infer,
      verify,
      fallback,
      autoPick,
      autoPickThreshold,
      prompt
    })

  const switchRow = (
    label: string,
    hint: string,
    checked: boolean,
    onChange: (v: boolean) => void
  ) => (
    <div className="ai-row" key={label}>
      <div>
        <div className="ai-label">{label}</div>
        <div className="ai-hint">{hint}</div>
      </div>
      <Switch size="small" checked={checked} onChange={onChange} />
    </div>
  )

  const items = [
    {
      key: 'model',
      label: '模型',
      children: (
        <div>
          {switchRow('启用 AI 识别', '关闭后仅使用正则解析文件名', enabled, setEnabled)}

          <div className="field">
            <label>服务商</label>
            <Select
              size="small"
              value={provider}
              onChange={changeProvider}
              style={{ width: 180 }}
              options={Object.keys(PRESETS).map((name) => ({ value: name }))}
            />
          </div>

          {provider === 'OpenCode API' && (
            <div className="ai-hint" style={{ lineHeight: '18px' }}>
              OpenCode Console / Go 的 OpenAI 兼容接口。
              Go 订阅填 <code>https://opencode.ai/inference/go/openai/v1</code>；
              余额计费填 <code>https://opencode.ai/inference/openai/v1</code>。
              API Key 在 OpenCode Console 创建，模型 ID 例如 <code>deepseek-v4.1-flash</code>、
              <code>glm-5.3</code>、<code>kimi-k3</code>。
            </div>
          )}

          {provider === 'OpenCode CLI' ? (
            <div className="field">
              <div className="ai-hint" style={{ lineHeight: '18px' }}>
                使用本机已登录的 <code>opencode</code> CLI，无需 API Key。
                模型填 <code>provider/model</code>，例如{' '}
                <code>opencode-go/deepseek-v4.1-flash</code>。
                <br />
                先用 <code>opencode auth login</code> 完成登录；打包版需要 opencode 在 PATH 中。
              </div>
            </div>
          ) : (
            <>
              <div className="field">
                <label>Base URL</label>
                <Input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
                />
              </div>

              <div className="field">
                <label>API Key</label>
                <Input.Password
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-…"
                  style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
                />
                <div className="ai-hint">只保存在本机，不会上传；留空时读取环境变量。</div>
              </div>
            </>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label>{provider === 'OpenCode CLI' ? '模型（provider/model）' : '模型'}</label>
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
              />
            </div>
            <div className="field">
              <label>温度</label>
              <InputNumber
                size="small"
                min={0}
                max={2}
                step={0.1}
                value={temperature}
                onChange={(v) => setTemperature(v ?? 0.1)}
                style={{ width: '100%' }}
              />
            </div>
          </div>

          <div className="field">
            <label>超时（秒）</label>
            <InputNumber
              size="small"
              min={5}
              max={120}
              value={timeout}
              onChange={(v) => setTimeoutValue(v ?? 20)}
              style={{ width: 100 }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Button icon={<ApiOutlined />} size="small" loading={testingConn} onClick={testConnection}>
              测试连接
            </Button>
            {connResult && (
              <span
                className="ai-hint"
                style={{ color: connResult.startsWith('连接成功') ? 'var(--green)' : 'var(--amber)' }}
              >
                {connResult}
              </span>
            )}
          </div>
        </div>
      )
    },
    {
      key: 'rules',
      label: '识别规则',
      children: (
        <div>
          {switchRow('文件名清洗', '去掉 489155.com@、[1080p]、(1) 等噪声', clean, setClean)}
          {switchRow('AI 推断番号', '让模型从清洗后的文件名给出候选番号', infer, setInfer)}
          {switchRow('结果二次校验', '匹配后再让模型核对标题与番号是否一致', verify, setVerify)}
          {switchRow('失败回退正则', 'AI 超时或低置信度时使用本地正则', fallback, setFallback)}
          {switchRow('多结果时自动选择', '搜索结果多于 1 条时，让模型直接选一个', autoPick, setAutoPick)}
          {autoPick && (
            <div className="field" style={{ marginTop: 8 }}>
              <label>自动选择阈值</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <InputNumber
                  size="small"
                  min={0.5}
                  max={1}
                  step={0.05}
                  value={autoPickThreshold}
                  onChange={(v) => setAutoPickThreshold(v ?? 0.9)}
                  style={{ width: 90 }}
                />
                <span className="ai-hint" style={{ marginTop: 0 }}>
                  低于阈值时保留「待选择」，由用户决定
                </span>
              </div>
            </div>
          )}

          <div className="field" style={{ marginTop: 14 }}>
            <label>提示词</label>
            <Input.TextArea
              rows={7}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
            />
            <div className="ai-hint">
              可用变量：<code>{'{filename}'}</code> <code>{'{source}'}</code>；要求模型返回 JSON。
            </div>
          </div>
        </div>
      )
    },
    {
      key: 'test',
      label: '识别测试',
      children: (
        <div>
          <div className="field">
            <label>文件名</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <Input
                value={sample}
                onChange={(e) => setSample(e.target.value)}
                style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
              />
              <Button
                type="primary"
                size="small"
                icon={<ThunderboltOutlined />}
                loading={testing}
                onClick={runTest}
              >
                识别
              </Button>
            </div>
          </div>

          {result ? (
            <div className="ai-result">
              <div className="row">
                <span>清洗后</span>
                <code>{result.cleaned}</code>
              </div>
              <div className="row">
                <span>番号</span>
                <b style={{ fontFamily: 'var(--mono)' }}>{result.code}</b>
              </div>
              <div className="row">
                <span>标题</span>
                <span>{result.title}</span>
              </div>
              <div className="row">
                <span>置信度</span>
                <Tag color={result.confidence >= 0.9 ? 'green' : result.confidence >= 0.7 ? 'orange' : 'red'}>
                  {Math.round(result.confidence * 100)}%
                </Tag>
              </div>
              <div className="row">
                <span>耗时</span>
                <span>{(result.ms / 1000).toFixed(2)} s</span>
              </div>
              <div className="row">
                <span>来源</span>
                <Tag color={result.fallback ? 'orange' : 'blue'}>
                  {result.fallback ? '本地正则回退' : 'AI 模型'}
                </Tag>
              </div>
            </div>
          ) : testError ? (
            <Alert
              type="error"
              showIcon
              message="识别失败"
              description={testError}
            />
          ) : (
            <Alert
              type="info"
              showIcon
              message="输入一个带水印的文件名，测试清洗和番号推断效果。"
            />
          )}
        </div>
      )
    }
  ]

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      title="AI 识别设置"
      width={620}
      footer={
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            {enabled ? `AI 已启用 · ${model}` : 'AI 已关闭，将使用正则解析'}
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
      <Tabs size="small" items={items} />
    </Modal>
  )
}
