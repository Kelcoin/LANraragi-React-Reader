import React, { useId, useRef } from 'react';
import { Dialog } from '@base-ui/react/dialog';

export default function DedupeHelpDialog({ open, onClose }) {
  const titleId = useId();
  const closeRef = useRef(null);
  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose?.(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="confirm-dialog-overlay" data-dialog-overlay />
        <Dialog.Popup
          className="dialog confirm-dialog dedupe-help-dialog dropdown-animate"
          data-dialog-root
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          initialFocus={() => closeRef.current}
        >
          <Dialog.Title className="confirm-dialog-title" id={titleId}>查重工具帮助</Dialog.Title>
          <div className="dedupe-help-content">
            <section>
              <h3>使用流程</h3>
              <p>先设置检测日期范围并开始检测，确认重复组后选择要处理的档案，最后保存结果或执行操作。</p>
            </section>
            <section>
              <h3>筛选与选择</h3>
              <p>筛选只改变显示方式，不会改变检测结果。基于图像和基于档案名筛选会保留关联重复链的完整内容。</p>
            </section>
            <section>
              <h3>智能选择规则</h3>
              <p>智能选择按以下优先级标记待删除档案：无汉语、渣翻、无修正、外部广告、体积较小、列表中较早的档案。仅由档案名判定的重复组默认跳过，可在确认弹窗中选择是否纳入。</p>
            </section>
            <section>
              <h3>保存与执行</h3>
              <p>保存结果会记住当前选择和判定来源，载入后手动选择会立即同步。选中的档案是待删除对象，执行删除不可撤销；每条重复链至少保留一个档案。</p>
            </section>
          </div>
          <div className="confirm-dialog-actions">
            <Dialog.Close ref={closeRef} className="btn btn-primary" data-dedupe-help-close>知道了</Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
