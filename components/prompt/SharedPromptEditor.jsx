'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createPromptDoc,
  applyLocalTextDiff,
  seedFromSnapshot,
  applyYjsStateBase64,
  encodeYjsStateBase64,
  getPromptText,
} from '@/lib/prompts/yjs-doc.js';
import { createLiveKitYjsProvider } from '@/lib/prompts/livekit-provider.js';
import {
  MAX_PROMPT_LENGTH,
  SNAPSHOT_DEBOUNCE_MS,
  LATE_JOIN_PEER_WAIT_MS,
  LOCK_STATUS_POLL_MS,
} from '@/lib/prompts/constants.js';
import { PromptRunRecorder } from './PromptRunRecorder.jsx';

/** Idle interval after which active editing presence clears. */
const EDITING_IDLE_MS = 2000;

function formatSavedAgo(savedAt, nowMs) {
  if (!savedAt) return '';
  const seconds = Math.max(0, Math.floor((nowMs - savedAt) / 1000));
  if (seconds < 3) return 'Saved just now';
  if (seconds < 60) return `Saved ${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  return `Saved ${minutes} min ago`;
}

function formatCharCount(n) {
  return `${n.toLocaleString()} character${n === 1 ? '' : 's'}`;
}

/**
 * Shared prompt workspace UI.
 * Pass `livekitRoom` when inside LiveKitRoom for Yjs collaboration.
 * Without it, loads durable snapshot (read-only for ended/expired rooms).
 */
export function SharedPromptEditor({
  slug,
  displayName = 'Participant',
  participantIdentity = '',
  readOnlyHint = false,
  livekitRoom = null,
}) {
  const collaborative = Boolean(livekitRoom);

  const docRef = useRef(null);
  const ytextRef = useRef(null);
  const providerRef = useRef(null);
  const snapshotTimerRef = useRef(null);
  const seedTimerRef = useRef(null);
  const editingIdleTimerRef = useRef(null);
  const applyingRemoteRef = useRef(false);
  const pendingUnsavedRef = useRef(false);

  const [text, setText] = useState('');
  const [versions, setVersions] = useState([]);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [locked, setLocked] = useState(Boolean(readOnlyHint));
  const [roomStatus, setRoomStatus] = useState('active');
  const [revision, setRevision] = useState(0);
  const [editors, setEditors] = useState([]);
  const [collabState, setCollabState] = useState(collaborative ? 'connecting' : 'offline');
  const [saveState, setSaveState] = useState('idle');
  const [savedAt, setSavedAt] = useState(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [versionName, setVersionName] = useState('');
  const [seedPayload, setSeedPayload] = useState({ draft: '', yjsState: null });

  const closed = roomStatus === 'ended' || roomStatus === 'expired';
  const readOnly = locked
    || closed
    || Boolean(readOnlyHint)
    || Boolean(selectedVersion);

  const clearEditingIdleTimer = useCallback(() => {
    if (editingIdleTimerRef.current) {
      clearTimeout(editingIdleTimerRef.current);
      editingIdleTimerRef.current = null;
    }
  }, []);

  const setLocalEditing = useCallback((isEditing) => {
    providerRef.current?.setEditing?.(Boolean(isEditing));
  }, []);

  const markEditingActive = useCallback(() => {
    if (readOnly) {
      clearEditingIdleTimer();
      setLocalEditing(false);
      return;
    }
    setLocalEditing(true);
    clearEditingIdleTimer();
    editingIdleTimerRef.current = setTimeout(() => {
      setLocalEditing(false);
      editingIdleTimerRef.current = null;
    }, EDITING_IDLE_MS);
  }, [readOnly, clearEditingIdleTimer, setLocalEditing]);

  const ensureDoc = useCallback(() => {
    if (!docRef.current) {
      const { doc, ytext } = createPromptDoc();
      docRef.current = doc;
      ytextRef.current = ytext;
    }
    return { doc: docRef.current, ytext: ytextRef.current };
  }, []);

  const syncTextareaFromYjs = useCallback(() => {
    const ytext = ytextRef.current;
    if (!ytext) return;
    const next = ytext.toString();
    applyingRemoteRef.current = true;
    setText(next);
    requestAnimationFrame(() => {
      applyingRemoteRef.current = false;
    });
  }, []);

  const loadWorkspace = useCallback(async ({ applyToDoc = false } = {}) => {
    if (!slug) return null;
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(slug)}/prompt`, {
        credentials: 'same-origin',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'Could not load prompt.');
        return null;
      }
      const prompt = data.prompt || {};
      setVersions(Array.isArray(prompt.versions) ? [...prompt.versions].reverse() : []);
      setLocked(Boolean(prompt.isLocked || prompt.locked));
      if (prompt.roomStatus) setRoomStatus(prompt.roomStatus);
      setRevision(Number(prompt.revision || 0));
      if (prompt.updatedAt) {
        const ts = Date.parse(prompt.updatedAt);
        if (!Number.isNaN(ts)) setSavedAt(ts);
      }
      const payload = {
        draft: prompt.draft ?? '',
        yjsState: prompt.yjsState || null,
      };
      setSeedPayload(payload);
      setError('');

      if (applyToDoc) {
        const { doc } = ensureDoc();
        if (payload.yjsState) {
          applyYjsStateBase64(doc, payload.yjsState);
        } else if (payload.draft) {
          seedFromSnapshot(doc, payload.draft);
        }
        syncTextareaFromYjs();
      }
      return prompt;
    } catch {
      setError('Could not load prompt.');
      return null;
    }
  }, [slug, ensureDoc, syncTextareaFromYjs]);

  const persistSnapshot = useCallback(async () => {
    if (!slug || readOnly) return;
    const { doc } = ensureDoc();
    const content = getPromptText(doc);
    setSaveState('saving');
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(slug)}/prompt`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content,
          yjsState: encodeYjsStateBase64(doc),
          updatedBy: displayName,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSaveState('error');
        pendingUnsavedRef.current = true;
        setError(data.error || 'Snapshot save failed.');
        if (data.code === 'PROMPT_LOCKED') setLocked(true);
        if (data.code === 'ROOM_ENDED') setRoomStatus('ended');
        if (data.code === 'ROOM_EXPIRED') setRoomStatus('expired');
        return;
      }
      pendingUnsavedRef.current = false;
      setRevision(Number(data.prompt?.revision || 0));
      setSavedAt(Date.now());
      setSaveState('saved');
      setLocked(Boolean(data.prompt?.isLocked || data.prompt?.locked));
      if (data.prompt?.roomStatus) setRoomStatus(data.prompt.roomStatus);
    } catch {
      setSaveState('error');
      pendingUnsavedRef.current = true;
      setError('Snapshot save failed.');
    }
  }, [slug, readOnly, ensureDoc, displayName]);

  const scheduleSnapshot = useCallback(() => {
    if (readOnly) return;
    pendingUnsavedRef.current = true;
    setSaveState((prev) => (prev === 'saving' ? prev : 'dirty'));
    if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
    snapshotTimerRef.current = setTimeout(() => {
      persistSnapshot();
    }, SNAPSHOT_DEBOUNCE_MS);
  }, [readOnly, persistSnapshot]);

  useEffect(() => {
    loadWorkspace({ applyToDoc: !collaborative });
  }, [loadWorkspace, collaborative]);

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!slug) return undefined;
    const id = setInterval(async () => {
      try {
        const response = await fetch(`/api/rooms/${encodeURIComponent(slug)}/prompt`, {
          credentials: 'same-origin',
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) return;
        const prompt = data.prompt || {};
        setLocked(Boolean(prompt.isLocked || prompt.locked));
        if (prompt.roomStatus) setRoomStatus(prompt.roomStatus);
        setVersions(Array.isArray(prompt.versions) ? [...prompt.versions].reverse() : []);
        if (providerRef.current) {
          const isClosed = prompt.roomStatus === 'ended' || prompt.roomStatus === 'expired';
          providerRef.current.setReadOnly(Boolean(prompt.isLocked) || isClosed);
        }
      } catch {
        // ignore poll errors
      }
    }, LOCK_STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [slug]);

  useEffect(() => {
    if (!collaborative || !livekitRoom || !slug) {
      setCollabState('offline');
      return undefined;
    }

    const { doc, ytext } = ensureDoc();
    const provider = createLiveKitYjsProvider({
      room: livekitRoom,
      doc,
      displayName,
      participantIdentity,
      readOnly: readOnlyHint || locked,
    });
    providerRef.current = provider;

    const onYText = () => {
      syncTextareaFromYjs();
      if (!provider.getReadOnly()) scheduleSnapshot();
    };
    ytext.observe(onYText);

    const unsubscribe = provider.on((event, payload) => {
      if (event === 'connection') {
        if (payload.state === 'connected') setCollabState('connected');
        else if (payload.state === 'reconnecting') setCollabState('reconnecting');
        else if (payload.state === 'disconnected') setCollabState('disconnected');
        else if (payload.state === 'publish-failed') setCollabState('error');
      }
      if (event === 'synced') {
        setCollabState('synced');
        syncTextareaFromYjs();
      }
      if (event === 'awareness') {
        setEditors(payload.states || []);
      }
      if (event === 'meta' && typeof payload.locked === 'boolean') {
        setLocked(payload.locked);
      }
    });

    let cancelled = false;
    (async () => {
      const prompt = await loadWorkspace({ applyToDoc: false });
      if (cancelled) return;
      seedTimerRef.current = setTimeout(() => {
        if (cancelled) return;
        if (provider.isSynced()) {
          syncTextareaFromYjs();
          return;
        }
        if (getPromptText(doc).length > 0) {
          provider.markSynced();
          syncTextareaFromYjs();
          return;
        }
        const yjsState = prompt?.yjsState || seedPayload.yjsState;
        const draft = prompt?.draft || seedPayload.draft;
        if (yjsState) applyYjsStateBase64(doc, yjsState);
        else if (draft) seedFromSnapshot(doc, draft);
        provider.markSynced();
        syncTextareaFromYjs();
        setCollabState('synced');
      }, LATE_JOIN_PEER_WAIT_MS);
    })();

    setCollabState('connecting');

    return () => {
      cancelled = true;
      if (seedTimerRef.current) clearTimeout(seedTimerRef.current);
      clearEditingIdleTimer();
      setLocalEditing(false);
      ytext.unobserve(onYText);
      unsubscribe();
      provider.destroy();
      providerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collaborative, livekitRoom, slug, displayName, participantIdentity]);

  useEffect(() => {
    const shouldBlock = locked || closed || Boolean(readOnlyHint);
    providerRef.current?.setReadOnly(shouldBlock);
    if (shouldBlock || selectedVersion) {
      clearEditingIdleTimer();
      setLocalEditing(false);
    }
    if (closed && pendingUnsavedRef.current) {
      setSaveState('error');
      setStatus('Room closed before the latest snapshot finished saving. Local text is still visible but read-only.');
    }
  }, [locked, closed, readOnlyHint, selectedVersion, clearEditingIdleTimer, setLocalEditing]);

  useEffect(() => () => {
    if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
    clearEditingIdleTimer();
    setLocalEditing(false);
  }, [clearEditingIdleTimer, setLocalEditing]);

  function onTextChange(event) {
    if (readOnly || applyingRemoteRef.current) return;
    const next = event.target.value.slice(0, MAX_PROMPT_LENGTH);
    setText(next);
    markEditingActive();
    const ytext = ytextRef.current || ensureDoc().ytext;
    try {
      applyLocalTextDiff(ytext, next, 'local');
      scheduleSnapshot();
    } catch (err) {
      setError(err?.message || 'Could not apply edit.');
    }
  }

  async function finalize() {
    if (readOnly) return;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      if (snapshotTimerRef.current) {
        clearTimeout(snapshotTimerRef.current);
        await persistSnapshot();
      }
      const content = getPromptText(ensureDoc().doc);
      const response = await fetch(`/api/rooms/${encodeURIComponent(slug)}/prompt/finalize`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content,
          name: versionName,
          finalizedBy: displayName,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'Could not finalize prompt.');
        if (data.code === 'PROMPT_LOCKED') setLocked(true);
        if (data.code === 'ROOM_ENDED') setRoomStatus('ended');
        if (data.code === 'ROOM_EXPIRED') setRoomStatus('expired');
        return;
      }
      setStatus(`Finalized ${data.name || `v${data.version}`}.`);
      setVersionName('');
      await loadWorkspace({ applyToDoc: false });
    } catch {
      setError('Could not finalize prompt.');
    } finally {
      setBusy(false);
    }
  }

  async function copyPrompt() {
    const value = selectedVersion?.prompt ?? text;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('Could not copy prompt.');
    }
  }

  function selectVersion(version) {
    setSelectedVersion(version);
    setStatus(`Viewing ${version.name || `v${version.version}`} (read-only).`);
  }

  function returnToDraft() {
    setSelectedVersion(null);
    setStatus('Returned to current shared draft.');
    syncTextareaFromYjs();
  }

  if (!slug) {
    return (
      <div className="panel">
        <p>Shared prompt workspace loads after you join a room.</p>
      </div>
    );
  }

  const displayText = selectedVersion ? (selectedVersion.prompt || '') : text;
  const editorCount = editors.length;
  const saveLabel = saveState === 'saving'
    ? 'Saving…'
    : saveState === 'error'
      ? 'Save failed'
      : saveState === 'dirty'
        ? 'Unsaved changes'
        : formatSavedAgo(savedAt, nowTick) || (revision > 0 ? 'Saved' : 'Not saved yet');

  const collabLabel = collabState === 'reconnecting'
    ? 'Collaboration reconnecting…'
    : collabState === 'disconnected'
      ? 'Collaboration disconnected'
      : collabState === 'error'
        ? 'Collaboration connection failed'
        : collabState === 'synced' || collabState === 'connected'
          ? 'Live collaboration'
          : collaborative
            ? 'Connecting collaboration…'
            : 'Snapshot view';

  return (
    <div className="panel prompt-panel" data-testid="shared-prompt-editor">
      <div className="prompt-header">
        <h2>Shared Prompt</h2>
        <p className="hint prompt-presence" data-testid="prompt-presence">
          {editorCount > 0 ? (
            <>
              <span className="prompt-presence-dot" aria-hidden>●</span>
              {' '}
              {editorCount}
              {' '}
              {editorCount === 1 ? 'person' : 'people'}
              {' '}
              editing
              {editors.length ? `: ${editors.join(', ')}` : ''}
            </>
          ) : (
            collabLabel
          )}
        </p>
      </div>

      <div className="prompt-meta-row" data-testid="prompt-save-state">
        <span>{saveLabel}</span>
        <span data-testid="prompt-char-count">{formatCharCount(displayText.length)}</span>
        <span>
          {readOnly
            ? `Read-only (${roomStatus === 'active' ? 'locked by owner' : roomStatus})`
            : `Revision ${revision}`}
        </span>
      </div>

      {collabState === 'reconnecting' ? (
        <p className="hint" role="status">Reconnecting…</p>
      ) : null}

      {error ? <p className="error" role="alert">{error}</p> : null}
      {status ? <p className="hint" role="status">{status}</p> : null}

      <div className="prompt-form">
        <label>
          {selectedVersion
            ? `${selectedVersion.name || `v${selectedVersion.version}`} (history)`
            : 'Current shared draft'}
          <textarea
            value={displayText}
            onChange={onTextChange}
            onFocus={() => {
              if (!readOnly) markEditingActive();
            }}
            onBlur={() => {
              clearEditingIdleTimer();
              setLocalEditing(false);
            }}
            rows={6}
            disabled={readOnly || busy}
            maxLength={MAX_PROMPT_LENGTH}
            data-testid="prompt-textarea"
          />
        </label>

        <div className="prompt-actions">
          <button type="button" onClick={copyPrompt} data-testid="prompt-copy">
            {copied ? 'Copied' : 'Copy Prompt'}
          </button>
          {!selectedVersion ? (
            <>
              <input
                type="text"
                className="prompt-version-name"
                value={versionName}
                onChange={(e) => setVersionName(e.target.value)}
                placeholder="Version name (optional)"
                maxLength={120}
                disabled={readOnly || busy}
                aria-label="Version name"
                data-testid="prompt-version-name"
              />
              <button
                type="button"
                onClick={finalize}
                disabled={readOnly || busy || !text.trim()}
                data-testid="prompt-finalize"
              >
                {busy ? 'Finalizing…' : 'Finalize Prompt'}
              </button>
            </>
          ) : (
            <button type="button" onClick={returnToDraft} data-testid="prompt-return-draft">
              Return to current draft
            </button>
          )}
        </div>
      </div>

      {versions.length > 0 ? (
        <div className="prompt-history" data-testid="prompt-history">
          <h3>Prompt History</h3>
          <ul>
            {versions.map((v) => {
              const active = selectedVersion
                && (selectedVersion.id === v.id || selectedVersion.version === v.version);
              return (
                <li key={v.id || v.version}>
                  <button
                    type="button"
                    className={`prompt-history-item${active ? ' selected' : ''}`}
                    aria-pressed={Boolean(active)}
                    onClick={() => selectVersion(v)}
                  >
                    {`v${v.version}${v.name ? ` — ${v.name}` : ''}`}
                    {v.finalizedBy ? ` · by ${v.finalizedBy}` : ''}
                    {v.createdAt ? ` · ${new Date(v.createdAt).toLocaleString()}` : ''}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <PromptRunRecorder
        slug={slug}
        displayName={displayName}
        versions={versions}
      />
    </div>
  );
}

export default SharedPromptEditor;
