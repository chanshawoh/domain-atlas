import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { DomainGroup, NumberTicker } from './VisualEffects';
import { serviceMessage, t, useLocale, getLocale, LanguageSwitcher } from './i18n';
import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, Circle, Copy, FileCode2, FolderTree, GitBranch, History, List, Map, Maximize, RefreshCw, Search, SlidersHorizontal, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { BusinessCapability, BusinessDomain, RequirementParty } from '../../../src/core/model';
import type { AtlasSnapshot, ProjectedChange } from '../../../src/web/contracts';

import { ProjectList } from './ProjectList';

type Page = 'map' | 'changes' | 'guide';
type Selection = { kind: 'change' | 'capability' | 'domain'; id: string } | null;
const confidenceNames = { low: '低', medium: '中', high: '高' };
const kindNames = { change: '变更', correction: '纠正', revert: '撤销' };
const testNames = { passed: '通过', failed: '失败', 'not-run': '未运行' };
const date = (value: string) => new Date(value).toLocaleString(getLocale() === 'zh' ? 'zh-CN' : 'en-US', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const sourceName = (source: string) => source === 'codebase-memory-mcp' ? t("图谱推导") : source === 'changed-file-path' ? t("路径推断") : source === 'baseline-file-path' ? t("基线 · 路径推断") : source === 'baseline-code-graph' ? t("基线 · 图谱推导") : source === 'baseline-ai-analysis' ? t("基线 · AI 业务分析") : source;
// Keep the complete evidence below; use its first nonempty line as a compact reading title.
const recordTitle = (record: ProjectedChange) => ((record.summary || record.request).split(/\r?\n/).find(line => line.trim()) || t("无摘要记录")).replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*`#]/g, '').slice(0, 100);

function Status({ record }: { record: ProjectedChange }) {
  const committed = record.lifecycle.state === 'committed';
  return <span className={'badge ' + (committed ? 'green' : 'amber')}>{committed ? <CheckCircle2 /> : <Circle />}{committed ? t("已提交") : t("待提交")}</span>;
}
function Confidence({ node }: { node: Pick<BusinessDomain, 'confidence'> }) {
  return <span className={'confidence ' + node.confidence}>{node.confidence === 'low' && <AlertCircle />}{t(confidenceNames[node.confidence] + '置信度')}</span>;
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="detail-section"><h3>{title}</h3>{children}</section>;
}
function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><FolderTree /><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}
function Parties({ parties }: { parties: RequirementParty[] | undefined }) {
  const kinds = { alias: t("称呼"), role: t("角色"), team: t("团队") };
  return parties?.length ? <>{parties.map((party, index) => <div className="evidence-node" key={index}><strong>{party.name}</strong><span className="badge">{kinds[party.kind]}</span><details><summary>{t("原话依据 · 中置信度")}</summary><p className="preserve">{party.evidence}</p></details></div>)}</> : <p className="muted">{parties ? t("未识别到明确来源") : t("未采集")}</p>;
}
const identityLabel = (identity: { name?: string; email?: string } | null | undefined) => identity ? [identity.name, identity.email && `<${identity.email}>`].filter(Boolean).join(' ') || t("未采集") : t("未采集");
function RawRecord({ record, close }: { record: ProjectedChange; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { lifecycle: _lifecycle, ...raw } = record;
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} onCancel={close} aria-labelledby="raw-title"><div className="panel-heading"><h2 id="raw-title">{t("原始记录")}</h2><button className="icon-button" autoFocus onClick={close} aria-label={t("关闭原始记录")}><X /></button></div><pre>{JSON.stringify(raw, null, 2)}</pre></dialog>;
}

function ProjectView({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const reducedMotion = useReducedMotion();
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
    fetch('/api/projects/' + encodeURIComponent(projectId) + '/atlas', { signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "项目加载失败");
      return body as AtlasSnapshot;
    }).then(snapshot => {
      if (controller.signal.aborted) return;
      setData(snapshot);
      if (!initialized.current) {
        initialized.current = true;
        const first = snapshot.changes[0];
        if (first && window.matchMedia('(min-width: 761px)').matches) { setSelection({ kind: 'change', id: first.id }); setCapabilityId(first.affectedCapabilityIds[0] || ''); }
      }
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "无法连接本地服务"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision, projectId]);
  useEffect(() => { setListPage(0); }, [recordSearch, kind, status, from, to, onlyCapability, capabilityId]);
  useEffect(() => { detailRef.current?.scrollTo(0, 0); }, [selection?.id]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 3500); return () => clearTimeout(timer); }, [notice]);

  const selectedCapability = data?.capabilities.find(item => item.id === capabilityId);
  const selectedChange = selection?.kind === 'change' ? data?.changes.find(item => item.id === selection.id) : undefined;
  const selectedNode = selection?.kind === 'capability' ? data?.capabilities.find(item => item.id === selection.id) : selection?.kind === 'domain' ? data?.domains.find(item => item.id === selection.id) : undefined;
  const domainName = (id: string) => data?.domains.find(item => item.id === id)?.name ?? t("所属域缺失");
  const capabilityName = (id: string) => data?.capabilities.find(item => item.id === id)?.name ?? id + t("（能力缺失）");
  const relatedChanges = (id: string) => data?.changes.filter(item => item.affectedCapabilityIds.includes(id)) ?? [];
  function openChange(record: ProjectedChange) {
    setSelection({ kind: 'change', id: record.id });
    setCapabilityId(current => record.affectedCapabilityIds.includes(current) ? current : record.affectedCapabilityIds[0] || '');
    setRaw(false);
  }
  function openCapability(node: BusinessCapability) { setCapabilityId(node.id); setSelection({ kind: 'capability', id: node.id }); }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setNotice("记录 ID 已复制"); }
    catch { setNotice("复制失败，请从原始记录中手动复制"); }
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
    <div className="panel-heading"><div><h2>{page === 'map' ? t("最近变更") : t("全部变更")}</h2><span className="muted">{page === 'map' ? t('显示最近 {count} 条', { count: visibleChanges.length }) : t('共 {count} 条', { count: filteredChanges.length })}</span></div>{page === 'map' && <button className="text-button" onClick={() => navigate('changes')}>{t("查看全部")}<ArrowRight /></button>}</div>
    {selectedCapability && <div className="records-option"><label><input type="checkbox" checked={onlyCapability} onChange={event => setOnlyCapability(event.target.checked)} />{t("仅看")}{selectedCapability.name}</label><button className="text-button" onClick={() => { setOnlyCapability(false); setCapabilityId(''); }}>{t("清除能力选择")}</button></div>}
    <div className="record-list">{visibleChanges.map(record => <button key={record.id} className={'record-row ' + (selection?.id === record.id ? 'selected' : '')} onClick={() => openChange(record)}>
      <time>{date(record.recordedAt)}</time><span className="record-summary"><strong>{recordTitle(record)}</strong><span className="record-meta">{record.affectedCapabilityIds.length ? record.affectedCapabilityIds.map(id => <span key={id} className="badge capability-tag">{capabilityName(id)}</span>) : <span>{t("暂无关联能力")}</span>}<span>{t('{count} 个文件', { count: record.changedFiles.length })}</span>{record.supersedes && <span>{t("· 关联历史记录")}</span>}</span></span><span className="badge">{t(kindNames[record.kind])}</span><Status record={record} />
    </button>)}</div>
    {!visibleChanges.length && <Empty title={data?.changes.length ? t("没有符合条件的变更") : t("尚无变更记录")}>{data?.changes.length ? t("调整筛选条件，或清除能力选择。") : t("完成一次接入后的开发任务，即可在这里追溯变化。")}</Empty>}
    {page === 'changes' && filteredChanges.length > pageSize && <div className="pagination"><span>{t('第 {page} / {total} 页', { page: actualPage + 1, total: Math.ceil(filteredChanges.length / pageSize) })}</span><button disabled={!actualPage} onClick={() => setListPage(actualPage - 1)}><ArrowLeft />{t("上一页")}</button><button disabled={(actualPage + 1) * pageSize >= filteredChanges.length} onClick={() => setListPage(actualPage + 1)}>{t("下一页")}<ArrowRight /></button></div>}
  </section>;

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><img src="/domainatlas.svg" width="23" height="23" alt="" /><span>DomainAtlas</span></div><div className="project"><span>{data?.project.name ?? t("本地项目")}</span><span className="divider">/</span><span className="muted">{t("业务地图")}</span></div><div className="project-meta"><GitBranch /><code>{data?.project.branch ?? '—'}</code><span className="badge">{t("本地项目")}</span></div><LanguageSwitcher /></header>
    <div className="workspace"><aside className="sidebar"><nav aria-label={t("主导航")}><button onClick={onBack}><ArrowLeft />{t("全部项目")}</button>{([{ id: 'map', label: t("业务地图"), icon: Map }, { id: 'changes', label: t("变更记录"), icon: History }, { id: 'guide', label: t("接入说明"), icon: BookOpen }] as const).map(item => <button key={item.id} className={page === item.id ? 'active' : ''} aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><item.icon />{item.label}</button>)}</nav><div className="storage"><span>{t("本地事实存储")}</span><code>.domainatlas/</code></div></aside>
    <main className="main">
      <div className="page-heading"><div><h1>{page === 'map' ? t("业务地图") : page === 'changes' ? t("变更记录") : t("接入说明")}</h1><p>{page === 'map' ? t("从业务能力追溯每一次变化") : page === 'changes' ? t("每一次变化，都有来源可循") : t("让每次 AI 开发，都留下可追溯的业务变化")}</p></div><div className="heading-actions">{page === 'map' && <label className="search"><Search /><input aria-label={t("搜索业务域或能力")} placeholder={t("搜索业务域或能力")} value={search} onChange={event => setSearch(event.target.value)} /></label>}<button className="icon-button" aria-label={t("刷新项目")} disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw className={loading ? 'spinning' : ''} /></button></div></div>
      {error ? <div role="alert" className="error-panel"><AlertCircle /><div><strong>{t("项目数据读取失败")}</strong><p>{serviceMessage(error)}</p><button onClick={() => setRevision(value => value + 1)}>{t("重新加载")}</button></div></div> : loading ? <div className="loading" role="status"><RefreshCw className="spinning" />{t("正在读取项目事实与 Git 状态…")}</div> : data && <>
        {page !== 'guide' && <div className="metrics">{[{ label: t("业务域"), value: data.totals.domains }, { label: t("业务能力"), value: data.totals.capabilities }, { label: t("变更记录"), value: data.totals.changes, sub: t('已提交 {count}', { count: data.totals.committed }) }, { label: t("待提交"), value: data.totals.pending }].map(item => <div key={item.label}><span>{item.label}</span><div><NumberTicker value={item.value} />{item.sub && <small>{item.sub}</small>}</div></div>)}</div>}
        {!data.project.initialized && page !== 'guide' && <div className="info-banner">{t("该项目尚未初始化 DomainAtlas。")}<button className="text-button" onClick={() => navigate('guide')}>{t("查看接入说明")}<ArrowRight /></button></div>}
        {page === 'map' && data.baseline && <div className="info-banner"><span>{t("业务基线 ·")}{date(data.baseline.recordedAt)} {t("· 选取")}{data.baseline.coverage.selectedFiles} {t("个证据文件")}{data.baseline.coverage.limited ? t("· 范围有限") : ''}{t("。反映构建时的业务结构，后续变更单独记录。")}</span></div>}
        {page === 'map' && <section className="panel map-panel"><div className="panel-heading"><h2>{t("业务结构")}</h2><div className="map-toolbar"><div className="segmented"><button aria-pressed={view === 'map'} className={view === 'map' ? 'active' : ''} onClick={() => setView('map')}><Map />{t("地图")}</button><button aria-pressed={view === 'list'} className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}><List />{t("列表")}</button></div><label className="select-wrap"><SlidersHorizontal /><select aria-label={t("置信度")} value={confidence} onChange={event => setConfidence(event.target.value)}><option value="">{t("置信度：全部")}</option><option value="high">{t("高置信度")}</option><option value="medium">{t("中置信度")}</option><option value="low">{t("低置信度")}</option></select></label></div></div>
          <div className={'map-body ' + (view === 'list' ? 'list-view' : '')}>{groups.length ? <div className="domain-groups" style={{ zoom: view === 'map' ? zoom : 1, '--map-font-floor': `${13 / (view === 'map' ? Math.min(zoom, 1) : 1)}px` } as CSSProperties}>{groups.map(group => <DomainGroup key={group.domain?.id ?? 'orphan'} activeId={capabilityId + ":" + view + ":" + zoom}><button className="domain-title" onClick={() => group.domain && setSelection({ kind: 'domain', id: group.domain.id })} disabled={!group.domain}>{group.domain?.name ?? t("所属域缺失")}</button><div className="capabilities">{group.nodes.map(node => <button className={'capability-card ' + (capabilityId === node.id ? 'selected' : '')} key={node.id} onClick={() => openCapability(node)} aria-pressed={capabilityId === node.id}><strong>{node.name}</strong><span className="node-meta"><Confidence node={node} /><small>{t('{count} 条变更', { count: relatedChanges(node.id).length })}</small></span>{node.confidence === 'low' && <small className="low">{[...new Set(node.evidence.map(item => sourceName(item.source)))].join(' · ') || t("来源未提供")}</small>}</button>)}{!group.nodes.length && <p className="muted">{t("暂无能力")}</p>}</div></DomainGroup>)}</div> : <Empty title={data.capabilities.length || data.domains.length ? t("未找到匹配的业务结构") : t("业务地图尚未形成")}>{t("在项目根目录执行 domainatlas build 构建已有业务图，或让 AI 使用 DomainAtlas skill 分析构建。后续开发会持续补充业务证据。")}</Empty>}</div>
          <div className="map-footer"><div className="legend"><span><i />{t("域包含能力")}</span><span className="low"><AlertCircle />{t("低置信度需核对来源")}</span></div>{view === 'map' && <div className="zoom-controls"><button className="icon-button" aria-label={t("缩小地图")} disabled={zoom <= .7} onClick={() => setZoom(value => Math.max(.7, +(value - .1).toFixed(1)))}><ZoomOut /></button><button className="icon-button" aria-label={t("放大地图")} disabled={zoom >= 1.5} onClick={() => setZoom(value => Math.min(1.5, +(value + .1).toFixed(1)))}><ZoomIn /></button><button className="icon-button" aria-label={t("重置地图缩放")} onClick={() => setZoom(1)}><Maximize /></button><span>{Math.round(zoom * 100)}%</span></div>}</div>
        </section>}
        {page === 'changes' && <div className="filters"><label className="search"><Search /><input aria-label={t("搜索变更记录")} placeholder={t("搜索需求、人员、角色或记录 ID")} value={recordSearch} onChange={event => setRecordSearch(event.target.value)} /></label><select aria-label={t("变更类型")} value={kind} onChange={event => setKind(event.target.value)}><option value="">{t("全部类型")}</option>{Object.entries(kindNames).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select><select aria-label={t("提交状态")} value={status} onChange={event => setStatus(event.target.value)}><option value="">{t("全部 Git 状态")}</option><option value="pending">{t("待提交")}</option><option value="committed">{t("已提交")}</option></select><label>{t("起始日期")}<input aria-label={t("起始日期")} type="date" value={from} onChange={event => setFrom(event.target.value)} /></label><label>{t("结束日期")}<input aria-label={t("结束日期")} type="date" value={to} onChange={event => setTo(event.target.value)} /></label><button className="text-button" onClick={() => { setRecordSearch(''); setKind(''); setStatus(''); setFrom(''); setTo(''); setOnlyCapability(false); }}>{t("重置筛选")}</button></div>}
        {page !== 'guide' && recordsPanel}
        {page === 'guide' && <article className="panel guide"><div className="guide-intro"><BookOpen /><h2>{t("把开发过程，变成可追溯的业务事实")}</h2><p>{t("Web UI 在一个端口集中展示已登记项目，当前页面读取所选项目的事实文件。完成配置后，Codex 任务会通过生命周期钩子留下变更记录。")}</p></div><Section title={t("01 · 初始化与业务基线")}><p>{t("全局安装 DomainAtlas 后，在目标 Git 项目根目录执行：")}</p><pre>domainatlas init{'\n'}domainatlas build{'\n'}domainatlas ui</pre><p>{t("build 从已跟踪源码构建结构基线。也可让 AI 使用 DomainAtlas skill 分析业务语义，再通过 build --input 导入。已有 Git 提交不会被自动回放为业务历史。")}</p></Section><Section title={t("02 · 接入 Codex 生命周期")}><p>{t("本仓库提供")}<code>.codex/hooks.json</code>{t("，将 UserPromptSubmit / Stop 事件传给 CLI。在 Codex 中通过")}<code>/hooks</code> {t("审阅并信任项目钩子。")}</p><p>{t("接入其他仓库时，将钩子命令指向已构建的 DomainAtlas CLI 的绝对路径；事实始终写入目标项目。")}</p></Section><Section title={t("03 · 打开本地工作台")}><pre>pnpm ui{'\n'}{t("# 自定义端口")}{'\n'}pnpm ui --port 4311</pre><p>{t("在任意目录运行")}<code>domainatlas ui</code>{t("，进入全部项目列表。旧版项目可通过")}<code>{t("domainatlas ui --scan /项目父目录")}</code> {t("批量登记。")}</p></Section><Section title={t("如何阅读记录")}><p>{t("“已提交”表示事实记录进入 Git 历史。“未采集”表示本条记录没有结构化测试结果。纠正、撤销通过引用保留原始历史。")}</p><p>{t("业务域和能力名称来自结构分析或路径推断，可在详情中核对来源与置信度。")}</p></Section></article>}
        <footer className="workspace-footer"><span>{t("事实来自当前项目 · 只读视图")}</span><span>DomainAtlas <span className="footer-dot">·</span> {t("本地优先")}</span></footer>
      </>}
    </main>
    <AnimatePresence>{page !== 'guide' && selection && !error && !loading && <motion.aside initial={{ opacity: reducedMotion ? 1 : 0, x: reducedMotion ? 0 : 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: reducedMotion ? 0 : 16 }} transition={{ duration: reducedMotion ? 0 : .18 }} ref={detailRef} className="detail" aria-label={t("详情面板")}><div className="detail-heading"><span>{selection.kind === 'change' ? t("变更详情") : selection.kind === 'domain' ? t("业务域详情") : t("能力详情")}</span><button className="icon-button" aria-label={t("关闭详情")} onClick={() => setSelection(null)}><X /></button></div>
      {selectedChange ? <><div className="detail-title"><h2>{recordTitle(selectedChange)}</h2><div className="badges"><span className="badge">{t(kindNames[selectedChange.kind])}</span><Status record={selectedChange} /></div><p>{date(selectedChange.recordedAt)} <span>{t("· 来源 Codex")}</span></p></div>
      <Section title={t("原始需求")}><p className="preserve">{selectedChange.request || t("未提供")}</p></Section><Section title={t("变更摘要")}><p className="preserve">{selectedChange.summary || t("未提供")}</p></Section>
      <Section title={t("开发环境身份")}><p className="preserve">{identityLabel(selectedChange.attribution?.developmentIdentity)}</p>{selectedChange.attribution?.developmentIdentity && <p className="muted">{selectedChange.attribution.developmentIdentity.capturePoint === 'turn-start' ? t("任务开始时") : t("录入时")}{t("的 Git 配置 ·")}{date(selectedChange.attribution.developmentIdentity.capturedAt)}</p>}</Section>
      <Section title={t("需求提出者")}><Parties parties={selectedChange.attribution?.requestedBy} /></Section>
      <Section title={t("反馈方")}><Parties parties={selectedChange.attribution?.feedbackBy} /></Section>
      <Section title={t("影响能力")}>{selectedChange.affectedCapabilityIds.length ? selectedChange.affectedCapabilityIds.map(id => { const node = data!.capabilities.find(item => item.id === id); return <button key={id} className="capability-link" disabled={!node} onClick={() => node && openCapability(node)}>{node ? domainName(node.domainId) + ' / ' + node.name : capabilityName(id)}</button>; }) : <p className="muted">{t("暂无关联能力")}</p>}</Section>
      <Section title={t("变更文件 ·") + selectedChange.changedFiles.length}>{!selectedChange.changedFiles.length && <p className="muted">{t("未记录文件变化")}</p>}{!selectedChange.fileChanges && <p className="muted">{t("该记录未保存文件版本")}</p>}<ul className="files">{selectedChange.changedFiles.map(file => { const transition = selectedChange.fileChanges?.find(item => item.path === file); return <li key={file}><div><FileCode2 /><code>{file}</code><span className={"badge file-status " + (transition ? !transition.before ? "added" : !transition.after ? "deleted" : "modified" : "")}>{transition ? !transition.before ? t("新增") : !transition.after ? t("删除") : t("修改") : t("已记录")}</span></div>{transition && <details><summary>{t("文件版本")}</summary><code>{t("前：")}{transition.before ? transition.before.oid + ' / ' + transition.before.mode : t("不存在")}{'\n'}{t("后：")}{transition.after ? transition.after.oid + ' / ' + transition.after.mode : t("不存在")}</code></details>}</li>; })}</ul></Section>
      <Section title={t("测试证据")}>{selectedChange.tests.length ? selectedChange.tests.map((test, index) => <div className="test-evidence" key={index}><span className={'badge ' + (test.status === 'passed' ? 'green' : test.status === 'failed' ? 'red' : '')}>{t(testNames[test.status])}</span><code>{test.command}</code>{test.summary && <p>{test.summary}</p>}</div>) : <><span className="badge"><Circle />{t("未采集")}</span><p className="muted">{t("本次任务没有结构化测试结果。")}</p></>}</Section>
      <Section title={t("能力来源")}>{selectedChange.affectedCapabilityIds.length ? selectedChange.affectedCapabilityIds.map(id => { const node = data!.capabilities.find(item => item.id === id); return node ? <div className="evidence-node" key={id}><strong>{node.name}</strong><Confidence node={node} />{node.evidence.map((item, index) => <details key={index}><summary>{sourceName(item.source)} · <Confidence node={item} /></summary><code>{item.reference}</code></details>)}</div> : <p key={id}>{t("关联能力数据缺失：")}{id}</p>; }) : <p className="muted">{t("暂无关联能力来源")}</p>}</Section>
      <Section title={t("提交信息")}><Status record={selectedChange} />{selectedChange.lifecycle.state === 'committed' ? <><code className="sha">{selectedChange.lifecycle.commitSha}</code><p className="preserve">{t("Git 作者：")}{identityLabel(selectedChange.lifecycle.author)}</p><p className="preserve">{t("Git 提交者：")}{identityLabel(selectedChange.lifecycle.committer)}</p><p className="muted">{t("事实记录首次进入 Git 历史的提交；不代表全部文件的实际编写者。")}</p></> : <p className="muted">{t("记录尚未包含在 Git 提交中，作者与提交者待提交后读取。")}</p>}</Section>
      <Section title={t("任务来源")}><p>Codex</p><code>{selectedChange.source.taskId ?? t("未提供任务 ID")}</code></Section>
      {(selectedChange.supersedes || data!.changes.some(item => item.supersedes === selectedChange.id)) && <Section title={t("历史关联")}>{selectedChange.supersedes && <button className="text-button" onClick={() => { const previous = data!.changes.find(item => item.id === selectedChange.supersedes); if (previous) openChange(previous); else setNotice("引用的原始记录不存在"); }}><History />{t("查看原记录")}</button>}{data!.changes.filter(item => item.supersedes === selectedChange.id).map(item => <button className="history-link" key={item.id} onClick={() => openChange(item)}>{t(kindNames[item.kind])}：{item.summary}</button>)}</Section>}
      <Section title={t("记录证据 ·") + selectedChange.evidence.length}>{selectedChange.evidence.map((item, index) => <details key={index}><summary>{item.kind}</summary><p className="preserve">{item.value}</p></details>)}</Section>
      <div className="detail-actions"><button onClick={() => setRaw(true)}><FileCode2 />{t("查看原始记录")}</button><button onClick={() => copy(selectedChange.id)}><Copy />{t("复制记录 ID")}</button></div>
      </> : selectedNode ? <><div className="detail-title"><h2>{selectedNode.name}</h2><Confidence node={selectedNode} /></div>{'domainId' in selectedNode && <Section title={t("所属业务域")}><p>{domainName(selectedNode.domainId as string)}</p></Section>}<Section title={t("来源证据")}>{selectedNode.evidence.length ? selectedNode.evidence.map((item, index) => <div className="evidence-node" key={index}><p>{sourceName(item.source)} · <Confidence node={item} /></p><code>{item.reference}</code></div>) : <p className="muted">{t("未提供来源证据")}</p>}</Section><Section title={selection.kind === 'domain' ? t("业务能力") : t("关联变更")}>{selection.kind === 'domain' ? data!.capabilities.filter(item => item.domainId === selectedNode.id).map(node => <button className="capability-link" key={node.id} onClick={() => openCapability(node)}>{node.name}</button>) : relatedChanges(selectedNode.id).length ? relatedChanges(selectedNode.id).map(record => <button className="history-link" key={record.id} onClick={() => openChange(record)}><strong>{record.summary || record.request}</strong><span>{date(record.recordedAt)}</span><Status record={record} /></button>) : <p className="muted">{t("暂无关联变更")}</p>}</Section></> : <Empty title={t("记录已不可用")}>{t("请刷新项目或重新选择。")}</Empty>}
    </motion.aside>}</AnimatePresence>
    </div>{raw && selectedChange && <RawRecord record={selectedChange} close={() => setRaw(false)} />}{notice && <div className="toast" role="status"><Check />{t(notice)}</div>}
  </div>;
}

const selectedProject = () => new URLSearchParams(window.location.hash.slice(1)).get('project') ?? '';

export default function App() {
  useLocale();
  const [projectId, setProjectId] = useState(selectedProject);
  useEffect(() => {
    const update = () => setProjectId(selectedProject());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const open = (id: string) => { window.location.hash = id ? new URLSearchParams({ project: id }).toString() : ''; };
  return projectId ? <ProjectView key={projectId} projectId={projectId} onBack={() => open('')} /> : <ProjectList onOpen={open} />;
}
