import { SpotlightCard } from './VisualEffects';
import { serviceMessage, t, LanguageSwitcher } from './i18n';
import { ThemeSwitcher } from './theme';
import { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, FolderTree, RefreshCw, Search } from 'lucide-react';
import type { ProjectDirectory } from '../../../src/storage/project-registry';

export function ProjectList({ onOpen }: { onOpen: (id: string) => void }) {
  const [directory, setDirectory] = useState<ProjectDirectory | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    fetch('/api/projects', { signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "项目列表加载失败");
      if (!controller.signal.aborted) setDirectory(body);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "无法连接本地服务"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  const query = search.trim().toLowerCase();
  const projects = directory?.projects.filter(project => !query || (project.name + ' ' + project.root).toLowerCase().includes(query)) ?? [];
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><img src="/domainatlas.svg" width="23" height="23" alt="" /><span>DomainAtlas</span></div><span className="muted">{t("项目工作台")}</span><span className="project-meta badge">{t("本地优先")}</span><ThemeSwitcher /><LanguageSwitcher /></header>
    <main className="project-workspace">
      <div className="page-heading"><div><h1>{t("全部项目")}</h1><p>{t("集中查看已初始化项目的业务图与历史变更")}</p></div><div className="heading-actions"><label className="search"><Search /><input aria-label={t("搜索项目")} placeholder={t("搜索项目名称或路径")} value={search} onChange={event => setSearch(event.target.value)} /></label><button className="icon-button" aria-label={t("刷新项目列表")} disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw className={loading ? 'spinning' : ''} /></button></div></div>
      {error ? <div role="alert" className="error-panel"><AlertCircle /><div><strong>{t("项目列表读取失败")}</strong><p>{serviceMessage(error)}</p><button onClick={() => setRevision(value => value + 1)}>{t("重新加载")}</button></div></div> : loading ? <div className="loading" role="status">{t("正在读取项目列表…")}</div> : <>
        <p className="muted">{t('{count} 个已登记项目 · 选择项目进入工作台', { count: directory?.projects.length ?? 0 })}</p>
        {!!directory?.warnings.length && <div className="info-banner" role="status">{directory.warnings.map(serviceMessage).join(' · ')}</div>}
        {projects.length ? <div className="project-grid">{projects.map(project => <SpotlightCard className="panel project-card" key={project.id}>
          <div className="project-card-heading"><FolderTree /><h2>{project.name}</h2><span className={'badge ' + (project.status === 'available' ? 'green' : 'amber')}>{project.status === 'available' ? t("可访问") : t("不可用")}</span></div>
          <code className="project-path">{project.root}</code>
          {project.message && <p className="project-problem">{serviceMessage(project.message)}</p>}
          <button disabled={project.status !== 'available'} onClick={() => onOpen(project.id)} aria-label={t("进入项目") + project.name}>{t("查看业务图与历史变更")}<ArrowRight /></button>
        </SpotlightCard>)}</div> : <section className="panel empty"><FolderTree /><strong>{query ? t("没有匹配的项目") : t("还没有登记的项目")}</strong><p>{query ? t("尝试其他项目名称或路径。") : t("在项目里执行 domainatlas init 后，刷新此页面即可看到项目。")}</p></section>}
        <section className="panel project-help"><h2>{t("已有项目没有出现在这里？")}</h2><p>{t("旧版初始化的项目需要登记一次。在项目里重新执行")}<code>domainatlas init</code>{t("，或启动时指定项目所在目录批量发现：")}</p><pre>{t("domainatlas ui --scan /你的项目父目录")}</pre><p>{t("登记完成后，在任意目录执行")}<code>domainatlas ui</code> {t("即可查看全部项目。项目事实仍保存在各自仓库中。")}</p></section>
      </>}
    </main>
  </div>;
}
