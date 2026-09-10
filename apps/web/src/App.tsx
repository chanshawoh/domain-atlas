import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, Circle, Copy, FileCode2, FolderTree, GitBranch, History, List, Map, Maximize, RefreshCw, Search, SlidersHorizontal, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { BusinessCapability, BusinessDomain, RequirementParty } from '../../../src/core/model';
import type { AtlasSnapshot, ProjectedChange } from '../../../src/web/contracts';

type Page = 'map' | 'changes' | 'guide';
type Selection = { kind: 'change' | 'capability' | 'domain'; id: string } | null;
const confidenceNames = { low: '低', medium: '中', high: '高' };
const kindNames = { change: '变更', correction: '纠正', revert: '撤销' };
const testNames = { passed: '通过', failed: '失败', 'not-run': '未运行' };
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const sourceName = (source: string) => source === 'codebase-memory-mcp' ? '图谱推导' : source === 'changed-file-path' ? '路径推断' : source;
// Keep the complete evidence below; use its first nonempty line as a compact reading title.
const recordTitle = (record: ProjectedChange) => ((record.summary || record.request).split(/\r?\n/).find(line => line.trim()) || '无摘要记录').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*`#]/g, '').slice(0, 100);

function Status({ record }: { record: ProjectedChange }) {
  const committed = record.lifecycle.state === 'committed';
  return <span className={'badge ' + (committed ? 'green' : 'amber')}>{committed ? <CheckCircle2 /> : <Circle />}{committed ? '已提交' : '待提交'}</span>;
}
function Confidence({ node }: { node: BusinessDomain }) {
  return <span className={'confidence ' + (node.confidence === 'low' ? 'low' : '')}>{node.confidence === 'low' && <AlertCircle />}{confidenceNames[node.confidence]}置信度</span>;
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="detail-section"><h3>{title}</h3>{children}</section>;
}
function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><FolderTree /><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}
function Parties({ parties }: { parties: RequirementParty[] | undefined }) {
  const kinds = { alias: '称呼', role: '角色', team: '团队' };
  return parties?.length ? <>{parties.map((party, index) => <div className="evidence-node" key={index}><strong>{party.name}</strong><span className="badge">{kinds[party.kind]}</span><details><summary>原话依据 · 中置信度</summary><p className="preserve">{party.evidence}</p></details></div>)}</> : <p className="muted">{parties ? '未识别到明确来源' : '未采集'}</p>;
}
const identityLabel = (identity: { name?: string; email?: string } | null | undefined) => identity ? [identity.name, identity.email && `<${identity.email}>`].filter(Boolean).join(' ') || '未采集' : '未采集';
function RawRecord({ record, close }: { record: ProjectedChange; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { lifecycle: _lifecycle, ...raw } = record;
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} onCancel={close} aria-labelledby="raw-title"><div className="panel-heading"><h2 id="raw-title">原始记录</h2><button className="icon-button" autoFocus onClick={close} aria-label="关闭原始记录"><X /></button></div><pre>{JSON.stringify(raw, null, 2)}</pre></dialog>;
}

export default function App() {
  const [data, setData] = useState<AtlasSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<Page>('map');
  const [selection, setSelection] = useState<Selection>(null);
  const [capabilityId, setCapabilityId] = useState('');
  const [search, setSearch] = useState('');
  const [confidence, setConfidence] = useState('');
  const [view, setView] = useState<'map' | 'list'>('map');
  const [onlyCapability, setOnlyCapability] = useState(false);
  const [recordSearch, setRecordSearch] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [listPage, setListPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [raw, setRaw] = useState(false);
  const [notice, setNotice] = useState('');
  const initialized = useRef(false);
  const detailRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    fetch('/api/atlas', { signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || '项目加载失败');
      return body as AtlasSnapshot;
    }).then(snapshot => {
      setData(snapshot);
      if (!initialized.current) {
        initialized.current = true;
        const first = snapshot.changes[0];
        if (first && window.matchMedia('(min-width: 761px)').matches) { setSelection({ kind: 'change', id: first.id }); setCapabilityId(first.affectedCapabilityIds[0] || ''); }
      }
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '无法连接本地服务'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => { setListPage(0); }, [recordSearch, kind, status, from, to, onlyCapability, capabilityId]);
  useEffect(() => { detailRef.current?.scrollTo(0, 0); }, [selection?.id]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 3500); return () => clearTimeout(timer); }, [notice]);

  const selectedCapability = data?.capabilities.find(item => item.id === capabilityId);
  const selectedChange = selection?.kind === 'change' ? data?.changes.find(item => item.id === selection.id) : undefined;
  const selectedNode = selection?.kind === 'capability' ? data?.capabilities.find(item => item.id === selection.id) : selection?.kind === 'domain' ? data?.domains.find(item => item.id === selection.id) : undefined;
  const domainName = (id: string) => data?.domains.find(item => item.id === id)?.name ?? '所属域缺失';
  const capabilityName = (id: string) => data?.capabilities.find(item => item.id === id)?.name ?? id + '（能力缺失）';
  const relatedChanges = (id: string) => data?.changes.filter(item => item.affectedCapabilityIds.includes(id)) ?? [];
  function openChange(record: ProjectedChange) {
    setSelection({ kind: 'change', id: record.id });
    setCapabilityId(current => record.affectedCapabilityIds.includes(current) ? current : record.affectedCapabilityIds[0] || '');
    setRaw(false);
  }
  function openCapability(node: BusinessCapability) { setCapabilityId(node.id); setSelection({ kind: 'capability', id: node.id }); }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setNotice('记录 ID 已复制'); }
    catch { setNotice('复制失败，请从原始记录中手动复制'); }
  }
  function navigate(next: Page) { setPage(next); setRaw(false); }

  const q = search.trim().toLowerCase();
  const groups = data ? [...data.domains.map(domain => ({ domain, nodes: data.capabilities.filter(node => node.domainId === domain.id) })),
    ...(data.capabilities.some(node => !data.domains.some(domain => domain.id === node.domainId)) ? [{ domain: null, nodes: data.capabilities.filter(node => !data.domains.some(domain => domain.id === node.domainId)) }] : [])]
    .map(group => ({ ...group, nodes: group.nodes.filter(node => (!q || node.name.toLowerCase().includes(q) || group.domain?.name.toLowerCase().includes(q)) && (!confidence || node.confidence === confidence)) }))
    .filter(group => group.nodes.length || (!confidence && (!q || group.domain?.name.toLowerCase().includes(q)))) : [];
  const filteredChanges = data?.changes.filter(record => {
    const text = recordSearch.trim().toLowerCase();
    return (!onlyCapability || !capabilityId || record.affectedCapabilityIds.includes(capabilityId)) && (page !== 'changes' ||
      ((!text || [record.request, record.summary, record.id, identityLabel(record.attribution?.developmentIdentity), ...(record.attribution?.requestedBy ?? []).map(party => party.name), ...(record.attribution?.feedbackBy ?? []).map(party => party.name), ...(record.lifecycle.state === 'committed' ? [identityLabel(record.lifecycle.author), identityLabel(record.lifecycle.committer)] : [])].join(' ').toLowerCase().includes(text)) && (!kind || record.kind === kind) && (!status || record.lifecycle.state === status)
      && (!from || Date.parse(record.recordedAt) >= new Date(from + 'T00:00:00').getTime()) && (!to || Date.parse(record.recordedAt) <= new Date(to + 'T23:59:59.999').getTime())));
  }) ?? [];
  const pageSize = page === 'map' ? 4 : 10;
  const actualPage = Math.min(listPage, Math.max(0, Math.ceil(filteredChanges.length / pageSize) - 1));
  const visibleChanges = filteredChanges.slice(page === 'map' ? 0 : actualPage * pageSize, page === 'map' ? pageSize : (actualPage + 1) * pageSize);

  const recordsPanel = <section className="panel records-panel">
    <div className="panel-heading"><div><h2>{page === 'map' ? '最近变更' : '全部变更'}</h2><span className="muted">{page === 'map' ? `显示最近 ${visibleChanges.length} 条` : `共 ${filteredChanges.length} 条`}</span></div>{page === 'map' && <button className="text-button" onClick={() => navigate('changes')}>查看全部 <ArrowRight /></button>}</div>
    {selectedCapability && <div className="records-option"><label><input type="checkbox" checked={onlyCapability} onChange={event => setOnlyCapability(event.target.checked)} />仅看 {selectedCapability.name}</label><button className="text-button" onClick={() => { setOnlyCapability(false); setCapabilityId(''); }}>清除能力选择</button></div>}
    <div className="record-list">{visibleChanges.map(record => <button key={record.id} className={'record-row ' + (selection?.id === record.id ? 'selected' : '')} onClick={() => openChange(record)}>
      <time>{date(record.recordedAt)}</time><span className="record-summary"><strong>{recordTitle(record)}</strong><small>{record.affectedCapabilityIds.length ? record.affectedCapabilityIds.map(capabilityName).join('、') : '暂无关联能力'} · {record.changedFiles.length} 个文件{record.supersedes && ' · 关联历史记录'}</small></span><span className="badge">{kindNames[record.kind]}</span><Status record={record} />
    </button>)}</div>
    {!visibleChanges.length && <Empty title={data?.changes.length ? '没有符合条件的变更' : '尚无变更记录'}>{data?.changes.length ? '调整筛选条件，或清除能力选择。' : '完成一次接入后的开发任务，即可在这里追溯变化。'}</Empty>}
    {page === 'changes' && filteredChanges.length > pageSize && <div className="pagination"><span>第 {actualPage + 1} / {Math.ceil(filteredChanges.length / pageSize)} 页</span><button disabled={!actualPage} onClick={() => setListPage(actualPage - 1)}><ArrowLeft />上一页</button><button disabled={(actualPage + 1) * pageSize >= filteredChanges.length} onClick={() => setListPage(actualPage + 1)}>下一页<ArrowRight /></button></div>}
  </section>;

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><img src="/domainatlas.svg" width="23" height="23" alt="" /><span>DomainAtlas</span></div><div className="project"><span>{data?.project.name ?? '本地项目'}</span><span className="divider">/</span><span className="muted">业务地图</span></div><div className="project-meta"><GitBranch /><code>{data?.project.branch ?? '—'}</code><span className="badge">本地项目</span></div></header>
    <div className="workspace"><aside className="sidebar"><nav aria-label="主导航">{([{ id: 'map', label: '业务地图', icon: Map }, { id: 'changes', label: '变更记录', icon: History }, { id: 'guide', label: '接入说明', icon: BookOpen }] as const).map(item => <button key={item.id} className={page === item.id ? 'active' : ''} aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><item.icon />{item.label}</button>)}</nav><div className="storage"><span>本地事实存储</span><code>.domainatlas/</code></div></aside>
    <main className="main">
      <div className="page-heading"><div><h1>{page === 'map' ? '业务地图' : page === 'changes' ? '变更记录' : '接入说明'}</h1><p>{page === 'map' ? '从业务能力追溯每一次变化' : page === 'changes' ? '每一次变化，都有来源可循' : '让每次 AI 开发，都留下可追溯的业务变化'}</p></div><div className="heading-actions">{page === 'map' && <label className="search"><Search /><input aria-label="搜索业务域或能力" placeholder="搜索业务域或能力" value={search} onChange={event => setSearch(event.target.value)} /></label>}<button className="icon-button" aria-label="刷新项目" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw className={loading ? 'spinning' : ''} /></button></div></div>
      {error ? <div role="alert" className="error-panel"><AlertCircle /><div><strong>项目数据读取失败</strong><p>{error}</p><button onClick={() => setRevision(value => value + 1)}>重新加载</button></div></div> : loading ? <div className="loading" role="status"><RefreshCw className="spinning" />正在读取项目事实与 Git 状态…</div> : data && <>
        {page !== 'guide' && <div className="metrics">{[{ label: '业务域', value: data.totals.domains }, { label: '业务能力', value: data.totals.capabilities }, { label: '变更记录', value: data.totals.changes, sub: '已提交 ' + data.totals.committed }, { label: '待提交', value: data.totals.pending }].map(item => <div key={item.label}><span>{item.label}</span><div><strong>{item.value}</strong>{item.sub && <small>{item.sub}</small>}</div></div>)}</div>}
        {!data.project.initialized && page !== 'guide' && <div className="info-banner">该项目尚未初始化 DomainAtlas。<button className="text-button" onClick={() => navigate('guide')}>查看接入说明 <ArrowRight /></button></div>}
        {page === 'map' && <section className="panel map-panel"><div className="panel-heading"><h2>业务结构</h2><div className="map-toolbar"><div className="segmented"><button aria-pressed={view === 'map'} className={view === 'map' ? 'active' : ''} onClick={() => setView('map')}><Map />地图</button><button aria-pressed={view === 'list'} className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}><List />列表</button></div><label className="select-wrap"><SlidersHorizontal /><select aria-label="置信度" value={confidence} onChange={event => setConfidence(event.target.value)}><option value="">置信度：全部</option><option value="high">高置信度</option><option value="medium">中置信度</option><option value="low">低置信度</option></select></label></div></div>
          <div className={'map-body ' + (view === 'list' ? 'list-view' : '')}>{groups.length ? <div className="domain-groups" style={{ zoom: view === 'map' ? zoom : 1 }}>{groups.map(group => <div className="domain-group" key={group.domain?.id ?? 'orphan'}><button className="domain-title" onClick={() => group.domain && setSelection({ kind: 'domain', id: group.domain.id })} disabled={!group.domain}>{group.domain?.name ?? '所属域缺失'}</button><div className="capabilities">{group.nodes.map(node => <button className={'capability-card ' + (capabilityId === node.id ? 'selected' : '')} key={node.id} onClick={() => openCapability(node)} aria-pressed={capabilityId === node.id}><strong>{node.name}</strong><span className="node-meta"><Confidence node={node} /><small>{relatedChanges(node.id).length} 条变更</small></span>{node.confidence === 'low' && <small className="low">{[...new Set(node.evidence.map(item => sourceName(item.source)))].join(' · ') || '来源未提供'}</small>}</button>)}{!group.nodes.length && <p className="muted">暂无能力</p>}</div></div>)}</div> : <Empty title={data.capabilities.length || data.domains.length ? '未找到匹配的业务结构' : '业务地图尚未形成'}>业务结构将随开发证据逐步积累。</Empty>}</div>
          <div className="map-footer"><div className="legend"><span><i />域包含能力</span><span className="low"><AlertCircle />低置信度需核对来源</span></div>{view === 'map' && <div className="zoom-controls"><button className="icon-button" aria-label="缩小地图" disabled={zoom <= .7} onClick={() => setZoom(value => Math.max(.7, +(value - .1).toFixed(1)))}><ZoomOut /></button><button className="icon-button" aria-label="放大地图" disabled={zoom >= 1.5} onClick={() => setZoom(value => Math.min(1.5, +(value + .1).toFixed(1)))}><ZoomIn /></button><button className="icon-button" aria-label="重置地图缩放" onClick={() => setZoom(1)}><Maximize /></button><span>{Math.round(zoom * 100)}%</span></div>}</div>
        </section>}
        {page === 'changes' && <div className="filters"><label className="search"><Search /><input aria-label="搜索变更记录" placeholder="搜索需求、人员、角色或记录 ID" value={recordSearch} onChange={event => setRecordSearch(event.target.value)} /></label><select aria-label="变更类型" value={kind} onChange={event => setKind(event.target.value)}><option value="">全部类型</option>{Object.entries(kindNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="提交状态" value={status} onChange={event => setStatus(event.target.value)}><option value="">全部 Git 状态</option><option value="pending">待提交</option><option value="committed">已提交</option></select><label>起始日期<input aria-label="起始日期" type="date" value={from} onChange={event => setFrom(event.target.value)} /></label><label>结束日期<input aria-label="结束日期" type="date" value={to} onChange={event => setTo(event.target.value)} /></label><button className="text-button" onClick={() => { setRecordSearch(''); setKind(''); setStatus(''); setFrom(''); setTo(''); setOnlyCapability(false); }}>重置筛选</button></div>}
        {page !== 'guide' && recordsPanel}
        {page === 'guide' && <article className="panel guide"><div className="guide-intro"><BookOpen /><h2>把开发过程，变成可追溯的业务事实</h2><p>Web UI 读取当前 Git 项目的事实文件。完成配置后，Codex 任务会通过生命周期钩子留下变更记录。</p></div><Section title="01 · 构建与初始化"><p>在 DomainAtlas 仓库中安装依赖并构建：</p><pre>pnpm install{'\n'}pnpm build{'\n'}pnpm domainatlas init</pre></Section><Section title="02 · 接入 Codex 生命周期"><p>本仓库提供 <code>.codex/hooks.json</code>，将 UserPromptSubmit / Stop 事件传给 CLI。在 Codex 中通过 <code>/hooks</code> 审阅并信任项目钩子。</p><p>接入其他仓库时，将钩子命令指向已构建的 DomainAtlas CLI 的绝对路径；事实始终写入目标项目。详见仓库 <code>docs/codex-integration.md</code>。</p></Section><Section title="03 · 打开本地工作台"><pre>pnpm ui{'\n'}# 自定义端口{'\n'}pnpm ui --port 4311</pre><p>在其他项目根目录运行 <code>node /绝对路径/DomainAtlas/dist/src/cli.js ui</code>，即可读取该项目。</p></Section><Section title="如何阅读记录"><p>“已提交”表示事实记录进入 Git 历史。“未采集”表示本条记录没有结构化测试结果。纠正、撤销通过引用保留原始历史。</p><p>业务域和能力名称来自结构分析或路径推断，可在详情中核对来源与置信度。</p></Section></article>}
        <footer className="workspace-footer"><span>事实来自当前项目 · 只读视图</span><span>DomainAtlas <span className="footer-dot">·</span> 本地优先</span></footer>
      </>}
    </main>
    {page !== 'guide' && selection && !error && !loading && <aside ref={detailRef} className="detail" aria-label="详情面板"><div className="detail-heading"><span>{selection.kind === 'change' ? '变更详情' : selection.kind === 'domain' ? '业务域详情' : '能力详情'}</span><button className="icon-button" aria-label="关闭详情" onClick={() => setSelection(null)}><X /></button></div>
      {selectedChange ? <><div className="detail-title"><h2>{recordTitle(selectedChange)}</h2><div className="badges"><span className="badge">{kindNames[selectedChange.kind]}</span><Status record={selectedChange} /></div><p>{date(selectedChange.recordedAt)} <span>· 来源 Codex</span></p></div>
      <Section title="原始需求"><p className="preserve">{selectedChange.request || '未提供'}</p></Section><Section title="变更摘要"><p className="preserve">{selectedChange.summary || '未提供'}</p></Section>
      <Section title="开发环境身份"><p className="preserve">{identityLabel(selectedChange.attribution?.developmentIdentity)}</p>{selectedChange.attribution?.developmentIdentity && <p className="muted">{selectedChange.attribution.developmentIdentity.capturePoint === 'turn-start' ? '任务开始时' : '录入时'}的 Git 配置 · {date(selectedChange.attribution.developmentIdentity.capturedAt)}</p>}</Section>
      <Section title="需求提出者"><Parties parties={selectedChange.attribution?.requestedBy} /></Section>
      <Section title="反馈方"><Parties parties={selectedChange.attribution?.feedbackBy} /></Section>
      <Section title="影响能力">{selectedChange.affectedCapabilityIds.length ? selectedChange.affectedCapabilityIds.map(id => { const node = data!.capabilities.find(item => item.id === id); return <button key={id} className="capability-link" disabled={!node} onClick={() => node && openCapability(node)}>{node ? domainName(node.domainId) + ' / ' + node.name : capabilityName(id)}</button>; }) : <p className="muted">暂无关联能力</p>}</Section>
      <Section title={'变更文件 · ' + selectedChange.changedFiles.length}>{!selectedChange.changedFiles.length && <p className="muted">未记录文件变化</p>}{!selectedChange.fileChanges && <p className="muted">该记录未保存文件版本</p>}<ul className="files">{selectedChange.changedFiles.map(file => { const transition = selectedChange.fileChanges?.find(item => item.path === file); return <li key={file}><div><FileCode2 /><code>{file}</code><span>{transition ? !transition.before ? '新增' : !transition.after ? '删除' : '修改' : '已记录'}</span></div>{transition && <details><summary>文件版本</summary><code>前：{transition.before ? transition.before.oid + ' / ' + transition.before.mode : '不存在'}{'\n'}后：{transition.after ? transition.after.oid + ' / ' + transition.after.mode : '不存在'}</code></details>}</li>; })}</ul></Section>
      <Section title="测试证据">{selectedChange.tests.length ? selectedChange.tests.map((test, index) => <div className="test-evidence" key={index}><span className={'badge ' + (test.status === 'passed' ? 'green' : test.status === 'failed' ? 'red' : '')}>{testNames[test.status]}</span><code>{test.command}</code>{test.summary && <p>{test.summary}</p>}</div>) : <><span className="badge"><Circle />未采集</span><p className="muted">本次任务没有结构化测试结果。</p></>}</Section>
      <Section title="能力来源">{selectedChange.affectedCapabilityIds.length ? selectedChange.affectedCapabilityIds.map(id => { const node = data!.capabilities.find(item => item.id === id); return node ? <div className="evidence-node" key={id}><strong>{node.name}</strong><Confidence node={node} />{node.evidence.map((item, index) => <details key={index}><summary>{sourceName(item.source)} · {confidenceNames[item.confidence]}置信度</summary><code>{item.reference}</code></details>)}</div> : <p key={id}>关联能力数据缺失：{id}</p>; }) : <p className="muted">暂无关联能力来源</p>}</Section>
      <Section title="提交信息"><Status record={selectedChange} />{selectedChange.lifecycle.state === 'committed' ? <><code className="sha">{selectedChange.lifecycle.commitSha}</code><p className="preserve">Git 作者：{identityLabel(selectedChange.lifecycle.author)}</p><p className="preserve">Git 提交者：{identityLabel(selectedChange.lifecycle.committer)}</p><p className="muted">事实记录首次进入 Git 历史的提交；不代表全部文件的实际编写者。</p></> : <p className="muted">记录尚未包含在 Git 提交中，作者与提交者待提交后读取。</p>}</Section>
      <Section title="任务来源"><p>Codex</p><code>{selectedChange.source.taskId ?? '未提供任务 ID'}</code></Section>
      {(selectedChange.supersedes || data!.changes.some(item => item.supersedes === selectedChange.id)) && <Section title="历史关联">{selectedChange.supersedes && <button className="text-button" onClick={() => { const previous = data!.changes.find(item => item.id === selectedChange.supersedes); if (previous) openChange(previous); else setNotice('引用的原始记录不存在'); }}><History />查看原记录</button>}{data!.changes.filter(item => item.supersedes === selectedChange.id).map(item => <button className="history-link" key={item.id} onClick={() => openChange(item)}>{kindNames[item.kind]}：{item.summary}</button>)}</Section>}
      <Section title={'记录证据 · ' + selectedChange.evidence.length}>{selectedChange.evidence.map((item, index) => <details key={index}><summary>{item.kind}</summary><p className="preserve">{item.value}</p></details>)}</Section>
      <div className="detail-actions"><button onClick={() => setRaw(true)}><FileCode2 />查看原始记录</button><button onClick={() => copy(selectedChange.id)}><Copy />复制记录 ID</button></div>
      </> : selectedNode ? <><div className="detail-title"><h2>{selectedNode.name}</h2><Confidence node={selectedNode} /></div>{'domainId' in selectedNode && <Section title="所属业务域"><p>{domainName(selectedNode.domainId as string)}</p></Section>}<Section title="来源证据">{selectedNode.evidence.length ? selectedNode.evidence.map((item, index) => <div className="evidence-node" key={index}><p>{sourceName(item.source)} · {confidenceNames[item.confidence]}置信度</p><code>{item.reference}</code></div>) : <p className="muted">未提供来源证据</p>}</Section><Section title={selection.kind === 'domain' ? '业务能力' : '关联变更'}>{selection.kind === 'domain' ? data!.capabilities.filter(item => item.domainId === selectedNode.id).map(node => <button className="capability-link" key={node.id} onClick={() => openCapability(node)}>{node.name}</button>) : relatedChanges(selectedNode.id).length ? relatedChanges(selectedNode.id).map(record => <button className="history-link" key={record.id} onClick={() => openChange(record)}><strong>{record.summary || record.request}</strong><span>{date(record.recordedAt)}</span><Status record={record} /></button>) : <p className="muted">暂无关联变更</p>}</Section></> : <Empty title="记录已不可用">请刷新项目或重新选择。</Empty>}
    </aside>}
    </div>{raw && selectedChange && <RawRecord record={selectedChange} close={() => setRaw(false)} />}{notice && <div className="toast" role="status"><Check />{notice}</div>}
  </div>;
}
