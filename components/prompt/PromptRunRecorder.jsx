'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const MAX_JPEG_BYTES = 5 * 1024 * 1024;
const MAX_NOTES = 2000;

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

/**
 * Manual run recorder + JPEG result capture (from the legacy prompt workspace).
 * Execution stays manual — upload a JPEG of the result after running the prompt yourself.
 */
export function PromptRunRecorder({
  slug,
  displayName = 'Participant',
  versions = [],
}) {
  const [runs, setRuns] = useState([]);
  const [recording, setRecording] = useState(false);
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
  }, [jpegPreviewUrl]);

  useEffect(() => () => {
    if (runImageUrlRef.current) URL.revokeObjectURL(runImageUrlRef.current);
  }, []);

  function openRecordForm() {
    const defaultVersion = versions[0]?.version || '';
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
    if (!jpegFile) {
      setError('Choose a JPEG result image.');
      return;
    }
    if (!runPromptVersion) {
      setError('Select a finalized prompt version.');
      return;
    }
    setSavingRun(true);
    setError('');
    setNotice('');
    try {
      const jpegBase64 = await fileToJpegDataUrl(jpegFile);
      const response = await fetch(`/api/rooms/${encodeURIComponent(slug)}/runs`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          promptVersion: Number(runPromptVersion),
          status: runStatus,
          notes: runNotes,
          jpegBase64,
          contentType: 'image/jpeg',
          executedBy: displayName,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not save run.');
      setNotice(`Saved run for prompt v${runPromptVersion}.`);
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

  if (!versions.length) {
    return (
      <div className="prompt-runs" data-testid="prompt-runs">
        <h3>Result images</h3>
        <p className="hint">
          Finalize a prompt version first, then you can record a manual run and attach a JPEG of the result.
        </p>
      </div>
    );
  }

  const selectedPromptForRun = versions.find((entry) => String(entry.version) === String(runPromptVersion));
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
              <h3 id={runDetailTitleId}>Run detail</h3>
              <span className={`run-detail-status run-detail-status--${runStatusTone}`}>
                {runStatusLabel || 'UNKNOWN'}
              </span>
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
                <img src={runImageUrl} alt={`Result for run ${runDetail.id}`} />
              ) : (
                <p className="hint">Loading result image…</p>
              )}
            </div>

            <div className="run-detail-modal__sidebar">
              <dl className="run-meta">
                <div>
                  <dt>Prompt version</dt>
                  <dd>v{runDetail.promptVersion}</dd>
                </div>
                <div>
                  <dt>Executed by</dt>
                  <dd>{runDetail.executedBy}</dd>
                </div>
                {runDetail.executedAt ? (
                  <div>
                    <dt>Executed at</dt>
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
        <h3>Result images</h3>
        {!recording ? (
          <button type="button" className="prompt-runs-record" onClick={openRecordForm} data-testid="prompt-record-run">
            Record result
          </button>
        ) : null}
      </div>
      <p className="hint">
        Run the finalized prompt yourself, then upload a JPEG of the result. This app does not execute prompts.
      </p>

      {error ? <p className="error" role="alert">{error}</p> : null}
      {notice ? <p className="hint" role="status">{notice}</p> : null}

      {recording ? (
        <form className="run-form" onSubmit={saveRun} aria-label="Record manual run">
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

          <label>
            Result JPEG
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

          <div className="prompt-actions">
            <button type="submit" disabled={savingRun} data-testid="prompt-run-save">
              {savingRun ? 'Saving…' : 'Save run'}
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

      <div className="run-history" aria-label="Run history">
        <h4>Run history</h4>
        {runs.length === 0 ? (
          <p className="hint">No result images recorded yet.</p>
        ) : (
          <ul>
            {runs.map((run) => (
              <li key={run.id}>
                <div className={`run-card${selectedRunId === run.id ? ' selected' : ''}`}>
                  <div>
                    <strong>Run #{String(run.id).slice(0, 12)}</strong>
                    <p className="hint">
                      Prompt v{run.promptVersion} · {run.executedBy}
                      <br />
                      {run.executedAt ? new Date(run.executedAt).toLocaleString() : ''}
                      {' · '}
                      {String(run.status || '').toUpperCase()}
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
