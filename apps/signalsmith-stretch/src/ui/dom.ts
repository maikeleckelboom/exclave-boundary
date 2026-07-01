export interface AppElements {
  readonly alignedSourceMode: HTMLInputElement;
  readonly appliedSequence: HTMLElement;
  readonly adapterAvailability: HTMLElement;
  readonly controlGrid: HTMLElement;
  readonly controlsHint: HTMLElement;
  readonly clearClipButton: HTMLButtonElement;
  readonly clearLoopButton: HTMLButtonElement;
  readonly blockMs: HTMLInputElement;
  readonly blockMsNumber: HTMLInputElement;
  readonly commandDrops: HTMLElement;
  readonly configPreset: HTMLSelectElement;
  readonly engineConfigFields: HTMLElement;
  readonly faultButton: HTMLButtonElement;
  readonly fileInput: HTMLInputElement;
  readonly formantBase: HTMLInputElement;
  readonly formantBaseAuto: HTMLInputElement;
  readonly formantBaseValue: HTMLElement;
  readonly formantCompensation: HTMLInputElement;
  readonly formantShift: HTMLInputElement;
  readonly formantShiftValue: HTMLElement;
  readonly inspector: HTMLElement;
  readonly levelsPanel: HTMLElement;
  readonly listeningPreset: HTMLSelectElement;
  readonly levelsSummary: HTMLElement;
  readonly loopApplied: HTMLElement;
  readonly loopAppliedSummary: HTMLElement;
  readonly loopDraft: HTMLElement;
  readonly loopCacheCoverage: HTMLElement;
  readonly loopEnd: HTMLInputElement;
  readonly loopEndValue: HTMLElement;
  readonly loopSourceFrame: HTMLElement;
  readonly loopStart: HTMLInputElement;
  readonly loopStartValue: HTMLElement;
  readonly loopValidation: HTMLElement;
  readonly markLoopEndButton: HTMLButtonElement;
  readonly markLoopStartButton: HTMLButtonElement;
  readonly metadata: HTMLElement;
  readonly intervalMs: HTMLInputElement;
  readonly overlap: HTMLInputElement;
  readonly overlapNumber: HTMLInputElement;
  readonly pauseButton: HTMLButtonElement;
  readonly pendingState: HTMLElement;
  readonly pitch: HTMLInputElement;
  readonly pitchValue: HTMLElement;
  readonly playButton: HTMLButtonElement;
  readonly playLoopButton: HTMLButtonElement;
  readonly playhead: HTMLElement;
  readonly processedMode: HTMLInputElement;
  readonly rangeMode: HTMLSelectElement;
  readonly rangeModeWarning: HTMLElement;
  readonly rate: HTMLInputElement;
  readonly rateValue: HTMLElement;
  readonly resetControlsButton: HTMLButtonElement;
  readonly resetFaultButton: HTMLButtonElement;
  readonly runtimeModeBadge: HTMLElement;
  readonly seekFrame: HTMLInputElement;
  readonly seekRange: HTMLInputElement;
  readonly setLoopButton: HTMLButtonElement;
  readonly splitCompareMode: HTMLInputElement;
  readonly splitComputation: HTMLInputElement;
  readonly shell: HTMLElement;
  readonly sourceDrop: HTMLElement;
  readonly sourcePrimary: HTMLElement;
  readonly sourceSecondary: HTMLElement;
  readonly sourceState: HTMLElement;
  readonly sourceStatusBadge: HTMLElement;
  readonly staleButton: HTMLButtonElement;
  readonly status: HTMLElement;
  readonly stopButton: HTMLButtonElement;
  readonly tonalityEnabled: HTMLInputElement;
  readonly tonalityHz: HTMLInputElement;
  readonly tonalityHzValue: HTMLElement;
  readonly transportState: HTMLElement;
  readonly waveform: HTMLCanvasElement;
  readonly waveformPanel: HTMLElement;
}

type ElementConstructor<T extends Element> = new () => T;

export function renderAppShell(root: HTMLElement): AppElements {
  root.innerHTML = `
    <div id="appShell" class="app-shell is-unloaded">
      <header class="app-header">
        <div>
          <p class="eyebrow">Exclave Boundary</p>
          <h1>Signalsmith Stretch</h1>
        </div>
        <div class="header-facts" aria-label="Runtime facts">
          <span id="runtimeModeBadge" class="mode-badge">Checking Worklet</span>
          <span id="adapterAvailability">Real adapter readiness unknown</span>
          <span id="sourceStatusBadge" class="source-status-badge">No source loaded</span>
        </div>
      </header>

      <section class="source-panel" aria-labelledby="source-title">
        <div
          id="sourceDrop"
          class="drop-surface"
          tabindex="0"
          aria-describedby="source-truth"
        >
          <div>
            <p class="section-label" id="source-title">Local source</p>
            <strong id="sourcePrimary">Drop a WAV file to begin</strong>
            <p id="sourceSecondary">Chunked WAV playback, real-time pitch and time stretch.</p>
            <p id="sourceState" class="source-state">No source loaded</p>
            <p id="source-truth">WAV recommended; PCM and float WAV files use the most direct path.</p>
          </div>
          <label class="file-picker">
            <span>Choose file</span>
            <input id="fileInput" type="file" accept="audio/*" />
          </label>
        </div>
        <div id="metadata" class="metadata-grid" aria-live="polite"></div>
      </section>

      <section id="waveformPanel" class="waveform-panel" aria-labelledby="waveform-title" hidden>
        <div class="section-heading">
          <div>
            <p class="section-label" id="waveform-title">Waveform overview</p>
            <h2>Waveform</h2>
          </div>
          <div id="playhead" class="readout"></div>
        </div>
        <canvas id="waveform" class="waveform" width="1200" height="260"></canvas>
        <div class="seek-grid">
          <label>
            <span>Seek</span>
            <input id="seekRange" type="range" min="0" max="1" step="1" value="0" />
          </label>
          <label>
            <span>Frame</span>
            <input id="seekFrame" type="number" min="0" step="1" value="0" />
          </label>
          <label>
            <span>Loop start</span>
            <input id="loopStart" type="range" min="0" max="1" step="1" value="0" />
            <output id="loopStartValue">0</output>
          </label>
          <label>
            <span>Loop end</span>
            <input id="loopEnd" type="range" min="0" max="1" step="1" value="1" />
            <output id="loopEndValue">1</output>
          </label>
        </div>
        <div class="loop-status-grid" aria-live="polite">
          <div>
            <span>Draft loop</span>
            <strong id="loopDraft">none</strong>
          </div>
          <div>
            <span>Applied loop</span>
            <strong id="loopAppliedSummary">inactive</strong>
          </div>
          <div>
            <span>Source frame</span>
            <strong id="loopSourceFrame">inactive</strong>
          </div>
          <div>
            <span>Cache coverage</span>
            <strong id="loopCacheCoverage">inactive</strong>
          </div>
          <div>
            <span>Status</span>
            <strong id="loopValidation">Mark start and end</strong>
          </div>
        </div>
      </section>

      <section class="transport-panel" aria-label="Transport">
        <div class="button-row">
          <button id="playButton" type="button">Play</button>
          <button id="pauseButton" type="button">Pause</button>
          <button id="stopButton" type="button">Stop</button>
          <button id="markLoopStartButton" type="button">Mark start</button>
          <button id="markLoopEndButton" type="button">Mark end</button>
          <button id="setLoopButton" type="button">Apply loop</button>
          <button id="playLoopButton" type="button">Play loop</button>
          <button id="clearLoopButton" type="button">Clear loop</button>
        </div>
        <p id="controlsHint" class="control-hint">Load a source to enable processing</p>
        <fieldset class="source-mode">
          <legend>Monitor</legend>
          <label>
            <input id="processedMode" type="radio" name="sourceMode" value="processed" checked />
            <span>Processed</span>
          </label>
          <label>
            <input id="alignedSourceMode" type="radio" name="sourceMode" value="aligned" />
            <span>Original preview</span>
          </label>
          <label>
            <input id="splitCompareMode" type="radio" name="sourceMode" value="split" />
            <span>Compare</span>
          </label>
        </fieldset>
      </section>

      <section id="controlGrid" class="control-grid" aria-label="Stretch controls">
        <div class="control-panel">
          <p class="section-label">Timing and pitch</p>
          <label>
            <span>Range mode</span>
            <select id="rangeMode">
              <option value="musical">Musical</option>
              <option value="extended">Extended</option>
              <option value="extreme">Extreme</option>
            </select>
          </label>
          <p id="rangeModeWarning" class="range-warning" hidden>Extreme settings are for stress testing and are not expected to sound musical.</p>
          <label>
            <span>Rate</span>
            <input id="rate" type="range" min="0.5" max="2" step="0.001" value="1" />
            <output id="rateValue">1.000x</output>
          </label>
          <label>
            <span>Pitch</span>
            <input id="pitch" type="range" min="-7" max="7" step="0.1" value="0" />
            <output id="pitchValue">0.0 st</output>
          </label>
        </div>

        <div class="control-panel">
          <p class="section-label">Voice/formant controls</p>
          <label>
            <span>Listening preset</span>
            <select id="listeningPreset">
              <option value="music-default">Music default</option>
              <option value="voice-formant-experiment">Voice/formant experiment</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <p class="control-note">Music default keeps formant changes off and leaves formant base on Auto.</p>
          <label class="toggle-row">
            <input id="tonalityEnabled" type="checkbox" checked />
            <span>Tonality enabled</span>
          </label>
          <label>
            <span>Tonality limit</span>
            <input id="tonalityHz" type="range" min="2000" max="20000" step="1" value="8000" />
            <output id="tonalityHzValue">8000 Hz</output>
          </label>
          <label>
            <span>Voice/formant shift</span>
            <input id="formantShift" type="range" min="-12" max="12" step="0.1" value="0" />
            <output id="formantShiftValue">0.0 st</output>
          </label>
          <label class="toggle-row">
            <input id="formantCompensation" type="checkbox" />
            <span>Voice compensation</span>
          </label>
          <label class="toggle-row">
            <input id="formantBaseAuto" type="checkbox" checked />
            <span>Auto formant base</span>
          </label>
          <label>
            <span>Manual voice base (advanced)</span>
            <input id="formantBase" type="range" min="50" max="500" step="1" value="120" disabled />
            <output id="formantBaseValue">Auto (0)</output>
          </label>
          <p class="control-note">Manual base is for voice/formant experiments; Auto writes 0 for Signalsmith detection.</p>
        </div>

        <div class="control-panel config-panel">
          <p class="section-label">Quality</p>
          <label>
            <span>Quality</span>
            <select id="configPreset">
              <option value="responsive">Responsive</option>
              <option value="balanced" selected>Balanced</option>
              <option value="smooth">Smooth</option>
              <option value="low-cpu">Low CPU</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <div id="engineConfigFields" class="engine-config-fields" hidden>
            <label>
              <span>Block (ms)</span>
              <div class="dual-input">
                <input id="blockMs" type="range" min="50" max="240" step="1" value="120" />
                <input id="blockMsNumber" type="number" min="50" max="240" step="1" value="120" />
              </div>
            </label>
            <label>
              <span>Overlap</span>
              <div class="dual-input">
                <input id="overlap" type="range" min="2" max="8" step="0.1" value="4" />
                <input id="overlapNumber" type="number" min="2" max="8" step="0.1" value="4" />
              </div>
            </label>
            <label>
              <span>Interval (ms)</span>
              <input id="intervalMs" type="number" min="6.25" max="120" step="0.1" value="30" />
            </label>
            <label class="toggle-row">
              <input id="splitComputation" type="checkbox" checked />
              <span>Split computation</span>
            </label>
          </div>
        </div>

        <div id="levelsPanel" class="control-panel levels-panel" hidden>
          <p class="section-label">Processed output</p>
          <div id="levelsSummary" class="levels-summary"></div>
          <button id="clearClipButton" type="button">Clear clip latch</button>
        </div>
      </section>

      <details id="advancedInspector" class="advanced-inspector">
        <summary>
          <span>
            <span class="section-label">Advanced proof inspector</span>
            <strong>Boundary runtime proof</strong>
          </span>
          <span class="details-hint" aria-hidden="true"></span>
        </summary>
        <section class="inspector-grid" aria-label="Boundary inspector">
          <div class="inspector-panel">
            <p class="section-label">Runtime</p>
            <dl class="runtime-facts">
              <div><dt>State</dt><dd id="transportState">idle</dd></div>
              <div><dt>Desired</dt><dd id="appliedSequence">0</dd></div>
              <div><dt>Pending</dt><dd id="pendingState">none</dd></div>
              <div><dt>Command drops</dt><dd id="commandDrops">0</dd></div>
              <div><dt>Loop</dt><dd id="loopApplied">inactive</dd></div>
            </dl>
            <div class="button-row">
              <button id="staleButton" type="button">Stale read</button>
              <button id="faultButton" type="button">Fault</button>
              <button id="resetFaultButton" type="button">Reset fault</button>
              <button id="resetControlsButton" type="button">Reset controls</button>
            </div>
          </div>

          <div class="inspector-panel">
            <p class="section-label">Boundary inspector</p>
            <div id="inspector" class="inspector"></div>
          </div>
        </section>
      </details>

      <section id="status" class="status-area" role="status" aria-live="polite"></section>
    </div>
  `;

  return {
    alignedSourceMode: must(root, "#alignedSourceMode", HTMLInputElement),
    appliedSequence: must(root, "#appliedSequence", HTMLElement),
    adapterAvailability: must(root, "#adapterAvailability", HTMLElement),
    blockMs: must(root, "#blockMs", HTMLInputElement),
    blockMsNumber: must(root, "#blockMsNumber", HTMLInputElement),
    clearClipButton: must(root, "#clearClipButton", HTMLButtonElement),
    clearLoopButton: must(root, "#clearLoopButton", HTMLButtonElement),
    commandDrops: must(root, "#commandDrops", HTMLElement),
    configPreset: must(root, "#configPreset", HTMLSelectElement),
    controlGrid: must(root, "#controlGrid", HTMLElement),
    controlsHint: must(root, "#controlsHint", HTMLElement),
    engineConfigFields: must(root, "#engineConfigFields", HTMLElement),
    faultButton: must(root, "#faultButton", HTMLButtonElement),
    fileInput: must(root, "#fileInput", HTMLInputElement),
    formantBase: must(root, "#formantBase", HTMLInputElement),
    formantBaseAuto: must(root, "#formantBaseAuto", HTMLInputElement),
    formantBaseValue: must(root, "#formantBaseValue", HTMLElement),
    formantCompensation: must(root, "#formantCompensation", HTMLInputElement),
    formantShift: must(root, "#formantShift", HTMLInputElement),
    formantShiftValue: must(root, "#formantShiftValue", HTMLElement),
    inspector: must(root, "#inspector", HTMLElement),
    levelsPanel: must(root, "#levelsPanel", HTMLElement),
    listeningPreset: must(root, "#listeningPreset", HTMLSelectElement),
    levelsSummary: must(root, "#levelsSummary", HTMLElement),
    loopApplied: must(root, "#loopApplied", HTMLElement),
    loopAppliedSummary: must(root, "#loopAppliedSummary", HTMLElement),
    loopCacheCoverage: must(root, "#loopCacheCoverage", HTMLElement),
    loopDraft: must(root, "#loopDraft", HTMLElement),
    loopEnd: must(root, "#loopEnd", HTMLInputElement),
    loopEndValue: must(root, "#loopEndValue", HTMLElement),
    loopSourceFrame: must(root, "#loopSourceFrame", HTMLElement),
    loopStart: must(root, "#loopStart", HTMLInputElement),
    loopStartValue: must(root, "#loopStartValue", HTMLElement),
    loopValidation: must(root, "#loopValidation", HTMLElement),
    markLoopEndButton: must(root, "#markLoopEndButton", HTMLButtonElement),
    markLoopStartButton: must(root, "#markLoopStartButton", HTMLButtonElement),
    metadata: must(root, "#metadata", HTMLElement),
    intervalMs: must(root, "#intervalMs", HTMLInputElement),
    overlap: must(root, "#overlap", HTMLInputElement),
    overlapNumber: must(root, "#overlapNumber", HTMLInputElement),
    pauseButton: must(root, "#pauseButton", HTMLButtonElement),
    pendingState: must(root, "#pendingState", HTMLElement),
    pitch: must(root, "#pitch", HTMLInputElement),
    pitchValue: must(root, "#pitchValue", HTMLElement),
    playButton: must(root, "#playButton", HTMLButtonElement),
    playLoopButton: must(root, "#playLoopButton", HTMLButtonElement),
    playhead: must(root, "#playhead", HTMLElement),
    processedMode: must(root, "#processedMode", HTMLInputElement),
    rangeMode: must(root, "#rangeMode", HTMLSelectElement),
    rangeModeWarning: must(root, "#rangeModeWarning", HTMLElement),
    rate: must(root, "#rate", HTMLInputElement),
    rateValue: must(root, "#rateValue", HTMLElement),
    resetControlsButton: must(root, "#resetControlsButton", HTMLButtonElement),
    resetFaultButton: must(root, "#resetFaultButton", HTMLButtonElement),
    runtimeModeBadge: must(root, "#runtimeModeBadge", HTMLElement),
    seekFrame: must(root, "#seekFrame", HTMLInputElement),
    seekRange: must(root, "#seekRange", HTMLInputElement),
    setLoopButton: must(root, "#setLoopButton", HTMLButtonElement),
    splitCompareMode: must(root, "#splitCompareMode", HTMLInputElement),
    splitComputation: must(root, "#splitComputation", HTMLInputElement),
    shell: must(root, "#appShell", HTMLElement),
    sourceDrop: must(root, "#sourceDrop", HTMLElement),
    sourcePrimary: must(root, "#sourcePrimary", HTMLElement),
    sourceSecondary: must(root, "#sourceSecondary", HTMLElement),
    sourceState: must(root, "#sourceState", HTMLElement),
    sourceStatusBadge: must(root, "#sourceStatusBadge", HTMLElement),
    staleButton: must(root, "#staleButton", HTMLButtonElement),
    status: must(root, "#status", HTMLElement),
    stopButton: must(root, "#stopButton", HTMLButtonElement),
    tonalityEnabled: must(root, "#tonalityEnabled", HTMLInputElement),
    tonalityHz: must(root, "#tonalityHz", HTMLInputElement),
    tonalityHzValue: must(root, "#tonalityHzValue", HTMLElement),
    transportState: must(root, "#transportState", HTMLElement),
    waveform: must(root, "#waveform", HTMLCanvasElement),
    waveformPanel: must(root, "#waveformPanel", HTMLElement),
  };
}

export function renderUnsupported(root: HTMLElement, message: string): void {
  root.innerHTML = `
    <div class="unsupported-shell">
      <p class="eyebrow">Exclave Boundary</p>
      <h1>Signalsmith Stretch</h1>
      <p class="mode-badge">Unsupported browser context</p>
      <p>${escapeHtml(message)}</p>
      <p>Stage B requires SharedArrayBuffer with cross-origin isolation headers.</p>
    </div>
  `;
}

function must<T extends Element>(
  root: ParentNode,
  selector: string,
  ctor: ElementConstructor<T>,
): T {
  const element = root.querySelector(selector);
  if (!(element instanceof ctor)) {
    throw new Error(`Missing UI element: ${selector}`);
  }
  return element;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
