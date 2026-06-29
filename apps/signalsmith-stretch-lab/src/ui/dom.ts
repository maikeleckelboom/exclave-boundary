export interface AppElements {
  readonly alignedSourceMode: HTMLInputElement;
  readonly appliedSequence: HTMLElement;
  readonly adapterAvailability: HTMLElement;
  readonly clearClipButton: HTMLButtonElement;
  readonly clearLoopButton: HTMLButtonElement;
  readonly blockMs: HTMLInputElement;
  readonly blockMsNumber: HTMLInputElement;
  readonly commandDrops: HTMLElement;
  readonly configPreset: HTMLSelectElement;
  readonly faultButton: HTMLButtonElement;
  readonly fileInput: HTMLInputElement;
  readonly formantBase: HTMLInputElement;
  readonly formantBaseValue: HTMLElement;
  readonly formantCompensation: HTMLInputElement;
  readonly formantShift: HTMLInputElement;
  readonly formantShiftValue: HTMLElement;
  readonly inspector: HTMLElement;
  readonly levelsSummary: HTMLElement;
  readonly loopApplied: HTMLElement;
  readonly loopEnd: HTMLInputElement;
  readonly loopEndValue: HTMLElement;
  readonly loopStart: HTMLInputElement;
  readonly loopStartValue: HTMLElement;
  readonly metadata: HTMLElement;
  readonly intervalMs: HTMLInputElement;
  readonly overlap: HTMLInputElement;
  readonly overlapNumber: HTMLInputElement;
  readonly pauseButton: HTMLButtonElement;
  readonly pendingState: HTMLElement;
  readonly pitch: HTMLInputElement;
  readonly pitchValue: HTMLElement;
  readonly playButton: HTMLButtonElement;
  readonly playhead: HTMLElement;
  readonly processedMode: HTMLInputElement;
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
  readonly sourceDrop: HTMLElement;
  readonly staleButton: HTMLButtonElement;
  readonly status: HTMLElement;
  readonly stopButton: HTMLButtonElement;
  readonly tonalityEnabled: HTMLInputElement;
  readonly tonalityHz: HTMLInputElement;
  readonly tonalityHzValue: HTMLElement;
  readonly transitionFrames: HTMLInputElement;
  readonly transitionFramesValue: HTMLElement;
  readonly transportState: HTMLElement;
  readonly waveform: HTMLCanvasElement;
}

type ElementConstructor<T extends Element> = new () => T;

export function renderAppShell(root: HTMLElement): AppElements {
  root.innerHTML = `
    <div class="lab-shell">
      <header class="lab-header">
        <div>
          <p class="eyebrow">Exclave Boundary</p>
          <h1>Signalsmith Stretch Lab</h1>
        </div>
        <div class="header-facts" aria-label="Runtime facts">
          <span id="runtimeModeBadge" class="mode-badge">Simulator fallback</span>
          <span id="adapterAvailability">Real adapter unavailable</span>
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
            <strong>Drop audio file</strong>
            <p id="source-truth">WAV files use chunked decoding; other formats use browser decoding when available.</p>
          </div>
          <label class="file-picker">
            <span>Choose file</span>
            <input id="fileInput" type="file" accept="audio/*" />
          </label>
        </div>
        <div id="metadata" class="metadata-grid" aria-live="polite"></div>
      </section>

      <section class="waveform-panel" aria-labelledby="waveform-title">
        <div class="section-heading">
          <div>
            <p class="section-label" id="waveform-title">Waveform overview</p>
            <h2>Applied playhead and requested seek</h2>
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
      </section>

      <section class="transport-panel" aria-label="Transport">
        <div class="button-row">
          <button id="playButton" type="button">Play</button>
          <button id="pauseButton" type="button">Pause</button>
          <button id="stopButton" type="button">Stop</button>
          <button id="setLoopButton" type="button">Set loop</button>
          <button id="clearLoopButton" type="button">Clear loop</button>
        </div>
        <fieldset class="source-mode">
          <legend>Monitor</legend>
          <label>
            <input id="processedMode" type="radio" name="sourceMode" value="processed" checked />
            <span>Processed Worklet</span>
          </label>
          <label>
            <input id="alignedSourceMode" type="radio" name="sourceMode" value="aligned" />
            <span>Aligned reference preview</span>
          </label>
          <label>
            <input id="splitCompareMode" type="radio" name="sourceMode" value="split" />
            <span>Split compare</span>
          </label>
        </fieldset>
      </section>

      <section class="control-grid" aria-label="Stretch controls">
        <div class="control-panel">
          <p class="section-label">Timing and pitch</p>
          <label>
            <span>Rate</span>
            <input id="rate" type="range" min="0.05" max="8" step="0.001" value="1" />
            <output id="rateValue">1.000x</output>
          </label>
          <label>
            <span>Pitch</span>
            <input id="pitch" type="range" min="-48" max="48" step="0.1" value="0" />
            <output id="pitchValue">0.0 st</output>
          </label>
          <label>
            <span>Transition</span>
            <input id="transitionFrames" type="range" min="0" max="48000" step="64" value="2048" />
            <output id="transitionFramesValue">2048 frames</output>
          </label>
        </div>

        <div class="control-panel">
          <p class="section-label">Tone and formants</p>
          <label class="toggle-row">
            <input id="tonalityEnabled" type="checkbox" checked />
            <span>Tonality enabled</span>
          </label>
          <label>
            <span>Tonality Hz</span>
            <input id="tonalityHz" type="range" min="0" max="24000" step="1" value="440" />
            <output id="tonalityHzValue">440 Hz</output>
          </label>
          <label>
            <span>Formant shift</span>
            <input id="formantShift" type="range" min="-48" max="48" step="0.1" value="0" />
            <output id="formantShiftValue">0.0 st</output>
          </label>
          <label class="toggle-row">
            <input id="formantCompensation" type="checkbox" checked />
            <span>Compensation</span>
          </label>
          <label>
            <span>Formant base</span>
            <input id="formantBase" type="range" min="0" max="24000" step="1" value="0" />
            <output id="formantBaseValue">Auto</output>
          </label>
        </div>

        <div class="control-panel config-panel">
          <p class="section-label">Stretch engine config</p>
          <label>
            <span>Preset</span>
            <select id="configPreset">
              <option value="default">default</option>
              <option value="custom">custom</option>
              <option value="cheaper">cheaper</option>
            </select>
          </label>
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
            <input id="splitComputation" type="checkbox" />
            <span>Split computation</span>
          </label>
        </div>

        <div class="control-panel levels-panel">
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
    faultButton: must(root, "#faultButton", HTMLButtonElement),
    fileInput: must(root, "#fileInput", HTMLInputElement),
    formantBase: must(root, "#formantBase", HTMLInputElement),
    formantBaseValue: must(root, "#formantBaseValue", HTMLElement),
    formantCompensation: must(root, "#formantCompensation", HTMLInputElement),
    formantShift: must(root, "#formantShift", HTMLInputElement),
    formantShiftValue: must(root, "#formantShiftValue", HTMLElement),
    inspector: must(root, "#inspector", HTMLElement),
    levelsSummary: must(root, "#levelsSummary", HTMLElement),
    loopApplied: must(root, "#loopApplied", HTMLElement),
    loopEnd: must(root, "#loopEnd", HTMLInputElement),
    loopEndValue: must(root, "#loopEndValue", HTMLElement),
    loopStart: must(root, "#loopStart", HTMLInputElement),
    loopStartValue: must(root, "#loopStartValue", HTMLElement),
    metadata: must(root, "#metadata", HTMLElement),
    intervalMs: must(root, "#intervalMs", HTMLInputElement),
    overlap: must(root, "#overlap", HTMLInputElement),
    overlapNumber: must(root, "#overlapNumber", HTMLInputElement),
    pauseButton: must(root, "#pauseButton", HTMLButtonElement),
    pendingState: must(root, "#pendingState", HTMLElement),
    pitch: must(root, "#pitch", HTMLInputElement),
    pitchValue: must(root, "#pitchValue", HTMLElement),
    playButton: must(root, "#playButton", HTMLButtonElement),
    playhead: must(root, "#playhead", HTMLElement),
    processedMode: must(root, "#processedMode", HTMLInputElement),
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
    sourceDrop: must(root, "#sourceDrop", HTMLElement),
    staleButton: must(root, "#staleButton", HTMLButtonElement),
    status: must(root, "#status", HTMLElement),
    stopButton: must(root, "#stopButton", HTMLButtonElement),
    tonalityEnabled: must(root, "#tonalityEnabled", HTMLInputElement),
    tonalityHz: must(root, "#tonalityHz", HTMLInputElement),
    tonalityHzValue: must(root, "#tonalityHzValue", HTMLElement),
    transitionFrames: must(root, "#transitionFrames", HTMLInputElement),
    transitionFramesValue: must(root, "#transitionFramesValue", HTMLElement),
    transportState: must(root, "#transportState", HTMLElement),
    waveform: must(root, "#waveform", HTMLCanvasElement),
  };
}

export function renderUnsupported(root: HTMLElement, message: string): void {
  root.innerHTML = `
    <div class="unsupported-shell">
      <p class="eyebrow">Exclave Boundary</p>
      <h1>Signalsmith Stretch Lab</h1>
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
