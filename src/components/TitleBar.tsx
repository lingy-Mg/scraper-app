interface Props {
  subtitle: string
}

export default function TitleBar({ subtitle }: Props) {
  return (
    <div className="titlebar">
      <div className="appicon">刮</div>
      <span className="appname">刮削器</span>
      <span className="subtitle">{subtitle}</span>
    </div>
  )
}
