import React, { useEffect, useRef, useState } from 'react';

const POLL_MS = 1500;
const SAVE_DEBOUNCE_MS = 400;
const MAX_JPEG_BYTES = 5 * 1024 * 1024;

function authHeaders(session, { json = true } = {}) {
  const headers = {
    'x-participant-identity': session.identity,
    'x-leave-key': session.leaveKey,
  };
  if (json) headers['content-type'] = 'application/json';
  return headers;
}

function formatBytes(size) {
  if (size < 1024) return size + ' B';
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
  return (size / (1024 * 1024)).toFixed(1) + ' MB';
}

function fileToJpegBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected JPEG.'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

export function PromptWorkspace({ session }) {
  const [draft, setDraft] = useState('');
  const [baseline, setBaseline] = useState('');
  const [version, setVersion] = useState(0);
  const [versions, setVersions] = useState([]);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dirtyRef = useRef(false);
  const draftRef = useRef('');
  const saveTimer = useRef(null);

  const [runs, setRuns] = useState([]);
  const [recording, setRecording] = useState(false);
  const [runPromptVersion, setRunPromptVersion] = useState('');
  const [runStatus, setRunStatus] = useState('');
  const [runNotes, setRunNotes] = useState('');
  const [jpegFile, setJpegFile] = useState(null);
  const [jpegPreviewUrl, setJpegPreviewUrl] = useState('');
  const [savingRun, setSavingRun] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [runDetail, setRunDetail] = useState(null);
  const [runImageUrl, setRunImageUrl] = useState('');
  const runImageUrlRef = useRef('');

  dirtyRef.current = draft !== baseline;
  draftRef.current = draft;

  function applyState(data) {
    setVersion(data.version);
    setVersions(data.versions || []);
    if (!dirtyRef.current) {
      setDraft(data.draft);
      setBaseline(data.draft);
      draftRef.current = data.draft;
    }
  }

  async function loadRuns({ quiet = false } = {}) {
    try {
      const response = await fetch('/api/rooms/' + encodeURIComponent(session.roomName) + '/runs', {
        headers: authHeaders(session),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not load run history.');
      setRuns(data.runs || []);
    } catch (err) {
      if (!quiet) setError(err.message || 'Could not load run history.');
    }
  }

  async function loadPrompt({ quiet = false } = {}) {
    try {
      const response = await fetch('/api/rooms/' + encodeURIComponent(session.roomName) + '/prompt', {
        headers: authHeaders(session),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not load the prompt.');
      applyState(data);
      if (!quiet) setError('');
    } catch (err) {
      if (!quiet) setError(err.message || 'Could not load the prompt.');
    } finally {
      setLoading(false);
    }
  }

  async function saveDraft(nextDraft = draftRef.current) {
    setSaving(true);
    try {
      const response = await fetch('/api/rooms/' + encodeURIComponent(session.roomName) + '/prompt', {
        method: 'PUT',
        headers: authHeaders(session),
        body: JSON.stringify({ draft: nextDraft }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          data.error
          || (response.status === 404
            ? 'Prompt API not found. Restart the app server (npm run dev / npm start) so it loads the latest routes.'
            : 'Could not save the draft.'),
        );
      }
      setBaseline(data.draft);
      setVersion(data.version);
      setVersions(data.versions || []);
      setError('');
      setNotice('Draft saved');
    } catch (err) {
      setError(err.message || 'Could not save the draft.');
    } finally {
      setSaving(false);
    }
  }

  function scheduleSave(nextDraft) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveDraft(nextDraft);
    }, SAVE_DEBOUNCE_MS);
  }

  function handleDraftChange(event) {
    const next = event.target.value;
    setDraft(next);
    setSelectedVersion(null);
    setNotice('');
    scheduleSave(next);
  }

  async function finalizePrompt() {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    setFinalizing(true);
    setError('');
    setNotice('');
    try {
      if (draft !== baseline) await saveDraft(draft);
      const response = await fetch(
        '/api/rooms/' + encodeURIComponent(session.roomName) + '/prompt/finalize',
        { method: 'POST', headers: authHeaders(session), body: '{}' },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not finalize the prompt.');
      setNotice('Finalized — version ' + data.version);
      setSelectedVersion(data.version);
      await loadPrompt({ quiet: true });
    } catch (err) {
      setError(err.message || 'Could not finalize the prompt.');
    } finally {
      setFinalizing(false);
    }
  }

  function openRecordForm() {
    const defaultVersion = selectedVersion || (versions.length ? versions[versions.length - 1].version : '');
    setRecording(true);
    setRunPromptVersion(defaultVersion === '' ? '' : String(defaultVersion));
    setRunStatus('');
    setRunNotes('');
    setJpegFile(null);
    if (jpegPreviewUrl) URL.revokeObjectURL(jpegPreviewUrl);
    setJpegPreviewUrl('');
    setError('');
  }

  function handleJpegChange(event) {
    const file = event.target.files?.[0] || null;
    if (jpegPreviewUrl) URL.revokeObjectURL(jpegPreviewUrl);
    setJpegPreviewUrl('');
    setJpegFile(null);
    if (!file) return;
    if (file.type !== 'image/jpeg') {
      setError('Select a JPEG image (image/jpeg).');
      event.target.value = '';
      return;
    }
    if (file.size > MAX_JPEG_BYTES) {
      setError('JPEG must be 5 MB or smaller.');
      event.target.value = '';
      return;
    }
    setError('');
    setJpegFile(file);
    setJpegPreviewUrl(URL.createObjectURL(file));
  }

  async function saveRun(event) {
    event.preventDefault();
    if (!runPromptVersion) {
      setError('Select a finalized prompt version.');
      return;
    }
    if (!runStatus) {
      setError('Select a status of success or failure.');
      return;
    }
    if (!jpegFile) {
      setError('Choose a JPEG result image.');
      return;
    }
    setSavingRun(true);
    setError('');
    try {
      const jpegBase64 = await fileToJpegBase64(jpegFile);
      const response = await fetch('/api/rooms/' + encodeURIComponent(session.roomName) + '/runs', {
        method: 'POST',
        headers: authHeaders(session),
        body: JSON.stringify({
          promptVersion: Number(runPromptVersion),
          status: runStatus,
          notes: runNotes,
          contentType: 'image/jpeg',
          jpegBase64,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not record the manual run.');
      setNotice('Manual run recorded');
      setRecording(false);
      setSelectedRunId(data.id);
      await loadRuns({ quiet: true });
      await viewRun(data.id);
    } catch (err) {
      setError(err.message || 'Could not record the manual run.');
    } finally {
      setSavingRun(false);
    }
  }

  async function viewRun(runId) {
    setSelectedRunId(runId);
    setError('');
    try {
      const response = await fetch(
        '/api/rooms/' + encodeURIComponent(session.roomName) + '/runs/' + encodeURIComponent(runId),
        { headers: authHeaders(session) },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not load the run.');
      setRunDetail(data);

      const imageResponse = await fetch(
        '/api/rooms/' + encodeURIComponent(session.roomName) + '/runs/' + encodeURIComponent(runId) + '/image',
        { headers: authHeaders(session, { json: false }) },
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
      setError(err.message || 'Could not load the run.');
    }
  }

  useEffect(() => {
    loadPrompt();
    loadRuns({ quiet: true });
    const timer = setInterval(() => {
      loadPrompt({ quiet: true });
      loadRuns({ quiet: true });
    }, POLL_MS);
    return () => {
      clearInterval(timer);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (jpegPreviewUrl) URL.revokeObjectURL(jpegPreviewUrl);
      if (runImageUrlRef.current) URL.revokeObjectURL(runImageUrlRef.current);
    };
  }, [session.identity, session.leaveKey, session.roomName]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 2500);
    return () => clearTimeout(timer);
  }, [notice]);

  const viewing = selectedVersion == null
    ? null
    : versions.find(entry => entry.version === selectedVersion) || null;
  const selectedPromptForRun = versions.find(entry => String(entry.version) === String(runPromptVersion));

  return (
    <section className="prompt-workspace" aria-label="Collaborative prompt">
      <div className="section-heading">
        <h2>Collaborative Prompt</h2>
        <p className="prompt-meta" role="status">
          Status: {viewing ? 'Finalized' : 'Draft'}
          {version > 0 ? ' · Version: ' + (viewing ? viewing.version : version) : ' · No finalized versions yet'}
          {saving ? ' · Saving…' : ''}
        </p>
      </div>

      {loading ? <p className="hint">Loading shared prompt…</p> : (
        <>
          <label className="prompt-editor-label">
            {viewing ? 'Finalized prompt (read-only)' : 'Shared draft'}
            <textarea
              className="prompt-editor"
              value={viewing ? viewing.prompt : draft}
              onChange={handleDraftChange}
              readOnly={!!viewing}
              rows={8}
              spellCheck={false}
              placeholder="Write the shared prompt here. Everyone in the room edits this draft together."
            />
          </label>

          <div className="prompt-actions">
            {viewing ? (
              <button type="button" onClick={() => setSelectedVersion(null)}>Return to draft</button>
            ) : (
              <button type="button" onClick={finalizePrompt} disabled={finalizing || saving}>
                {finalizing ? 'Finalizing…' : 'Finalize Prompt'}
              </button>
            )}
            {versions.length > 0 && (
              <button type="button" onClick={openRecordForm} disabled={recording}>
                Record Manual Run
              </button>
            )}
            {notice && <p className="hint" role="status">{notice}</p>}
          </div>

          {versions.length > 0 && (
            <div className="prompt-history">
              <h3>Finalized versions</h3>
              <ul>
                {versions.slice().reverse().map(entry => (
                  <li key={entry.version}>
                    <button
                      type="button"
                      className={'prompt-version' + (selectedVersion === entry.version ? ' selected' : '')}
                      aria-pressed={selectedVersion === entry.version}
                      onClick={() => setSelectedVersion(entry.version)}
                    >
                      Version {entry.version}
                      <span>
                        {new Date(entry.createdAt).toLocaleString()}
                        {entry.finalizedBy ? ' · ' + entry.finalizedBy : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {recording && (
            <form className="run-form" onSubmit={saveRun} aria-label="Record manual run">
              <h3>Record Manual Run</h3>
              <p className="hint">
                Execution is manual. Copy the finalized prompt into Cursor on your computer, run it yourself,
                then upload a JPEG of the result here. This app does not execute commands or control Cursor.
              </p>
              <label>
                Prompt version
                <select
                  value={runPromptVersion}
                  onChange={event => setRunPromptVersion(event.target.value)}
                  required
                >
                  <option value="" disabled>Select a finalized version</option>
                  {versions.slice().reverse().map(entry => (
                    <option key={entry.version} value={entry.version}>Version {entry.version}</option>
                  ))}
                </select>
              </label>
              {selectedPromptForRun && (
                <label className="prompt-editor-label">
                  Prompt snapshot (read-only)
                  <textarea className="prompt-editor" value={selectedPromptForRun.prompt} readOnly rows={5} />
                </label>
              )}
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
                <input type="file" accept="image/jpeg,.jpg,.jpeg" onChange={handleJpegChange} />
              </label>
              {jpegFile && (
                <div className="jpeg-preview">
                  {jpegPreviewUrl && <img src={jpegPreviewUrl} alt="Selected JPEG preview" />}
                  <p className="hint">{jpegFile.name} · {formatBytes(jpegFile.size)}</p>
                </div>
              )}
              <label>
                Notes (optional)
                <textarea value={runNotes} onChange={event => setRunNotes(event.target.value)} rows={3} maxLength={2000} />
              </label>
              <div className="prompt-actions">
                <button type="submit" disabled={savingRun}>{savingRun ? 'Saving…' : 'Save Run'}</button>
                <button type="button" className="secondary" onClick={() => setRecording(false)} disabled={savingRun}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          <div className="run-history" aria-label="Run history">
            <h3>Run History</h3>
            {runs.length === 0 ? (
              <p className="hint">No manual runs recorded yet. Finalize a prompt, run it yourself, then record the result.</p>
            ) : (
              <ul>
                {runs.map(run => (
                  <li key={run.id}>
                    <div className={'run-card' + (selectedRunId === run.id ? ' selected' : '')}>
                      <div>
                        <strong>Run #{run.id.slice(0, 12)}</strong>
                        <p className="hint">
                          Prompt v{run.promptVersion} · Executed by: {run.executedBy}
                          <br />
                          {new Date(run.executedAt).toLocaleString()} · Status: {run.status.toUpperCase()}
                        </p>
                      </div>
                      <button type="button" onClick={() => viewRun(run.id)}>View Result</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {runDetail && (
            <div className="run-detail" aria-label="Run detail">
              <div className="section-heading">
                <h3>Run detail</h3>
                <button type="button" className="secondary" onClick={() => {
                  setRunDetail(null);
                  setSelectedRunId(null);
                  if (runImageUrlRef.current) URL.revokeObjectURL(runImageUrlRef.current);
                  runImageUrlRef.current = '';
                  setRunImageUrl('');
                }}>
                  Close
                </button>
              </div>
              <dl className="run-meta">
                <div><dt>Run ID</dt><dd>{runDetail.id}</dd></div>
                <div><dt>Prompt version</dt><dd>{runDetail.promptVersion}</dd></div>
                <div><dt>Executed by</dt><dd>{runDetail.executedBy}</dd></div>
                <div><dt>Executed at</dt><dd>{new Date(runDetail.executedAt).toLocaleString()}</dd></div>
                <div><dt>Status</dt><dd>{runDetail.status.toUpperCase()}</dd></div>
                {runDetail.notes ? <div><dt>Notes</dt><dd>{runDetail.notes}</dd></div> : null}
              </dl>
              <label className="prompt-editor-label">
                Prompt snapshot
                <textarea className="prompt-editor" value={runDetail.promptSnapshot} readOnly rows={5} />
              </label>
              {runImageUrl && (
                <div className="jpeg-preview">
                  <img src={runImageUrl} alt={'Result for run ' + runDetail.id} />
                </div>
              )}
            </div>
          )}
        </>
      )}

      {error && <p role="alert" className="error">{error}</p>}
    </section>
  );
}
