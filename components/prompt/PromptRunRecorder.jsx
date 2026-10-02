'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const MAX_JPEG_BYTES = 5 * 1024 * 1024;
const MAX_NOTES = 2000;
const ALL_MEMBERS = '';

function formatBytes(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function fileToJpegDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected JPEG.'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

function sameName(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

/**
 * Work log: manual prompt-run results and work-progress uploads, each with a JPEG,
 * plus a per-person history view (pick a team member at the top).
 * Execution stays manual — upload a JPEG of the result after running the prompt yourself.
 */
export function PromptRunRecorder({
  slug,
  displayName = 'Participant',
  versions = [],
}) {
  const [runs, setRuns] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [memberFilter, setMemberFilter] = useState(ALL_MEMBERS);
  const [recording, setRecording] = useState(false);
  const [runKind, setRunKind] = useState('run');
  const [runPromptVersion, setRunPromptVersion] = useState('');
  const [runStatus, setRunStatus] = useState('success');
  const [runNotes, setRunNotes] = useState('');
  const [jpegFile, setJpegFile] = useState(null);
  const [jpegPreviewUrl, setJpegPreviewUrl] = useState('');
  const [savingRun, setSavingRun] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [runDetail, setRunDetail] = useState(null);
  const [runImageUrl, setRunImageUrl] = useState('');
  const [loadingRunId, setLoadingRunId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [portalReady, setPortalReady] = useState(false);
  const runImageUrlRef = useRef('');
  const closeButtonRef = useRef(null);
  const runDetailTitleId = useId();

  useEffect(() => {
    setPortalReady(true);
  }, []);

  const loadRuns = useCallback(async ({ quiet = false } = {}) => {
    if (!slug) return;
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(slug)}/runs`, {
        credentials: 'same-origin',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not load run history.');
      setRuns(Array.isArray(data.runs) ? data.runs : []);
      setTeamMembers(Array.isArray(data.teamMembers) ? data.teamMembers : []);
      if (!quiet) setError('');
    } catch (err) {
      if (!quiet) setError(err.message || 'Could not load run history.');
    }
  }, [slug]);

  useEffect(() => {
    loadRuns({ quiet: true });
  }, [loadRuns]);

  useEffect(() => () => {
    if (jpegPreviewUrl) URL.revokeObjectURL(jpegPreviewUrl);
    if (runImageUrlRef.current) URL.revokeObjectURL(runImageUrlRef.current);
  }, [jpegPreviewUrl]);

  // People to choose from: the configured roster, else everyone who has saved something.
  const filterMembers = useMemo(() => {
    if (teamMembers.length) return teamMembers;
    const names = [];
    for (const name of [
      ...runs.map((run) => run.executedBy),
      ...versions.map((entry) => entry.finalizedBy),
    ]) {
      if (name && !names.some((existing) => sameName(existing, name))) names.push(name);
    }
    return names;
  }, [teamMembers, runs, versions]);

  const visibleRuns = memberFilter
    ? runs.filter((run) => sameName(run.executedBy, memberFilter))
    : runs;
  const memberPrompts = memberFilter
    ? versions.filter((entry) => sameName(entry.finalizedBy, memberFilter))
    : [];

  function openRecordForm() {
    const defaultVersion = versions[0]?.version || '';
    setRunKind(versions.length ? 'run' : 'progress');
    setRunPromptVersion(defaultVersion ? String(defaultVersion) : '');
    setRunStatus('success');
    setRunNotes('');
    setJpegFile(null);
    if (jpegPreviewUrl) URL.revokeObjectURL(jpegPreviewUrl);
    setJpegPreviewUrl('');
    setRecording(true);
    setNotice('');
    setError('');
  }

  function handleJpegChange(event) {
    const file = event.target.files?.[0] || null;
    if (jpegPreviewUrl) URL.revokeObjectURL(jpegPreviewUrl);
    setJpegPreviewUrl('');
    setJpegFile(null);
    setError('');
    if (!file) return;
    if (file.type !== 'image/jpeg') {
      setError('Select a JPEG image (image/jpeg).');
      return;
    }
    if (file.size > MAX_JPEG_BYTES) {
      setError('JPEG must be 5 MB or smaller.');
      return;
    }
    setJpegFile(file);
    setJpegPreviewUrl(URL.createObjectURL(file));
  }

  async function saveRun(event) {
    event.preventDefault();
    const isRun = runKind === 'run';
    if (!jpegFile) {
      setError('Choose a JPEG image.');
      return;
    }
    if (isRun && !runPromptVersion) {
      setError('Select a finalized prompt version.');
      return;
    }
    setSavingRun(true);
    setError('');
    setNotice('');
    try {
      const jpegBase64 = await fileToJpegDataUrl(jpegFile);
      const payload = {
        kind: runKind,
        notes: runNotes,
        jpegBase64,
        contentType: 'image/jpeg',
        executedBy: displayName,
      };
      if (isRun) {
        payload.promptVersion = Number(runPromptVersion);
        payload.status = runStatus;
      }
      const response = await fetch(`/api/rooms/${encodeURIComponent(slug)}/runs`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not save run.');
      setNotice(isRun ? `Saved result for prompt v${runPromptVersion}.` : 'Saved work progress.');
      setRecording(false);
      setJpegFile(null);
      if (jpegPreviewUrl) URL.revokeObjectURL(jpegPreviewUrl);
      setJpegPreviewUrl('');
      await loadRuns({ quiet: true });
    } catch (err) {
      setError(err.message || 'Could not save run.');
    } finally {
      setSavingRun(false);
    }
  }

  async function viewRun(runId) {
    setError('');
    setLoadingRunId(runId);
    if (runImageUrlRef.current) URL.revokeObjectURL(runImageUrlRef.current);
    runImageUrlRef.current = '';
    setRunImageUrl('');
    try {
      const response = await fetch(
        `/api/rooms/${encodeURIComponent(slug)}/runs/${encodeURIComponent(runId)}`,
        { credentials: 'same-origin' },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not load run.');
      setSelectedRunId(runId);
      setRunDetail(data);

      const imageResponse = await fetch(
        `/api/rooms/${encodeURIComponent(slug)}/runs/${encodeURIComponent(runId)}/image`,
        { credentials: 'same-origin' },
      );
      if (!imageResponse.ok) {
        const imageError = await imageResponse.json().catch(() => ({}));
        throw new Error(imageError.error || 'Could not load the run image.');
      }
      const blob = await imageResponse.blob();
      if (runImageUrlRef.current) URL.revokeObjectURL(runImageUrlRef.current);
      const url = URL.createObjectURL(blob);
      runImageUrlRef.current = url;
      setRunImageUrl(url);
    } catch (err) {
      setError(err.message || 'Could not load run.');
      setRunDetail(null);
      setSelectedRunId(null);
    } finally {
      setLoadingRunId(null);
    }
  }

  const closeRunDetail = useCallback(() => {
    setRunDetail(null);
    setSelectedRunId(null);
    if (runImageUrlRef.current) URL.revokeObjectURL(runImageUrlRef.current);
    runImageUrlRef.current = '';
    setRunImageUrl('');
  }, []);

  useEffect(() => {
    if (!runDetail) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRunDetail();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [runDetail, closeRunDetail]);

  const selectedPromptForRun = versions.find((entry) => String(entry.version) === String(runPromptVersion));
  const detailIsRun = runDetail?.kind !== 'progress';
  const runStatusLabel = String(runDetail?.status || '').toUpperCase();
  const runStatusTone = runStatusLabel === 'FAILURE' ? 'failure' : 'success';

  const runDetailModal = runDetail && portalReady
    ? createPortal(
      <div
        className="run-detail-overlay"
        role="presentation"
        onClick={closeRunDetail}
      >
        <div
          className="run-detail-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby={runDetailTitleId}
          aria-label="Run detail"
          onClick={(event) => event.stopPropagation()}
        >
          <header className="run-detail-modal__header">
            <div className="run-detail-modal__title-block">
              <h3 id={runDetailTitleId}>{detailIsRun ? 'Run detail' : 'Work progress'}</h3>
              {detailIsRun ? (
                <span className={`run-detail-status run-detail-status--${runStatusTone}`}>
                  {runStatusLabel || 'UNKNOWN'}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              className="run-detail-modal__close"
              onClick={closeRunDetail}
              ref={closeButtonRef}
              aria-label="Close run detail"
            >
              ×
            </button>
          </header>

          <div className="run-detail-modal__body">
            <div className="run-detail-modal__media">
              {runImageUrl ? (
                <img src={runImageUrl} alt={`Image for entry ${runDetail.id}`} />
              ) : (
                <p className="hint">Loading image…</p>
              )}
            </div>

            <div className="run-detail-modal__sidebar">
              <dl className="run-meta">
                {detailIsRun ? (
                  <div>
                    <dt>Prompt version</dt>
                    <dd>v{runDetail.promptVersion}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Saved by</dt>
                  <dd>{runDetail.executedBy}</dd>
                </div>
                {runDetail.executedAt ? (
                  <div>
                    <dt>Saved at</dt>
                    <dd>{new Date(runDetail.executedAt).toLocaleString()}</dd>
                  </div>
                ) : null}
                {runDetail.notes ? (
                  <div>
                    <dt>Notes</dt>
                    <dd>{runDetail.notes}</dd>
                  </div>
                ) : null}
              </dl>

              {runDetail.promptSnapshot ? (
                <label className="run-detail-snapshot">
                  Prompt snapshot
                  <textarea value={runDetail.promptSnapshot} readOnly rows={8} />
                </label>
              ) : null}
            </div>
          </div>
        </div>
      </div>,
      document.body,
    )
    : null;

  return (
    <div className="prompt-runs" data-testid="prompt-runs">
      <div className="prompt-runs-heading">
        <h3>Work log</h3>
        {!recording ? (
          <button type="button" className="prompt-runs-record" onClick={openRecordForm} data-testid="prompt-record-run">
            Add image
          </button>
        ) : null}
      </div>
      <p className="hint">
        Attach a JPEG of a prompt result or of your own work progress. This app does not execute prompts.
      </p>

      {error ? <p className="error" role="alert">{error}</p> : null}
      {notice ? <p className="hint" role="status">{notice}</p> : null}

      {recording ? (
        <form className="run-form" onSubmit={saveRun} aria-label="Add work log image">
          <fieldset className="run-status">
            <legend>Type</legend>
            <label>
              <input
                type="radio"
                name="run-kind"
                value="run"
                checked={runKind === 'run'}
                onChange={() => setRunKind('run')}
                disabled={!versions.length}
              />
              Prompt result
            </label>
            <label>
              <input
                type="radio"
                name="run-kind"
                value="progress"
                checked={runKind === 'progress'}
                onChange={() => setRunKind('progress')}
              />
              Work progress
            </label>
          </fieldset>
          {!versions.length ? (
            <p className="hint">Finalize a prompt version to record a prompt result.</p>
          ) : null}

          {runKind === 'run' ? (
            <>
              <label>
                Prompt version
                <select
                  value={runPromptVersion}
                  onChange={(event) => setRunPromptVersion(event.target.value)}
                  required
                  data-testid="prompt-run-version"
                >
                  <option value="" disabled>Select a finalized version</option>
                  {versions.map((entry) => (
                    <option key={entry.version} value={entry.version}>
                      {`v${entry.version}${entry.name ? ` — ${entry.name}` : ''}`}
                    </option>
                  ))}
                </select>
              </label>

              {selectedPromptForRun ? (
                <label>
                  Prompt snapshot (read-only)
                  <textarea value={selectedPromptForRun.prompt || ''} readOnly rows={4} />
                </label>
              ) : null}

              <fieldset className="run-status">
                <legend>Status</legend>
                <label>
                  <input
                    type="radio"
                    name="run-status"
                    value="success"
                    checked={runStatus === 'success'}
                    onChange={() => setRunStatus('success')}
                  />
                  Success
                </label>
                <label>
                  <input
                    type="radio"
                    name="run-status"
                    value="failure"
                    checked={runStatus === 'failure'}
                    onChange={() => setRunStatus('failure')}
                  />
                  Failure
                </label>
              </fieldset>
            </>
          ) : null}

          <label>
            JPEG image
            <input
              type="file"
              accept="image/jpeg,.jpg,.jpeg"
              onChange={handleJpegChange}
              data-testid="prompt-run-jpeg"
            />
          </label>
          {jpegFile ? (
            <div className="jpeg-preview">
              {jpegPreviewUrl ? <img src={jpegPreviewUrl} alt="Selected JPEG preview" /> : null}
              <p className="hint">{jpegFile.name} · {formatBytes(jpegFile.size)}</p>
            </div>
          ) : null}

          <label>
            Notes (optional)
            <textarea
              value={runNotes}
              onChange={(event) => setRunNotes(event.target.value)}
              rows={3}
              maxLength={MAX_NOTES}
            />
          </label>

          <p className="hint">Saved as {displayName}.</p>

          <div className="prompt-actions">
            <button type="submit" disabled={savingRun} data-testid="prompt-run-save">
              {savingRun ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setRecording(false)}
              disabled={savingRun}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <div className="run-history" aria-label="Work history">
        <h4>History</h4>

        {filterMembers.length ? (
          <div className="run-member-filter" role="group" aria-label="Show history for" data-testid="run-member-filter">
            <button
              type="button"
              className={memberFilter === ALL_MEMBERS ? 'active' : ''}
              aria-pressed={memberFilter === ALL_MEMBERS}
              onClick={() => setMemberFilter(ALL_MEMBERS)}
            >
              Everyone
            </button>
            {filterMembers.map((member) => (
              <button
                key={member}
                type="button"
                className={sameName(memberFilter, member) ? 'active' : ''}
                aria-pressed={sameName(memberFilter, member)}
                onClick={() => setMemberFilter(member)}
              >
                {member}
              </button>
            ))}
          </div>
        ) : null}

        {memberFilter ? (
          <div className="run-member-prompts">
            <h4>Prompts saved by {memberFilter}</h4>
            {memberPrompts.length === 0 ? (
              <p className="hint">No prompt versions saved yet.</p>
            ) : (
              <ul>
                {memberPrompts.map((entry) => (
                  <li key={entry.version}>
                    <details className="run-prompt-entry">
                      <summary>
                        {`v${entry.version}${entry.name ? ` — ${entry.name}` : ''}`}
                        {entry.createdAt ? ` · ${new Date(entry.createdAt).toLocaleString()}` : ''}
                      </summary>
                      <pre>{entry.prompt}</pre>
                    </details>
                  </li>
                ))}
              </ul>
            )}
            <h4>Images saved by {memberFilter}</h4>
          </div>
        ) : null}

        {visibleRuns.length === 0 ? (
          <p className="hint">No images recorded yet.</p>
        ) : (
          <ul>
            {visibleRuns.map((run) => (
              <li key={run.id}>
                <div className={`run-card${selectedRunId === run.id ? ' selected' : ''}`}>
                  <div>
                    <strong>
                      {run.kind === 'progress' ? 'Work progress' : `Prompt v${run.promptVersion} result`}
                    </strong>
                    <p className="hint">
                      {run.executedBy}
                      {run.kind === 'progress' ? '' : ` · ${String(run.status || '').toUpperCase()}`}
                      <br />
                      {run.executedAt ? new Date(run.executedAt).toLocaleString() : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => viewRun(run.id)}
                    disabled={loadingRunId === run.id}
                  >
                    {loadingRunId === run.id ? 'Opening…' : 'View'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {runDetailModal}
    </div>
  );
}

export default PromptRunRecorder;
