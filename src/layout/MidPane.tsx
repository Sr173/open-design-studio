/* MidPane — 中栏 tab 容器(Preview / Questions)
 *
 * pendingQuestions != null 时自动切到 Questions tab
 * 用户可手动切回 Preview 看半成品
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { PreviewPane } from './PreviewPane';
import { QuestionsPanel } from './QuestionsPanel';
import type { ChatController } from '../store/chat';

type Tab = 'preview' | 'questions';

export function MidPane({
  controller,
  initialPath = 'index.html',
}: {
  controller: ChatController;
  initialPath?: string;
}) {
  const state = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.getState()
  );
  const [tab, setTab] = useState<Tab>('preview');

  // 来新问卷自动切过去
  useEffect(() => {
    if (state.pendingQuestions) setTab('questions');
  }, [state.pendingQuestions]);

  // 没问卷时锁定 preview
  useEffect(() => {
    if (!state.pendingQuestions && tab === 'questions') setTab('preview');
  }, [state.pendingQuestions, tab]);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minWidth: 0,
      }}
    >
      <TabBar
        tab={tab}
        setTab={setTab}
        hasQuestions={!!state.pendingQuestions}
      />

      {tab === 'preview' ? (
        <PreviewPane
          projectId={controller.projectId}
          refreshKey={state.refreshKey}
          writing={state.writing}
          initialPath={initialPath}
        />
      ) : state.pendingQuestions ? (
        <QuestionsPanel
          set={state.pendingQuestions}
          disabled={state.running}
          onSubmit={(answers) => controller.submitQuestionAnswers(answers)}
          onCancel={() => controller.cancelPendingQuestions()}
        />
      ) : (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-tertiary)',
          }}
        >
          没有待回答的问题
        </div>
      )}
    </div>
  );
}

function TabBar({
  tab,
  setTab,
  hasQuestions,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  hasQuestions: boolean;
}) {
  return (
    <div
      style={{
        height: 32,
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'center',
        background: 'var(--bg-base)',
        borderBottom: '1px solid var(--border-subtle)',
        padding: '0 var(--sp-2)',
        gap: 4,
      }}
    >
      <Tab
        active={tab === 'preview'}
        onClick={() => setTab('preview')}
        icon="▣"
        label="Preview"
      />
      {hasQuestions && (
        <Tab
          active={tab === 'questions'}
          onClick={() => setTab('questions')}
          icon="❓"
          label="Questions"
          highlight
        />
      )}
    </div>
  );
}

function Tab({
  active,
  onClick,
  icon,
  label,
  highlight,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
  highlight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        height: 24,
        padding: '0 10px',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        borderRadius: 4,
        fontSize: 'var(--fs-xs)',
        fontFamily: 'var(--font-mono)',
        color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
        background: active ? 'var(--bg-elevated)' : 'transparent',
        border: highlight && !active ? '1px solid var(--accent)' : 'none',
      }}
    >
      <span style={{ fontSize: 11 }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}
