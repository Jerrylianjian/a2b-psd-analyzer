"use strict";

const state = {
  fileName: "",
  time: null,
  signal: null,
  fs: 0,
  psd: null,
  lastCsv: ""
};

const els = {
  fileInput: document.getElementById("fileInput"),
  dropZone: document.getElementById("dropZone"),
  fileMeta: document.getElementById("fileMeta"),
  sampleRateInput: document.getElementById("sampleRateInput"),
  rbwInput: document.getElementById("rbwInput"),
  loadSelect: document.getElementById("loadSelect"),
  driveSelect: document.getElementById("driveSelect"),
  notch100Toggle: document.getElementById("notch100Toggle"),
  spurFundamentalInput: document.getElementById("spurFundamentalInput"),
  spurWidthInput: document.getElementById("spurWidthInput"),
  maskToggle: document.getElementById("maskToggle"),
  runButton: document.getElementById("runButton"),
  demoButton: document.getElementById("demoButton"),
  exportButton: document.getElementById("exportButton"),
  consoleLog: document.getElementById("consoleLog"),
  statusDot: document.getElementById("statusDot"),
  psdCanvas: document.getElementById("psdCanvas"),
  waveCanvas: document.getElementById("waveCanvas"),
  summary: document.getElementById("summary"),
  loadLabel: document.getElementById("loadLabel"),
  timeLabel: document.getElementById("timeLabel")
};

const a2bLimits = {
  high: {
    label: "高",
    upper: [
      [1, -45], [5, -35], [8, -35], [54, -35], [60, -35], [80, -45],
      [100, -55], [160, -55], [200, -70], [260, -70], [300, -80], [400, -80]
    ],
    lower: [[5, -53], [8, -50], [54, -50], [60, -53], [80, -63]]
  },
  medium: {
    label: "中",
    upper: [
      [1, -48], [5, -38], [8, -38], [54, -38], [60, -38], [80, -48],
      [100, -58], [160, -58], [200, -73], [260, -73], [300, -83], [400, -83]
    ],
    lower: [[5, -56], [8, -53], [54, -53], [60, -56], [80, -66]]
  },
  low: {
    label: "低",
    upper: [
      [1, -51], [5, -41], [8, -41], [54, -41], [60, -41], [80, -51],
      [100, -61], [160, -61], [200, -76], [260, -76], [300, -86], [400, -86]
    ],
    lower: [[5, -59], [8, -56], [54, -56], [60, -59], [80, -69]]
  }
};

function log(message, mode = "idle") {
  els.consoleLog.textContent = message;
  els.statusDot.className = `dot ${mode}`;
}

function appendLog(message, mode) {
  els.consoleLog.textContent += `\n${message}`;
  if (mode) els.statusDot.className = `dot ${mode}`;
}

function setBusy(isBusy) {
  els.runButton.disabled = isBusy || !state.signal;
  els.demoButton.disabled = isBusy;
  els.exportButton.disabled = isBusy || !state.psd;
}

function parseCsv(text, fallbackFs) {
  const rows = text.split(/\r?\n/);
  const pairTime = [];
  const pairSignal = [];
  const singleSignal = [];

  for (const rawLine of rows) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/[,\t; ]+/).filter(Boolean);
    const nums = parts.map(Number);

    if (nums.length >= 2 && Number.isFinite(nums[0]) && Number.isFinite(nums[1])) {
      pairTime.push(nums[0]);
      pairSignal.push(nums[1]);
      continue;
    }

    if (parts.length === 1 && Number.isFinite(nums[0])) {
      singleSignal.push(nums[0]);
    }
  }

  const usePairs = pairSignal.length >= 256;
  const signal = usePairs ? pairSignal : singleSignal;

  if (signal.length < 256) {
    throw new Error("有效采样点少于 256，无法计算 Welch PSD。");
  }

  let fs = Number(fallbackFs);
  let t = null;

  if (usePairs) {
    t = Float64Array.from(pairTime);
    const diffs = [];
    for (let i = 1; i < t.length; i += 1) {
      const d = t[i] - t[i - 1];
      if (Number.isFinite(d) && d > 0) diffs.push(d);
    }
    if (diffs.length < 10) throw new Error("时间列无有效递增间隔。");
    diffs.sort((a, b) => a - b);
    fs = 1 / diffs[Math.floor(diffs.length / 2)];
  } else if (!Number.isFinite(fs) || fs <= 0) {
    throw new Error("单列 CSV 需要填写有效采样率 Fs。");
  }

  const x = Float64Array.from(signal);
  const mean = x.reduce((sum, v) => sum + v, 0) / x.length;
  for (let i = 0; i < x.length; i += 1) x[i] -= mean;

  return { time: t, signal: x, fs };
}

function loadTextFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = parseCsv(String(reader.result), Number(els.sampleRateInput.value));
      state.fileName = file.name;
      state.time = parsed.time;
      state.signal = parsed.signal;
      state.fs = parsed.fs;
      state.psd = null;
      state.lastCsv = "";
      els.fileMeta.textContent = `${file.name} · ${parsed.signal.length.toLocaleString()} samples · Fs ${(parsed.fs / 1e6).toFixed(3)} MHz`;
      els.summary.textContent = "已加载 CSV，等待分析";
      log(`Loaded: ${file.name}\nSamples: ${parsed.signal.length}\nFs: ${parsed.fs.toPrecision(8)} Hz`, "ok");
      setBusy(false);
      drawWaveform();
      drawPsdPlaceholder();
    } catch (err) {
      log(`Parse error: ${err.message}`, "fail");
    }
  };
  reader.onerror = () => log("File read error.", "fail");
  reader.readAsText(file);
}

function nextPow2(v) {
  return 2 ** Math.ceil(Math.log2(v));
}

function bitReverse(real, imag) {
  const n = real.length;
  let j = 0;
  for (let i = 1; i < n; i += 1) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      const tr = real[i];
      const ti = imag[i];
      real[i] = real[j];
      imag[i] = imag[j];
      real[j] = tr;
      imag[j] = ti;
    }
  }
}

function fft(real, imag) {
  const n = real.length;
  bitReverse(real, imag);
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const theta = -2 * Math.PI / len;
    const wLenR = Math.cos(theta);
    const wLenI = Math.sin(theta);
    for (let i = 0; i < n; i += len) {
      let wr = 1;
      let wi = 0;
      for (let j = 0; j < half; j += 1) {
        const uR = real[i + j];
        const uI = imag[i + j];
        const vR = real[i + j + half] * wr - imag[i + j + half] * wi;
        const vI = real[i + j + half] * wi + imag[i + j + half] * wr;
        real[i + j] = uR + vR;
        imag[i + j] = uI + vI;
        real[i + j + half] = uR - vR;
        imag[i + j + half] = uI - vI;
        const nextWr = wr * wLenR - wi * wLenI;
        wi = wr * wLenI + wi * wLenR;
        wr = nextWr;
      }
    }
  }
}

function welchPsd(signal, fs) {
  const n = signal.length;
  const windowLength = Math.min(65536, 2 ** Math.floor(Math.log2(Math.max(256, Math.floor(n / 8)))));
  const overlap = Math.floor(windowLength * 0.5);
  const step = windowLength - overlap;
  const nfft = Math.max(windowLength, nextPow2(windowLength));
  const bins = Math.floor(nfft / 2) + 1;
  const pxx = new Float64Array(bins);
  const window = new Float64Array(windowLength);
  let winPower = 0;

  for (let i = 0; i < windowLength; i += 1) {
    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / windowLength);
    window[i] = w;
    winPower += w * w;
  }

  const real = new Float64Array(nfft);
  const imag = new Float64Array(nfft);
  let segments = 0;

  for (let start = 0; start + windowLength <= n; start += step) {
    real.fill(0);
    imag.fill(0);
    for (let i = 0; i < windowLength; i += 1) {
      real[i] = signal[start + i] * window[i];
    }
    fft(real, imag);
    for (let k = 0; k < bins; k += 1) {
      let power = (real[k] * real[k] + imag[k] * imag[k]) / (fs * winPower);
      if (k > 0 && k < bins - 1) power *= 2;
      pxx[k] += power;
    }
    segments += 1;
  }

  if (segments === 0) throw new Error("采样点不足以形成 Welch 分段。");
  for (let k = 0; k < bins; k += 1) pxx[k] /= segments;

  const freq = new Float64Array(bins);
  for (let k = 0; k < bins; k += 1) freq[k] = k * fs / nfft;
  return { freq, pxx, windowLength, overlap, nfft, segments };
}

function convertPsd(result, loadOhm) {
  const psdDb = new Float64Array(result.pxx.length);
  const psdDbm = new Float64Array(result.pxx.length);
  const psdDbmRbw = new Float64Array(result.pxx.length);
  const rbwHz = Math.max(1, Number(els.rbwInput.value) || 1);
  const rbwOffset = 10 * Math.log10(rbwHz);
  for (let i = 0; i < result.pxx.length; i += 1) {
    const v = Math.max(result.pxx[i], 1e-300);
    psdDb[i] = 10 * Math.log10(v);
    psdDbm[i] = 10 * Math.log10((v / loadOhm) / 1e-3);
    psdDbmRbw[i] = psdDbm[i] + rbwOffset;
  }
  return { ...result, psdDb, psdDbm, psdDbmRbw, loadOhm, rbwHz };
}

function interpolateLimit(points, mhz) {
  if (mhz < points[0][0] || mhz > points[points.length - 1][0]) return NaN;
  for (let i = 1; i < points.length; i += 1) {
    if (mhz <= points[i][0]) {
      const x0 = points[i - 1][0];
      const x1 = points[i][0];
      const y0 = points[i - 1][1];
      const y1 = points[i][1];
      const t = (mhz - x0) / (x1 - x0 || 1);
      return y0 + t * (y1 - y0);
    }
  }
  return NaN;
}

function complianceStats(psd) {
  const drive = a2bLimits[els.driveSelect.value] || a2bLimits.high;
  const measuredPsd = getMeasuredPsdForDisplay(psd);
  let worstUpperMargin = -Infinity;
  let worstLowerMargin = -Infinity;
  let worstUpperMHz = 0;
  let worstLowerMHz = 0;
  let checked = 0;
  for (let i = 0; i < psd.freq.length; i += 1) {
    const mhz = psd.freq[i] / 1e6;
    if (mhz < 1 || mhz > 400) continue;
    const upper = interpolateLimit(drive.upper, mhz);
    const lower = interpolateLimit(drive.lower, mhz);
    const measured = measuredPsd[i];

    if (Number.isFinite(upper)) {
      const margin = measured - upper;
      if (margin > worstUpperMargin) {
        worstUpperMargin = margin;
        worstUpperMHz = mhz;
      }
      checked += 1;
    }

    if (Number.isFinite(lower)) {
      const margin = lower - measured;
      if (margin > worstLowerMargin) {
        worstLowerMargin = margin;
        worstLowerMHz = mhz;
      }
    }
  }
  const passUpper = worstUpperMargin <= 0;
  const passLower = worstLowerMargin <= 0;
  return { pass: passUpper && passLower, passUpper, passLower, worstUpperMargin, worstLowerMargin, worstUpperMHz, worstLowerMHz, checked };
}

function runAnalysis() {
  if (!state.signal) return;
  setBusy(true);
  log("Running Welch PSD...", "busy");

  setTimeout(() => {
    try {
      let x = state.signal;
      const mode = document.querySelector("input[name='inputMode']:checked").value;
      if (mode === "singleAuto") {
        x = Float64Array.from(state.signal, v => v * 2);
      }
      const raw = welchPsd(x, state.fs);
      state.psd = convertPsd(raw, Number(els.loadSelect.value));
      const stats = complianceStats(state.psd);
      state.lastCsv = buildCsv(state.psd);
      drawPsd();
      drawWaveform();

      const result = stats.pass ? "PASS" : "FAIL";
      const lowerText = Number.isFinite(stats.worstLowerMargin)
        ? `Lower margin: ${stats.worstLowerMargin.toFixed(2)} dB @ ${stats.worstLowerMHz.toFixed(3)} MHz`
        : "Lower margin: not checked";
      els.summary.textContent = `${result} · upper ${stats.worstUpperMargin.toFixed(2)} dB · lower ${Number.isFinite(stats.worstLowerMargin) ? stats.worstLowerMargin.toFixed(2) : "N/A"} dB`;
      log([
        "A2B TX PSD Analyzer",
        `Samples: ${state.signal.length}`,
        `Fs: ${state.fs.toPrecision(8)} Hz`,
        `Welch window: ${state.psd.windowLength}`,
        `Overlap: ${state.psd.overlap}`,
        `NFFT: ${state.psd.nfft}`,
        `Segments: ${state.psd.segments}`,
        `Load: ${state.psd.loadOhm} Ohm`,
        `RBW: ${state.psd.rbwHz} Hz`,
        `Drive: ${a2bLimits[els.driveSelect.value].label}`,
        `Result: ${result}`,
        `Upper margin: ${stats.worstUpperMargin.toFixed(2)} dB @ ${stats.worstUpperMHz.toFixed(3)} MHz`,
        lowerText
      ].join("\n"), stats.pass ? "ok" : "fail");
    } catch (err) {
      log(`Analysis error: ${err.message}`, "fail");
    } finally {
      setBusy(false);
    }
  }, 30);
}

function buildCsv(psd) {
  const otherLoad = psd.loadOhm === 50 ? 100 : 50;
  const measuredPsd = getMeasuredPsdForDisplay(psd);
  const header = `Frequency_Hz,PSD_V2_per_Hz,PSD_dB_per_Hz,PSD_dBm_per_Hz_${psd.loadOhm}Ohm,PSD_dBm_per_RBW_${psd.loadOhm}Ohm,PSD_dBm_per_RBW_Filtered_${psd.loadOhm}Ohm,PSD_dBm_per_Hz_${otherLoad}Ohm`;
  const lines = [header];
  for (let i = 0; i < psd.freq.length; i += 1) {
    const other = 10 * Math.log10((Math.max(psd.pxx[i], 1e-300) / otherLoad) / 1e-3);
    lines.push(`${psd.freq[i]},${psd.pxx[i]},${psd.psdDb[i]},${psd.psdDbm[i]},${psd.psdDbmRbw[i]},${measuredPsd[i]},${other}`);
  }
  return lines.join("\n");
}

function exportCsv() {
  if (!state.lastCsv) return;
  const stem = (state.fileName || "waveform").replace(/\.[^.]+$/, "");
  const blob = new Blob([state.lastCsv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${stem}_psd.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(320, Math.floor(rect.width * dpr));
  canvas.height = Math.max(220, Math.floor(rect.height * dpr));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: rect.width, h: rect.height };
}

function clearPlot(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
}

function drawAxes(ctx, plot, xTicks, yTicks, xMap, yMap, labels) {
  ctx.strokeStyle = "#d8e0e5";
  ctx.lineWidth = 1;
  ctx.font = "11px Arial";
  ctx.fillStyle = "#516271";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  for (const t of xTicks) {
    const x = xMap(t);
    ctx.beginPath();
    ctx.moveTo(x, plot.top);
    ctx.lineTo(x, plot.bottom);
    ctx.stroke();
    const stagger = t === 1 ? 8 : (t === 5 ? 22 : 8);
    ctx.fillText(String(t), x, plot.bottom + stagger);
  }

  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const t of yTicks) {
    const y = yMap(t);
    ctx.beginPath();
    ctx.moveTo(plot.left, y);
    ctx.lineTo(plot.right, y);
    ctx.stroke();
    ctx.fillText(String(t), plot.left - 8, y);
  }

  ctx.strokeStyle = "#4e5b64";
  ctx.strokeRect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top);
  ctx.textAlign = "center";
  ctx.fillText(labels.x, (plot.left + plot.right) / 2, plot.bottom + 28);
  ctx.save();
  ctx.translate(14, (plot.top + plot.bottom) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(labels.y, 0, 0);
  ctx.restore();
}

function drawPsdPlaceholder() {
  const { ctx, w, h } = setupCanvas(els.psdCanvas);
  clearPlot(ctx, w, h);
  ctx.fillStyle = "#7b8b96";
  ctx.font = "13px Arial";
  ctx.textAlign = "center";
  ctx.fillText("Upload CSV and run analysis", w / 2, h / 2);
}

function drawPsd() {
  const psd = state.psd;
  const { ctx, w, h } = setupCanvas(els.psdCanvas);
  clearPlot(ctx, w, h);
  if (!psd) return drawPsdPlaceholder();

  els.loadLabel.textContent = `${psd.loadOhm} Ω · ${formatRbw(psd.rbwHz)} RBW`;
  const plot = { left: 64, top: 18, right: w - 22, bottom: h - 48 };
  const xMin = 0;
  const xMax = Math.min(400, Math.max(10, state.fs / 2 / 1e6));
  const yMin = -95;
  const yMax = -25;
  const xMap = mhz => plot.left + (mhz - xMin) / (xMax - xMin) * (plot.right - plot.left);
  const yMap = db => plot.bottom - (db - yMin) / (yMax - yMin) * (plot.bottom - plot.top);

  drawAxes(ctx, plot, [1, 5, 60, 80, 100, 160, 200, 260, 300, 400].filter(v => v <= xMax), [-90, -80, -70, -60, -50, -40, -30], xMap, yMap, {
    x: "Frequency (MHz)",
    y: "dBm/RBW"
  });

  if (els.maskToggle.checked) {
    const drive = a2bLimits[els.driveSelect.value] || a2bLimits.high;
    drawLimitLine(ctx, drive.upper, xMap, yMap, "#111111", [6, 4], xMax);
    drawLimitLine(ctx, drive.lower, xMap, yMap, "#6b7378", [3, 4], xMax);
  }

  const measuredPsd = getMeasuredPsdForDisplay(psd);
  ctx.beginPath();
  let started = false;
  for (let i = 1; i < psd.freq.length; i += 1) {
    const mhz = psd.freq[i] / 1e6;
    if (mhz < 1 || mhz > xMax) continue;
    const x = xMap(mhz);
    const y = yMap(Math.max(yMin, Math.min(yMax, measuredPsd[i])));
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = "#008fc7";
  ctx.lineWidth = 1.35;
  ctx.stroke();

  drawLegend(ctx, plot);
}

function getMeasuredPsdForDisplay(psd) {
  if (!els.notch100Toggle.checked) return psd.psdDbmRbw;
  const startHz = Math.max(1, Number(els.spurFundamentalInput.value) || 80) * 1e6;
  const windowPoints = Math.max(3, Math.round(Number(els.spurWidthInput.value) || 15));
  return medianFilterAbove(psd.freq, psd.psdDbmRbw, startHz, windowPoints);
}

function despikeHarmonics(freq, values, fundamentalHz, halfWidthHz, thresholdDb, radiusBins) {
  let output = Float64Array.from(values);
  const maxFreq = freq[freq.length - 1] || 0;
  for (let center = fundamentalHz; center <= maxFreq + halfWidthHz; center += fundamentalHz) {
    output = despikeBand(freq, output, center - halfWidthHz, center + halfWidthHz, thresholdDb, radiusBins);
  }
  return output;
}

function despikeBand(freq, values, fMin, fMax, thresholdDb, radiusBins) {
  const output = Float64Array.from(values);
  const scratch = [];

  for (let i = 0; i < values.length; i += 1) {
    const f = freq[i];
    if (f < fMin || f > fMax) continue;

    scratch.length = 0;
    const lo = Math.max(0, i - radiusBins);
    const hi = Math.min(values.length - 1, i + radiusBins);
    for (let j = lo; j <= hi; j += 1) {
      if (j === i) continue;
      scratch.push(values[j]);
    }
    scratch.sort((a, b) => a - b);
    const med = scratch[Math.floor(scratch.length / 2)];
    if (values[i] - med > thresholdDb) output[i] = med;
  }

  return output;
}

function interpolateSpurHarmonics(freq, values, fundamentalHz, halfWidthHz) {
  const output = Float64Array.from(values);
  const maxFreq = freq[freq.length - 1] || 0;

  for (let center = fundamentalHz; center <= maxFreq + halfWidthHz; center += fundamentalHz) {
    interpolateBand(freq, output, center - halfWidthHz, center + halfWidthHz);
  }

  return output;
}

function interpolateBand(freq, values, fMin, fMax) {
  let first = -1;
  let last = -1;

  for (let i = 0; i < freq.length; i += 1) {
    if (freq[i] >= fMin && freq[i] <= fMax) {
      if (first < 0) first = i;
      last = i;
    }
  }

  if (first < 0 || last < first) return;
  const left = first - 1;
  const right = last + 1;
  if (left < 0 || right >= values.length) return;

  const f0 = freq[left];
  const f1 = freq[right];
  const y0 = values[left];
  const y1 = values[right];
  for (let i = first; i <= last; i += 1) {
    const t = (freq[i] - f0) / (f1 - f0 || 1);
    values[i] = y0 + t * (y1 - y0);
  }
}

function despikeNarrowPeaks(freq, values, startHz, thresholdDb) {
  const output = Float64Array.from(values);
  const n = values.length;
  const noiseRadius = 14;
  const guardRadius = 2;
  const peak = new Uint8Array(n);

  for (let i = noiseRadius; i < n - noiseRadius; i += 1) {
    if (freq[i] < startHz) continue;
    const neighborhood = [];
    for (let j = i - noiseRadius; j <= i + noiseRadius; j += 1) {
      if (Math.abs(j - i) <= guardRadius) continue;
      neighborhood.push(values[j]);
    }
    neighborhood.sort((a, b) => a - b);
    const med = neighborhood[Math.floor(neighborhood.length / 2)];
    if (values[i] - med >= thresholdDb) peak[i] = 1;
  }

  for (let i = 0; i < n; i += 1) {
    if (!peak[i]) continue;
    let first = i;
    let last = i;
    while (first > 0 && peak[first - 1]) first -= 1;
    while (last + 1 < n && peak[last + 1]) last += 1;

    first = Math.max(0, first - guardRadius);
    last = Math.min(n - 1, last + guardRadius);
    const left = first - 1;
    const right = last + 1;
    if (left >= 0 && right < n) {
      const f0 = freq[left];
      const f1 = freq[right];
      const y0 = output[left];
      const y1 = output[right];
      for (let k = first; k <= last; k += 1) {
        const t = (freq[k] - f0) / (f1 - f0 || 1);
        output[k] = y0 + t * (y1 - y0);
      }
    }
    i = last;
  }

  return output;
}

function medianFilterAbove(freq, values, startHz, windowPoints) {
  const output = Float64Array.from(values);
  const k = windowPoints % 2 === 0 ? windowPoints + 1 : windowPoints;
  const radius = Math.floor(k / 2);
  const scratch = [];

  for (let i = radius; i < values.length - radius; i += 1) {
    if (freq[i] < startHz) continue;
    scratch.length = 0;
    for (let j = i - radius; j <= i + radius; j += 1) {
      scratch.push(values[j]);
    }
    scratch.sort((a, b) => a - b);
    output[i] = scratch[radius];
  }

  return output;
}

function formatRbw(rbwHz) {
  if (rbwHz >= 1e6) return `${(rbwHz / 1e6).toPrecision(3)} MHz`;
  if (rbwHz >= 1e3) return `${(rbwHz / 1e3).toPrecision(3)} kHz`;
  return `${rbwHz.toPrecision(3)} Hz`;
}

function drawLimitLine(ctx, points, xMap, yMap, color, dash, xMax) {
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < points.length; i += 1) {
    if (points[i][0] > xMax) continue;
    const x = xMap(points[i][0]);
    const y = yMap(points[i][1]);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.setLineDash(dash);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.1;
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawLegend(ctx, plot) {
  const x = plot.right - 192;
  const y = plot.top + 14;
  ctx.font = "11px Arial";
  ctx.fillStyle = "rgba(255,255,255,0.86)";
  ctx.strokeStyle = "#ccd6dc";
  ctx.fillRect(x - 10, y - 10, 180, 48);
  ctx.strokeRect(x - 10, y - 10, 180, 48);
  ctx.fillStyle = "#26343d";
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = "#111";
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 28, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillText("A2B upper/lower", x + 36, y + 1);
  ctx.strokeStyle = "#008fc7";
  ctx.beginPath();
  ctx.moveTo(x, y + 22);
  ctx.lineTo(x + 28, y + 22);
  ctx.stroke();
  ctx.fillText("Measured PSD", x + 36, y + 23);
}

function drawWaveform() {
  const { ctx, w, h } = setupCanvas(els.waveCanvas);
  clearPlot(ctx, w, h);
  const signal = state.signal;
  if (!signal) {
    ctx.fillStyle = "#7b8b96";
    ctx.font = "13px Arial";
    ctx.textAlign = "center";
    ctx.fillText("Captured waveform preview", w / 2, h / 2);
    return;
  }

  const samples = Math.min(signal.length, Math.max(256, Math.floor(state.fs * 5e-6)));
  const plot = { left: 56, top: 18, right: w - 20, bottom: h - 42 };
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < samples; i += 1) {
    min = Math.min(min, signal[i]);
    max = Math.max(max, signal[i]);
  }
  const pad = Math.max((max - min) * 0.12, 1e-6);
  min -= pad;
  max += pad;
  const xMap = idx => plot.left + idx / Math.max(1, samples - 1) * (plot.right - plot.left);
  const yMap = v => plot.bottom - (v - min) / (max - min) * (plot.bottom - plot.top);
  const tMaxUs = samples / state.fs * 1e6;
  els.timeLabel.textContent = `${tMaxUs.toFixed(tMaxUs >= 10 ? 0 : 1)} μs`;

  drawAxes(ctx, plot, [0, +(tMaxUs / 2).toFixed(2), +tMaxUs.toFixed(2)], [min.toFixed(2), ((min + max) / 2).toFixed(2), max.toFixed(2)], v => plot.left + v / tMaxUs * (plot.right - plot.left), yMap, {
    x: "Time (μs)",
    y: "V"
  });

  ctx.beginPath();
  for (let i = 0; i < samples; i += 1) {
    const x = xMap(i);
    const y = yMap(signal[i]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "#19a967";
  ctx.lineWidth = 1.15;
  ctx.stroke();
}

function generateDemo() {
  const fs = 500e6;
  const fb = 10e6;
  const halfSamples = Math.round(fs / (2 * fb));
  const bits = 4096;
  const n = bits * 2 * halfSamples;
  const signal = new Float64Array(n);
  let idx = 0;
  for (let b = 0; b < bits; b += 1) {
    const bit = Math.random() > 0.5 ? 1 : 0;
    const first = bit ? 0.5 : -0.5;
    const second = -first;
    for (let i = 0; i < halfSamples; i += 1) signal[idx++] = first + 0.018 * (Math.random() - 0.5);
    for (let i = 0; i < halfSamples; i += 1) signal[idx++] = second + 0.018 * (Math.random() - 0.5);
  }
  state.fileName = "demo_a2b.csv";
  state.signal = signal;
  state.time = null;
  state.fs = fs;
  state.psd = null;
  state.lastCsv = "";
  els.fileMeta.textContent = `${state.fileName} · ${signal.length.toLocaleString()} samples · Fs ${(fs / 1e6).toFixed(3)} MHz`;
  els.summary.textContent = "已生成演示波形，等待分析";
  log(`Demo waveform generated.\nSamples: ${signal.length}\nFs: ${fs} Hz`, "ok");
  setBusy(false);
  drawWaveform();
  drawPsdPlaceholder();
}

els.fileInput.addEventListener("change", event => {
  const file = event.target.files && event.target.files[0];
  if (file) loadTextFile(file);
});

["dragenter", "dragover"].forEach(type => {
  els.dropZone.addEventListener(type, event => {
    event.preventDefault();
    els.dropZone.classList.add("drag");
  });
});

["dragleave", "drop"].forEach(type => {
  els.dropZone.addEventListener(type, event => {
    event.preventDefault();
    els.dropZone.classList.remove("drag");
  });
});

els.dropZone.addEventListener("drop", event => {
  const file = event.dataTransfer.files && event.dataTransfer.files[0];
  if (file) loadTextFile(file);
});

els.runButton.addEventListener("click", runAnalysis);
els.demoButton.addEventListener("click", generateDemo);
els.exportButton.addEventListener("click", exportCsv);
els.loadSelect.addEventListener("change", () => {
  if (!state.psd) return;
  state.psd = convertPsd(state.psd, Number(els.loadSelect.value));
  state.lastCsv = buildCsv(state.psd);
  drawPsd();
});
els.rbwInput.addEventListener("change", () => {
  if (!state.psd) return;
  state.psd = convertPsd(state.psd, Number(els.loadSelect.value));
  state.lastCsv = buildCsv(state.psd);
  drawPsd();
});
els.driveSelect.addEventListener("change", () => {
  if (!state.psd) return;
  drawPsd();
  const stats = complianceStats(state.psd);
  els.summary.textContent = `${stats.pass ? "PASS" : "FAIL"} · upper ${stats.worstUpperMargin.toFixed(2)} dB · lower ${Number.isFinite(stats.worstLowerMargin) ? stats.worstLowerMargin.toFixed(2) : "N/A"} dB`;
});
els.maskToggle.addEventListener("change", drawPsd);
els.notch100Toggle.addEventListener("change", () => {
  if (!state.psd) return;
  state.lastCsv = buildCsv(state.psd);
  drawPsd();
  const stats = complianceStats(state.psd);
  els.summary.textContent = `${stats.pass ? "PASS" : "FAIL"} · upper ${stats.worstUpperMargin.toFixed(2)} dB · lower ${Number.isFinite(stats.worstLowerMargin) ? stats.worstLowerMargin.toFixed(2) : "N/A"} dB`;
});
for (const el of [els.spurFundamentalInput, els.spurWidthInput]) {
  el.addEventListener("change", () => {
    if (!state.psd) return;
    state.lastCsv = buildCsv(state.psd);
    drawPsd();
    const stats = complianceStats(state.psd);
    els.summary.textContent = `${stats.pass ? "PASS" : "FAIL"} · upper ${stats.worstUpperMargin.toFixed(2)} dB · lower ${Number.isFinite(stats.worstLowerMargin) ? stats.worstLowerMargin.toFixed(2) : "N/A"} dB`;
  });
}
window.addEventListener("resize", () => {
  drawPsd();
  drawWaveform();
});

drawPsdPlaceholder();
drawWaveform();
