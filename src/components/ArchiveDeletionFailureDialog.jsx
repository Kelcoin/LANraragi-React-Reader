import React from 'react';
import ConfirmDialog from './ConfirmDialog';
import { useToast } from './Toast';

export default function ArchiveDeletionFailureDialog({
  report,
  onClose,
  message = '已完成其余操作。失败项可稍后重试。',
}) {
  const { showToast } = useToast();

  const copyEhFailureUrls = async () => {
    const urls = (report?.ehFailures || []).map((item) => item.url).filter(Boolean);
    if (urls.length === 0) return;
    try {
      await navigator.clipboard.writeText(urls.join('\n'));
      showToast('已复制 E-Hentai 失败链接', 'success');
    } catch {
      showToast('复制失败，请手动复制链接', 'error');
    }
  };

  return (
    <ConfirmDialog
      open={!!report}
      title="部分操作失败"
      message={message}
      confirmLabel="关闭"
      showCancel={false}
      destructive={false}
      onConfirm={onClose}
      onCancel={onClose}
    >
      {report?.ehFailures?.length > 0 && (
        <div className="dedupe-failure-section">
          <div className="dedupe-failure-heading">
            <strong>E-Hentai 收藏夹删除失败</strong>
            {report.ehFailures.some((item) => item.url) && (
              <button type="button" className="btn btn-secondary" onClick={copyEhFailureUrls}>一键复制</button>
            )}
          </div>
          <ul className="dedupe-failure-list">
            {report.ehFailures.map(({ url, message: failureMessage }, index) => (
              <li key={`${url || 'missing'}:${index}`}>
                {url
                  ? <a href={url} target="_blank" rel="noreferrer" translate="no">{url}</a>
                  : <span>未找到 E-Hentai 链接</span>}
                <span>{failureMessage}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {report?.lrrFailures?.length > 0 && (
        <div className="dedupe-failure-section">
          <strong>{report?.lrrHeading || 'LANraragi 删除失败'}</strong>
          <ul className="dedupe-failure-list">
            {report.lrrFailures.map(({ id, title, message: failureMessage }) => (
              <li key={id}><span>{title}</span><span>{failureMessage}</span></li>
            ))}
          </ul>
        </div>
      )}
      {report?.markFailure && (
        <div className="dedupe-failure-section">
          <strong>标记分组失败</strong>
          <div className="dedupe-failure-message">{report.markFailure}</div>
        </div>
      )}
    </ConfirmDialog>
  );
}
