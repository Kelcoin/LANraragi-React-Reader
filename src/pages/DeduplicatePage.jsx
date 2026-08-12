import React, { useCallback, useMemo, useState } from 'react';
import ArchiveCard from '../components/ArchiveCard';
import ConfirmDialog from '../components/ConfirmDialog';
import EhFavoriteDeleteSwitch from '../components/EhFavoriteDeleteSwitch';
import DedupeArchiveContextMenu from '../components/DedupeArchiveContextMenu';
import ArchiveThumbnailDialog from '../components/ArchiveThumbnailDialog';
import DatePicker from '../components/DatePicker';
import ExecutionProgressPanel from '../components/ExecutionProgressPanel';
import ArchiveDeletionFailureDialog from '../components/ArchiveDeletionFailureDialog';
import { ToolbarGlyph } from '../components/AppGlyphs';
import { lrrApi, waitForMinionJob } from '../lib/api';
import { rememberArchiveMetadata } from '../lib/archiveMetadataCache';
import {
  buildDuplicateGroups,
  createDedupeSavedResultPayload,
  createCoverSignature,
  DEDUPE_DEFAULT_START_DATE,
  filterArchivesByDateRange,
  filterDuplicateGroupsForSavedState,
  findDuplicatePairsAsync,
  getDedupeSmartSelectionSignals,
  getDuplicateSelectionDisabledIds,
  getTodayDateString,
  groupDuplicatePairsByChain,
  normalizeDedupeDateRange,
  normalizeDuplicateSelection,
  selectDuplicateDeletionIds,
  toPairKey,
} from '../lib/deduplicate';
import { getEhFavoriteDeleteSync } from '../lib/ehFavoriteSync';
import { deleteArchiveWithFavoriteSync } from '../lib/archiveDeletion';
import { getNonDuplicatePairKeys, markNonDuplicatePairs } from '../lib/worker-kv';
import { ARCHIVE_PROGRESS_VISIBILITY, readArchiveProgressVisibility, shouldShowArchiveProgress } from '../lib/archiveProgress';
import { scopedStorageKey } from '../lib/configScope';
import { getArchiveSearchTotal } from '../lib/archiveSearch';
import { hasValidWorkerConfig } from '../lib/worker-config';
import { useToast } from '../components/Toast';

const THUMBNAIL_CONCURRENCY = 4;
const DEDUPE_SAVED_RESULT_KEY = 'lrr_dedupe_saved_result_v1';

function archiveId(archive) {
  return String(archive?.arcid || archive?.id || '');
}

function formatBytes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = n;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString() : '0';
}

function pairKeysForGroup(group) {
  const ids = group.map(archiveId).filter(Boolean);
  const pairs = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      pairs.push(toPairKey(ids[i], ids[j]));
    }
  }
  return pairs;
}

function groupKey(group) {
  return group.map(archiveId).filter(Boolean).sort().join('|');
}

function groupIds(group) {
  return group.map(archiveId).filter(Boolean);
}

function groupsToIdGroups(groups) {
  return groups.map((group) => groupIds(group)).filter((ids) => ids.length > 1);
}

function filterGroupsByProcessedState(groups, deletedIds, nonDuplicatePairKeys) {
  const keepKeys = new Set(filterDuplicateGroupsForSavedState(
    groupsToIdGroups(groups),
    deletedIds,
    nonDuplicatePairKeys,
  ).map((ids) => ids.sort().join('|')));
  return groups.filter((group) => keepKeys.has(groupKey(group)));
}

function hasSavedDedupeResult() {
  try {
    return !!localStorage.getItem(scopedStorageKey(DEDUPE_SAVED_RESULT_KEY));
  } catch {
    return false;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadDeduplicatorThumbnailBlob(id, { delayMs = 25 } = {}) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    if (attempt > 1) await delay(delayMs * attempt);
    const thumb = await lrrApi.getArchiveThumbnail(id);
    if (thumb?.blob) return thumb.blob;
    if (thumb?.status === 202 && thumb.job) {
      await waitForMinionJob(thumb.job, { timeoutMs: 2 * 60 * 1000 });
      continue;
    }
  }
  return null;
}

async function mapWithConcurrency(items, limit, task, onProgress) {
  const results = new Array(items.length);
  let index = 0;
  let done = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      try {
        results[current] = await task(items[current], current);
      } catch {
        results[current] = null;
      } finally {
        done += 1;
        onProgress?.(done, items.length);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function ProgressPanel({ progress, running }) {
  if (!progress) return null;
  const total = Number(progress.total);
  const current = Number(progress.current);
  const hasTotal = Number.isFinite(total) && total > 0;
  const percent = hasTotal ? Math.max(0, Math.min(100, current / total * 100)) : (running ? 42 : 100);
  const showPercent = hasTotal && progress.label !== '检测失败';
  const statusText = progress.label === '检测失败' ? '失败' : (running ? '处理中' : '已完成');
  return (
    <div className="glass-panel workbench-section dedupe-progress-section" style={{ padding: '18px', marginBottom: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '18px', alignItems: 'flex-start', marginBottom: '14px', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 850, fontSize: '16px', lineHeight: 1.35 }}>{progress.label}</div>
          {progress.detail && (
            <div style={{ marginTop: '5px', color: 'var(--text-sub)', fontSize: '13px', lineHeight: 1.55 }}>
              {progress.detail}
            </div>
          )}
        </div>
        <div style={{
          minWidth: '88px',
          padding: '7px 10px',
          borderRadius: '10px',
          border: '1px solid var(--glass-border)',
          background: 'var(--surface-2)',
          color: 'var(--text-main)',
          fontSize: '13px',
          fontWeight: 750,
          textAlign: 'center',
        }}>
          {showPercent ? `${Math.floor(percent)}%` : statusText}
        </div>
      </div>
      <div style={{
        height: '12px',
        borderRadius: '999px',
        background: 'var(--surface-3)',
        overflow: 'hidden',
        boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.28)',
      }}>
        <div
          className={hasTotal ? undefined : 'shimmer-strip'}
          style={{
            width: `${percent}%`,
            minWidth: running ? '36px' : 0,
            height: '100%',
            borderRadius: '999px',
            background: hasTotal ? 'var(--positive)' : undefined,
            transition: 'width 160ms ease',
          }}
        />
      </div>
    </div>
  );
}

function StatsPanel({
  stats,
  ignoredCount,
  allGroupsSelected,
  allGroupsDisabled,
  selectedArchiveCount,
  selectedGroupCount,
  running,
  onSmartSelect,
  onToggleAllGroups,
  onExecute,
  showWorkerActions,
}) {
  if (!stats) return null;
  const items = [
    ['全部档案', stats.totalArchiveCount ?? stats.archiveCount],
    ['范围内', stats.archiveCount],
    ['范围外', stats.outOfRange ?? 0],
    ['有效封面', stats.signatureCount],
    ['已排除', stats.missing],
    ['疑似重复', stats.pairCount],
    ['选中档案', selectedArchiveCount],
    ...(showWorkerActions ? [
      ['已忽略组合', ignoredCount],
      ['选中分组', selectedGroupCount],
    ] : []),
  ];
  return (
    <div className="glass-panel workbench-section dedupe-scan-section" style={{ padding: '14px 16px', marginBottom: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 800, fontSize: '14px' }}>本次扫描</div>
        {stats.missing > 0 && (
          <div style={{ color: 'var(--text-sub)', fontSize: '12px' }}>
            缺失封面的档案已排除，不参与相似度计算
          </div>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))', gap: '10px' }}>
        {items.map(([label, value]) => (
          <div
            key={label}
            style={{
              padding: '10px 12px',
              borderRadius: '10px',
              border: '1px solid var(--glass-border)',
              background: 'var(--surface-2)',
              minWidth: 0,
            }}
          >
            <div style={{ color: 'var(--text-sub)', fontSize: '12px', lineHeight: 1.3 }}>{label}</div>
            <div style={{ marginTop: '4px', color: 'var(--text-main)', fontWeight: 850, fontSize: '18px', lineHeight: 1.2 }}>
              {formatCount(value)}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '12px' }}>
        <button type="button" className="btn" onClick={onSmartSelect} disabled={allGroupsDisabled}>智能选择</button>
        {showWorkerActions && <button
          type="button"
          className="btn"
          aria-pressed={allGroupsSelected}
          onClick={onToggleAllGroups}
          disabled={allGroupsDisabled}
        >
          {allGroupsSelected ? '取消全选' : '全选分组'}
        </button>}
        <button type="button" className="btn" onClick={onExecute} disabled={running || (selectedArchiveCount === 0 && selectedGroupCount === 0)}>
          执行
        </button>
      </div>
    </div>
  );
}

function DateRangePanel({ range, running, onChange, onReset, onStart }) {
  return (
    <div className="glass-panel workbench-section dedupe-scope-section" style={{ padding: '14px 16px', marginBottom: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontWeight: 800, fontSize: '16px', lineHeight: 1.3, textWrap: 'balance' }}>检测范围</h2>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={onReset} disabled={running} style={{ padding: '7px 12px', fontSize: '12px' }}>重置</button>
          <button type="button" className="btn" onClick={onStart} disabled={running} style={{ padding: '7px 12px', fontSize: '12px' }}>
            {running ? '处理中…' : '开始检测'}
          </button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', alignItems: 'end' }}>
        <label style={{ display: 'grid', gap: '6px', color: 'var(--text-sub)', fontSize: '12px' }}>
          开始日期
          <DatePicker
            value={range.start}
            disabled={running}
            ariaLabel="开始日期"
            onChange={(value) => onChange({ ...range, start: value })}
          />
        </label>
        <label style={{ display: 'grid', gap: '6px', color: 'var(--text-sub)', fontSize: '12px' }}>
          结束日期
          <DatePicker
            value={range.end}
            disabled={running}
            ariaLabel="结束日期"
            onChange={(value) => onChange({ ...range, end: value })}
          />
        </label>
      </div>
    </div>
  );
}

function DedupeArchiveItem({
  archive,
  selected,
  selectionDisabled,
  showProgressBar,
  reserveProgressSpace,
  onToggle,
  onContextMenu,
}) {
  const pageCount = Number(archive.pagecount ?? archive.total) || 0;
  const smartSignals = getDedupeSmartSelectionSignals(archive);
  return (
    <div
      className={`dedupe-card-item${selectionDisabled ? ' is-selection-disabled' : ''}`}
      onClick={(event) => event.stopPropagation()}
      title={selectionDisabled ? '与当前选择冲突；每条关联重复链至少保留一个档案' : undefined}
    >
      <ArchiveCard
        archive={archive}
        showProgressBar={showProgressBar}
        reserveProgressSpace={reserveProgressSpace}
        onClick={() => onToggle(archive)}
        onArchiveContextMenu={onContextMenu}
        noCrop
        selectionMode
        selected={selected}
        onSelectToggle={onToggle}
        disabled={selectionDisabled}
        overlay={selected ? (
          <div className="dedupe-card-selected-mark"><ToolbarGlyph name="check" size={15} color="var(--accent-contrast)" /></div>
        ) : null}
      />
      <div className="dedupe-card-size-row">
        <div className="dedupe-card-size">
          {formatBytes(archive.size) || '体积未知'} · {pageCount > 0 ? `${pageCount}页` : '页数未知'}
        </div>
        {smartSignals.roughTranslation && <div className="dedupe-card-smart-tag is-warning">渣翻</div>}
        {smartSignals.extraneousAds && <div className="dedupe-card-smart-tag is-warning">外部广告</div>}
        {smartSignals.uncensored && <div className="dedupe-card-smart-tag is-positive">无修正</div>}
      </div>
    </div>
  );
}

function EmptyState({ title, detail }) {
  return (
    <div className="glass-panel" style={{
      maxWidth: '620px',
      margin: '44px auto 0',
      padding: '24px',
      borderRadius: '12px',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: '16px', fontWeight: 850, lineHeight: 1.45 }}>{title}</div>
      {detail && (
        <div style={{ marginTop: '8px', color: 'var(--text-sub)', fontSize: '13px', lineHeight: 1.65 }}>
          {detail}
        </div>
      )}
    </div>
  );
}

export default function DeduplicatePage({ onBack }) {
  const { showToast } = useToast();
  const workerReady = hasValidWorkerConfig();
  const [progressBarVisibility] = useState(readArchiveProgressVisibility);
  const showGlobalArchiveProgress = shouldShowArchiveProgress(progressBarVisibility, false);
  const reserveGlobalProgressSpace = progressBarVisibility === ARCHIVE_PROGRESS_VISIBILITY.GLOBAL;
  const [status, setStatus] = useState('准备检测');
  const [running, setRunning] = useState(false);
  const [archives, setArchives] = useState([]);
  const [groups, setGroups] = useState([]);
  const [ignoredPairs, setIgnoredPairs] = useState(new Set());
  const [selectedArchiveIds, setSelectedArchiveIds] = useState(new Set());
  const [selectedGroupKeys, setSelectedGroupKeys] = useState(new Set());
  const [processedDeletedArchiveIds, setProcessedDeletedArchiveIds] = useState(new Set());
  const [processedNonDuplicatePairKeys, setProcessedNonDuplicatePairKeys] = useState(new Set());
  const [savedResultAvailable, setSavedResultAvailable] = useState(hasSavedDedupeResult);
  const [lastScanStats, setLastScanStats] = useState(null);
  const [workerWarning, setWorkerWarning] = useState('');
  const [progress, setProgress] = useState(null);
  const [executePending, setExecutePending] = useState(false);
  const [deleteSyncConfirmed, setDeleteSyncConfirmed] = useState(true);
  const [executionProgress, setExecutionProgress] = useState(null);
  const [failureReport, setFailureReport] = useState(null);
  const [archiveMenu, setArchiveMenu] = useState(null);
  const [thumbnailArchive, setThumbnailArchive] = useState(null);
  const [dateRange, setDateRange] = useState(() => ({
    start: DEDUPE_DEFAULT_START_DATE,
    end: getTodayDateString(),
  }));

  const archiveMap = useMemo(() => new Map(archives.map((archive) => [archiveId(archive), archive])), [archives]);
  const selectedArchives = useMemo(() => (
    Array.from(selectedArchiveIds).map((id) => archiveMap.get(id)).filter(Boolean)
  ), [archiveMap, selectedArchiveIds]);
  const selectionDisabledIds = useMemo(() => (
    getDuplicateSelectionDisabledIds(groups, selectedArchiveIds)
  ), [groups, selectedArchiveIds]);
  const groupChains = useMemo(() => groupDuplicatePairsByChain(groups), [groups]);
  const groupNumberByKey = useMemo(() => new Map(
    groups.map((group, index) => [groupKey(group), index + 1]),
  ), [groups]);
  const ehFavoriteDeleteSync = getEhFavoriteDeleteSync();

  const handleOpenArchiveMenu = useCallback((archive, point) => {
    setArchiveMenu({ archive, x: point.x, y: point.y });
  }, []);

  const openArchiveInNewTab = useCallback((archive) => {
    const id = archiveId(archive);
    if (!id) return;
    rememberArchiveMetadata(archive, { immediate: true });
    window.open(`/?id=${encodeURIComponent(id)}`, '_blank', 'noopener,noreferrer');
  }, []);

  const openArchiveThumbnails = useCallback((archive) => {
    setThumbnailArchive(archive);
  }, []);

  const loadAllArchives = useCallback(async () => {
    const all = [];
    let start = 0;
    let total = null;
    while (true) {
      setStatus('正在获取档案列表');
      setProgress({
        label: '获取档案列表',
        current: all.length,
        total: Number.isFinite(total) ? total : null,
        detail: Number.isFinite(total) ? `${all.length} / ${total}` : `已获取 ${all.length}`,
      });
      const res = await lrrApi.search('', start, 'date_added', 'desc');
      const data = Array.isArray(res?.data) ? res.data : [];
      if (data.length === 0) break;
      all.push(...data);
      total = getArchiveSearchTotal(res, data.length, total);
      const nextStart = start + data.length;
      if (nextStart <= start) throw new Error('档案分页未前进，已停止扫描');
      start = nextStart;
      if (Number.isFinite(total) && all.length >= total) break;
    }
    return all;
  }, []);

  const resetDateRange = useCallback(() => {
    setDateRange({ start: DEDUPE_DEFAULT_START_DATE, end: getTodayDateString() });
  }, []);

  const runDetection = useCallback(async () => {
    setRunning(true);
    setWorkerWarning('');
    setSelectedArchiveIds(new Set());
    setSelectedGroupKeys(new Set());
    setProcessedDeletedArchiveIds(new Set());
    setProcessedNonDuplicatePairKeys(new Set());
    setGroups([]);
    setLastScanStats(null);

    try {
      let ignored = [];
      let delayedWorkerWarning = '';
      if (workerReady) {
        try {
          setStatus('正在读取非重复记录');
          setProgress({ label: '读取非重复记录', current: 0, total: 1, detail: '从 Worker KV 读取已忽略组合' });
          ignored = await getNonDuplicatePairKeys();
        } catch (err) {
          delayedWorkerWarning = '无法读取 Worker 中的非重复记录，本次检测未排除已标记项目。请确认 Worker 已部署新版 /dedupe/non-duplicates 接口。';
        }
      }
      const ignoredSet = new Set(ignored);
      setIgnoredPairs(ignoredSet);

      const allArchives = await loadAllArchives();
      const scanRange = normalizeDedupeDateRange(dateRange.start, dateRange.end, getTodayDateString());
      const scopedArchives = filterArchivesByDateRange(allArchives, scanRange.start, scanRange.end);
      const allArchiveMap = new Map(scopedArchives.map((archive) => [archiveId(archive), archive]));
      const baseStats = {
        archiveCount: scopedArchives.length,
        totalArchiveCount: allArchives.length,
        outOfRange: Math.max(0, allArchives.length - scopedArchives.length),
        dateRange: scanRange,
      };
      setArchives(scopedArchives);
      setDateRange(scanRange);
      setStatus(`正在读取封面 0 / ${scopedArchives.length}`);
      const signatures = new Map();
      let missing = 0;

      await mapWithConcurrency(scopedArchives, THUMBNAIL_CONCURRENCY, async (archive) => {
        const id = archiveId(archive);
        if (!id) return null;
        const blob = await loadDeduplicatorThumbnailBlob(id);
        if (!blob) return null;
        const signature = await createCoverSignature(blob, 8);
        signatures.set(id, signature);
        return signature;
      }, (done, total) => {
        setStatus('正在读取封面');
        setProgress({
          label: '读取封面',
          current: done,
          total,
          detail: `${done} / ${total}`,
        });
      });

      missing = scopedArchives.length - signatures.size;
      if (signatures.size < 2) {
        setLastScanStats({ ...baseStats, signatureCount: signatures.size, missing, pairCount: 0 });
        setProgress({
          label: '检测完成',
          current: signatures.size,
          total: scopedArchives.length,
          detail: missing > 0
            ? `已排除 ${missing} 个缺失封面的档案；有效封面不足 2 个，无法进行比较`
            : '有效封面不足 2 个，无法进行比较',
        });
        setStatus(missing > 0
          ? `检测完成，已排除 ${missing} 个缺失封面的档案`
          : '检测完成，有效封面不足');
        return;
      }
      setStatus('正在比较封面');
      setProgress({
        label: '比较封面',
        current: 0,
        total: signatures.size,
        detail: missing > 0
          ? `按 LRReader 规则比较缩略图，已排除 ${missing} 个缺失封面的档案`
          : '按 LRReader 规则比较缩略图',
      });
      const pairs = await findDuplicatePairsAsync(signatures, ignoredSet, {
        onProgress: ({ current, total, pairs }) => {
          setStatus('正在比较封面');
          setProgress({
            label: '比较封面',
            current,
            total,
            detail: `${current.toLocaleString()} / ${total.toLocaleString()}，发现 ${pairs.toLocaleString()} 组疑似重复`,
          });
        },
      });
      const groupIds = buildDuplicateGroups(pairs, ignoredSet);
      const nextGroups = filterGroupsByProcessedState(groupIds
        .map((ids) => ids.map((id) => allArchiveMap.get(id)).filter(Boolean))
        .filter((group) => group.length > 1), new Set(), new Set());

      setGroups(nextGroups);
      setLastScanStats({ ...baseStats, signatureCount: signatures.size, missing, pairCount: pairs.length });
      setWorkerWarning(delayedWorkerWarning);
      setProgress({
        label: '检测完成',
        current: 1,
        total: 1,
        detail: [
          nextGroups.length ? `发现 ${nextGroups.length} 组疑似重复` : '未发现疑似重复',
          missing > 0 ? `已排除 ${missing} 个缺失封面的档案` : '',
        ].filter(Boolean).join('，'),
      });
      setStatus(nextGroups.length
        ? `检测完成，发现 ${nextGroups.length} 组疑似重复`
        : '检测完成，未发现疑似重复');
    } catch (err) {
      setStatus(err.message || '检测失败');
      setProgress({ label: '检测失败', current: 0, total: 1, detail: err.message || '检测失败' });
      showToast(err.message || '检测失败', 'error');
    } finally {
      setRunning(false);
    }
  }, [dateRange.end, dateRange.start, loadAllArchives, showToast, workerReady]);

  const toggleArchiveSelection = useCallback((archive) => {
    const id = archiveId(archive);
    if (!id) return;
    setSelectedArchiveIds((prev) => {
      if (prev.has(id)) {
        const next = new Set(prev);
        next.delete(id);
        return next;
      }
      return new Set(normalizeDuplicateSelection(groups, [...prev, id]));
    });
    const ownerGroupKeys = new Set(groups
      .filter((group) => groupIds(group).includes(id))
      .map(groupKey));
    setSelectedGroupKeys((prev) => new Set(Array.from(prev).filter((key) => !ownerGroupKeys.has(key))));
  }, [groups]);

  const toggleGroupSelection = useCallback((group) => {
    const key = groupKey(group);
    const ids = new Set(groupIds(group));
    setSelectedGroupKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setSelectedArchiveIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  const smartSelect = useCallback(() => {
    const candidates = groups.flatMap((group) => selectDuplicateDeletionIds(group).slice(0, 1));
    setSelectedArchiveIds(new Set(normalizeDuplicateSelection(groups, candidates)));
    setSelectedGroupKeys(new Set());
  }, [groups]);

  const requestExecuteSelected = useCallback(() => {
    setDeleteSyncConfirmed(true);
    setExecutionProgress(null);
    setExecutePending(true);
  }, []);

  const syncSavedResult = useCallback((nextGroups, {
    nextStatus = status,
    nextSelectedArchiveIds = selectedArchiveIds,
    nextSelectedGroupKeys = selectedGroupKeys,
  } = {}) => {
    if (!savedResultAvailable) return;
    try {
      const key = scopedStorageKey(DEDUPE_SAVED_RESULT_KEY);
      const payload = createDedupeSavedResultPayload({
        groups: nextGroups,
        dateRange,
        status: nextStatus,
        lastScanStats,
        workerWarning,
        selectedArchiveIds: nextSelectedArchiveIds,
        selectedGroupKeys: nextSelectedGroupKeys,
      });
      if (!payload) {
        localStorage.removeItem(key);
        setSavedResultAvailable(false);
        return;
      }
      localStorage.setItem(key, JSON.stringify(payload));
    } catch (err) {
      showToast(err.message || '更新保存结果失败，浏览器存储空间可能不足', 'error');
    }
  }, [
    dateRange,
    lastScanStats,
    savedResultAvailable,
    selectedArchiveIds,
    selectedGroupKeys,
    showToast,
    status,
    workerWarning,
  ]);

  const executeSelected = useCallback(async () => {
    const selectedGroups = workerReady ? groups.filter((group) => selectedGroupKeys.has(groupKey(group))) : [];
    if (selectedGroups.length === 0 && selectedArchives.length === 0) return;

    const total = selectedGroups.length + selectedArchives.length;
    const markedGroupKeys = new Set();
    const deletedIds = [];
    const ehFailures = [];
    const lrrFailures = [];
    let markFailure = '';
    let completed = 0;
    setRunning(true);
    setExecutionProgress({ label: '准备执行', current: 0, total, detail: '正在整理操作' });

    if (selectedGroups.length > 0) {
      const pairs = selectedGroups.flatMap(pairKeysForGroup);
      setExecutionProgress({
        label: '标记分组为不重复',
        current: completed,
        total,
        detail: `${selectedGroups.length} 组`,
      });
      try {
        await markNonDuplicatePairs(pairs);
        selectedGroups.forEach((group) => markedGroupKeys.add(groupKey(group)));
        setIgnoredPairs((prev) => new Set([...prev, ...pairs]));
        setProcessedNonDuplicatePairKeys((prev) => new Set([...prev, ...pairs]));
      } catch (error) {
        markFailure = error.message || '标记失败，请检查 Worker 与访问 Token';
      }
      completed += selectedGroups.length;
    }

    for (const archive of selectedArchives) {
      const id = archiveId(archive);
      setExecutionProgress({
        label: '删除档案',
        current: completed,
        total,
        detail: archive.title || id,
      });
      try {
        await deleteArchiveWithFavoriteSync(archive, {
          syncEnabled: workerReady && ehFavoriteDeleteSync,
          confirmationEnabled: deleteSyncConfirmed,
          continueOnFavoriteError: true,
          onFavoriteError: ({ galleryUrl, error }) => {
            ehFailures.push({ url: galleryUrl, message: error?.message || 'E-Hentai 收藏夹删除失败' });
          },
        });
        deletedIds.push(id);
      } catch (error) {
        lrrFailures.push({ id, title: archive.title || id, message: error.message || 'LANraragi 删除失败' });
      }
      completed += 1;
      setExecutionProgress({
        label: '删除档案',
        current: completed,
        total,
        detail: archive.title || id,
      });
    }

    const deletedSet = new Set(deletedIds);
    const nextGroups = groups
      .filter((group) => !markedGroupKeys.has(groupKey(group)))
      .map((group) => group.filter((archive) => !deletedSet.has(archiveId(archive))))
      .filter((group) => group.length > 1);
    const visibleArchiveIds = new Set(nextGroups.flatMap(groupIds));
    const visibleGroupKeys = new Set(nextGroups.map(groupKey));
    const nextSelectedArchiveIds = Array.from(selectedArchiveIds)
      .filter((id) => !deletedSet.has(id) && visibleArchiveIds.has(id));
    const nextSelectedGroupKeys = Array.from(selectedGroupKeys)
      .filter((key) => !markedGroupKeys.has(key) && visibleGroupKeys.has(key));
    const failureCount = ehFailures.length + lrrFailures.length + (markFailure ? 1 : 0);
    const nextStatus = failureCount > 0
      ? `执行完成，${failureCount} 项失败`
      : `执行完成：删除 ${deletedIds.length} 个，标记 ${markedGroupKeys.size} 组`;

    setArchives((prev) => prev.filter((archive) => !deletedSet.has(archiveId(archive))));
    setGroups(nextGroups);
    setProcessedDeletedArchiveIds((prev) => new Set([...prev, ...deletedIds]));
    setSelectedArchiveIds(new Set(nextSelectedArchiveIds));
    setSelectedGroupKeys(new Set(nextSelectedGroupKeys));
    setExecutionProgress({ label: '执行完成', current: total, total, detail: nextStatus });
    setStatus(nextStatus);
    syncSavedResult(nextGroups, { nextStatus, nextSelectedArchiveIds, nextSelectedGroupKeys });
    setRunning(false);
    setExecutePending(false);
    if (failureCount > 0) {
      setFailureReport({
        ehFailures,
        lrrFailures,
        markFailure,
      });
    }
  }, [
    deleteSyncConfirmed,
    ehFavoriteDeleteSync,
    groups,
    selectedArchiveIds,
    selectedArchives,
    selectedGroupKeys,
    syncSavedResult,
    workerReady,
  ]);

  const saveResult = useCallback(() => {
    const payload = createDedupeSavedResultPayload({
      groups,
      dateRange,
      status,
      lastScanStats,
      workerWarning,
      selectedArchiveIds,
      selectedGroupKeys,
    });
    if (!payload) {
      setStatus('没有可保存的重复分组');
      showToast('没有可保存的重复分组', 'info');
      return;
    }
    try {
      localStorage.setItem(scopedStorageKey(DEDUPE_SAVED_RESULT_KEY), JSON.stringify(payload));
      setSavedResultAvailable(true);
      setStatus('已保存筛选结果');
    } catch (err) {
      showToast(err.message || '保存失败，浏览器存储空间可能不足', 'error');
    }
  }, [
    dateRange,
    groups,
    lastScanStats,
    selectedArchiveIds,
    selectedGroupKeys,
    showToast,
    status,
    workerWarning,
  ]);

  const loadSavedResult = useCallback(() => {
    try {
      const raw = localStorage.getItem(scopedStorageKey(DEDUPE_SAVED_RESULT_KEY));
      if (!raw) {
        setSavedResultAvailable(false);
        return;
      }
      const payload = JSON.parse(raw);
      const nextArchives = Array.isArray(payload.archives) ? payload.archives : [];
      const archiveById = new Map(nextArchives.map((archive) => [archiveId(archive), archive]));
      const legacyState = Number(payload.version) < 2;
      const deletedSet = new Set(legacyState ? (payload.processedDeletedArchiveIds || []) : []);
      const nonDuplicateSet = new Set(legacyState ? (payload.processedNonDuplicatePairKeys || []) : []);
      const restoredGroups = filterGroupsByProcessedState(
        (payload.groups || [])
          .map((ids) => (ids || []).map((id) => archiveById.get(String(id))).filter(Boolean))
          .filter((group) => group.length > 1),
        deletedSet,
        nonDuplicateSet,
      );
      const visibleArchiveIds = new Set(restoredGroups.flatMap(groupIds));
      const visibleGroupKeys = new Set(restoredGroups.map(groupKey));
      setArchives(nextArchives.filter((archive) => !deletedSet.has(archiveId(archive))));
      setGroups(restoredGroups);
      const restoredSelection = (payload.selectedArchiveIds || []).filter((id) => visibleArchiveIds.has(id));
      setSelectedArchiveIds(new Set(normalizeDuplicateSelection(restoredGroups, restoredSelection)));
      setSelectedGroupKeys(workerReady
        ? new Set((payload.selectedGroupKeys || []).filter((key) => visibleGroupKeys.has(key)))
        : new Set());
      setProcessedDeletedArchiveIds(deletedSet);
      setProcessedNonDuplicatePairKeys(nonDuplicateSet);
      setIgnoredPairs(new Set(Array.isArray(payload.ignoredPairs) ? payload.ignoredPairs : []));
      setDateRange(normalizeDedupeDateRange(payload.dateRange?.start, payload.dateRange?.end, getTodayDateString()));
      setLastScanStats(payload.lastScanStats || null);
      setWorkerWarning(payload.workerWarning || '');
      setProgress(null);
      setSavedResultAvailable(true);
      setStatus(payload.status || '已载入保存结果');
    } catch (err) {
      showToast(err.message || '载入保存结果失败', 'error');
    }
  }, [showToast, workerReady]);

  const deleteSavedResult = useCallback(() => {
    try {
      localStorage.removeItem(scopedStorageKey(DEDUPE_SAVED_RESULT_KEY));
      setSavedResultAvailable(false);
      setStatus('已删除保存结果');
    } catch (err) {
      showToast(err.message || '删除保存结果失败', 'error');
    }
  }, [showToast]);

  const allGroupsSelected = workerReady && groups.length > 0 && selectedGroupKeys.size === groups.length;

  const renderGroup = (group) => {
    const key = groupKey(group);
    const selected = selectedGroupKeys.has(key);
    return (
      <section
        key={key}
        className={`dedupe-group${selected ? ' is-selected' : ''}`}
        onClick={workerReady ? () => toggleGroupSelection(group) : undefined}
        style={{
          position: 'relative',
          border: selected
            ? '1px solid var(--warning-border)'
            : '1px solid var(--glass-border)',
          borderRadius: '8px',
          padding: '26px 16px 18px',
          background: selected
            ? 'var(--warning-surface)'
            : 'var(--surface-1)',
        }}
      >
        {workerReady && <button
          type="button"
          className="dedupe-group-toggle"
          aria-pressed={selected}
          onClick={(event) => {
            event.stopPropagation();
            toggleGroupSelection(group);
          }}
        >
          疑似重复 {groupNumberByKey.get(key)}
        </button>}
        {workerReady && <div className="dedupe-group-selection-message" aria-hidden={!selected}>
          <div>
            <div className="dedupe-group-selection-message-content">已选择整组标记为不重复</div>
          </div>
        </div>}
        <div className="dedupe-group-cards">
          {group.map((archive) => {
            const id = archiveId(archive);
            return (
              <DedupeArchiveItem
                key={id}
                archive={archive}
                selected={selectedArchiveIds.has(id)}
                selectionDisabled={selectionDisabledIds.has(id)}
                showProgressBar={showGlobalArchiveProgress}
                reserveProgressSpace={reserveGlobalProgressSpace}
                onToggle={toggleArchiveSelection}
                onContextMenu={handleOpenArchiveMenu}
              />
            );
          })}
        </div>
      </section>
    );
  };

  return (
    <div className="dedupe-page workbench-page">
      <header className="workbench-header dedupe-page-header">
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', lineHeight: 1.2 }}>重复档案检测</h1>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={onBack} disabled={running}>返回</button>
          <button type="button" className="btn" onClick={saveResult} disabled={running || groups.length === 0}>保存结果</button>
          <button type="button" className="btn" onClick={loadSavedResult} disabled={running || !savedResultAvailable}>载入保存</button>
          <button type="button" className="btn" onClick={deleteSavedResult} disabled={running || !savedResultAvailable}>删除保存</button>
        </div>
      </header>

      <DateRangePanel
        range={dateRange}
        running={running}
        onChange={setDateRange}
        onReset={resetDateRange}
        onStart={runDetection}
      />

      <ProgressPanel progress={progress} running={running} />

      {!running && workerWarning && (
        <div className="glass-panel" style={{ padding: '12px 14px', marginBottom: '16px', borderColor: 'var(--warning-border)', color: 'var(--warning-text)', fontSize: '13px' }}>
          {workerWarning}
        </div>
      )}

      <StatsPanel
        stats={lastScanStats}
        ignoredCount={ignoredPairs.size}
        allGroupsSelected={allGroupsSelected}
        allGroupsDisabled={running || groups.length === 0}
        selectedArchiveCount={selectedArchiveIds.size}
        selectedGroupCount={selectedGroupKeys.size}
        running={running}
        onSmartSelect={smartSelect}
        onToggleAllGroups={() => {
          setSelectedGroupKeys(allGroupsSelected ? new Set() : new Set(groups.map(groupKey)));
          setSelectedArchiveIds(new Set());
        }}
        onExecute={requestExecuteSelected}
        showWorkerActions={workerReady}
      />

      <div className="dedupe-groups-grid">
        {groupChains.map((chain) => (
          chain.length > 1 ? (
            <div className="dedupe-chain" key={chain.map(groupKey).join('~')}>
              <div className="dedupe-chain-label">关联重复链</div>
              {chain.map(renderGroup)}
            </div>
          ) : renderGroup(chain[0])
        ))}
      </div>

      {!running && groups.length === 0 && !lastScanStats && (
        <EmptyState
          title="等待检测"
          detail="点击“开始检测”后会读取档案封面，通过相似度算法查找疑似重复的档案。"
        />
      )}
      {!running && groups.length === 0 && lastScanStats && (
        <EmptyState
          title={lastScanStats.signatureCount < 2 ? '有效封面不足' : '本次检测未发现疑似重复'}
          detail={lastScanStats.missing > 0
            ? `已排除 ${formatCount(lastScanStats.missing)} 个缺失封面的档案。其余有效封面已完成比较。`
            : '所有有效封面已完成比较。'}
        />
      )}
      <DedupeArchiveContextMenu
        menu={archiveMenu}
        onClose={() => setArchiveMenu(null)}
        onOpenNewTab={openArchiveInNewTab}
        onViewThumbnails={openArchiveThumbnails}
      />
      {thumbnailArchive && (
        <ArchiveThumbnailDialog
          archive={thumbnailArchive}
          onClose={() => setThumbnailArchive(null)}
        />
      )}
      <ConfirmDialog
        open={executePending}
        title="确认执行去重操作"
        message={`将删除 ${selectedArchives.length} 个档案，并标记 ${selectedGroupKeys.size} 个分组为不重复。档案删除不可撤销。`}
        confirmLabel={running ? '执行中…' : '确认执行'}
        cancelLabel="取消"
        showCancel={!running}
        onConfirm={executeSelected}
        onCancel={() => { if (!running) setExecutePending(false); }}
        confirmDisabled={running}
        dismissOnBackdrop={!running}
      >
        {workerReady && ehFavoriteDeleteSync && selectedArchives.length > 0 && (
          <EhFavoriteDeleteSwitch checked={deleteSyncConfirmed} onChange={setDeleteSyncConfirmed} disabled={running} />
        )}
        <ExecutionProgressPanel progress={executionProgress} />
      </ConfirmDialog>
      <ArchiveDeletionFailureDialog
        report={failureReport}
        message="已完成其余操作。失败项保留在当前结果中，可稍后重试。"
        onClose={() => setFailureReport(null)}
      />
    </div>
  );
}
