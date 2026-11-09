'use strict';

const M = SoccerModel;
const $ = id => document.getElementById(id);
const SOURCE_LABEL = 'Device Connection';
let shots = [];
let seen = new Set();
let timer = null;
let running = false;
let generation = 0;
let cursor = 0;
let stream = null;
let failures = 0;
let activeRequest = null;

function message(text, state) {
  $('notice').textContent = text;
  $('connection').textContent = state;
}

function formatSpeed(value) {
  if (value === null) return '—';
  const factors = { kmh: 3.6, mps: 1, mph: 2.2369362921 };
  return (value * factors[$('unit').value]).toFixed(1);
}

function sourceLabel() {
  return $('mode').value === 'live' ? SOURCE_LABEL : 'Demonstration';
}

function render() {
  const summary = M.summary(shots);
  const latest = shots[shots.length - 1];
  const unit = { kmh: 'km/h', mps: 'm/s', mph: 'mph' }[$('unit').value];

  $('speed').textContent = formatSpeed(latest?.speed_mps ?? null);
  $('average').textContent = formatSpeed(summary.average);
  $('count').textContent = summary.count;
  $('accuracy').textContent = summary.classified
    ? Math.round(100 * summary.hits / summary.classified) + '%'
    : '—';
  $('accuracy-note').textContent = summary.classified
    ? `${summary.hits} hits / ${summary.classified} classified shots`
    : 'No classified shots';

  document.querySelectorAll('.unit-label').forEach(element => {
    element.textContent = unit;
  });

  $('result').textContent = latest
    ? { hit: 'Target hit.', miss: 'Keep aiming.', unknown: 'Shot recorded.' }[latest.result]
    : 'Ready when you are.';
  $('result-description').textContent = latest
    ? (latest.result === 'unknown'
      ? 'Target outcome is not available for this shot.'
      : `Shot ${latest.shot_id} • received from device`)
    : 'Connect the device to view shot results.';
  $('selected').textContent = latest?.selected_zone ?? '—';
  $('detected').textContent = latest?.detected_zone ?? '—';
  $('validity').textContent = latest?.speed_status ?? 'Waiting';
  $('source').textContent = sourceLabel();

  document.querySelectorAll('.zone').forEach(element => {
    element.classList.toggle('selected', element.dataset.zone === latest?.selected_zone);
    element.classList.toggle('detected', element.dataset.zone === latest?.detected_zone);
  });

  $('rows').replaceChildren();
  if (!shots.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 6;
    cell.className = 'empty';
    cell.textContent = 'Your shots will appear here.';
    row.append(cell);
    $('rows').append(row);
  }

  for (const shot of [...shots].reverse()) {
    const row = document.createElement('tr');
    const speed = shot.speed_mps === null ? '—' : `${formatSpeed(shot.speed_mps)} ${unit}`;
    const values = [shot.shot_id, speed, shot.selected_zone ?? '—',
      shot.detected_zone ?? '—', shot.result, SOURCE_LABEL];
    values.forEach((value, index) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      if (index === 4) cell.className = shot.result;
      row.append(cell);
    });
    $('rows').append(row);
  }
  $('export').disabled = !shots.length;
}

function accept(shot) {
  if (!M.validate(shot)) throw Error('Invalid shot payload');
  const key = M.key(shot);
  if (seen.has(key)) return;
  shots.push(shot);
  seen.add(key);
  if (shots.length > 200) seen.delete(M.key(shots.shift()));
}

function reset() {
  shots = [];
  seen.clear();
  render();
}

function stop() {
  running = false;
  generation++;
  clearTimeout(timer);
  if (activeRequest) activeRequest.abort();
  $('start').disabled = $('mode').value !== 'live';
  $('pause').disabled = true;
}

async function poll(currentGeneration) {
  if (!running || currentGeneration !== generation) return;
  const control = new AbortController();
  activeRequest = control;
  const timeout = setTimeout(() => control.abort(), 2000);

  try {
    const response = await fetch('/api/events?after=' + cursor, {
      cache: 'no-store',
      signal: control.signal
    });
    if (!running || currentGeneration !== generation) return;
    if (!response.ok) throw Error('Device connection unavailable');
    const data = await response.json();
    if (!running || currentGeneration !== generation) return;

    if (typeof data.stream_id !== 'string' ||
        !Number.isSafeInteger(data.cursor) || data.cursor < 0 ||
        !Array.isArray(data.shots) || data.shots.length > 256 ||
        !data.shots.every(M.validate)) {
      throw Error('Invalid event response');
    }
    if (data.mode !== 'sensor' || !data.shots.every(shot => shot.source === 'sensor')) {
      throw Error('Device measurements required');
    }

    if (stream !== null && stream !== data.stream_id) reset();
    stream = data.stream_id;
    data.shots.forEach(accept);
    cursor = data.cursor;
    failures = 0;
    render();

    const gap = data.gap ? ' Some older results are no longer available.' : '';
    const fault = data.queue_overflows > 0
      ? ' Sensor queue overflow reported; measurements require review.' : '';
    message('Device connected. Waiting for shot results.' + gap + fault, 'Device connected');
  } catch (error) {
    if (!running || currentGeneration !== generation) return;
    failures++;
    message('Device unavailable or invalid data. Retrying; previous results remain visible.',
      'Not connected');
  } finally {
    clearTimeout(timeout);
    if (activeRequest === control) activeRequest = null;
  }

  if (running && currentGeneration === generation) {
    const delay = failures ? Math.min(4000, 250 * 2 ** failures) : 250;
    timer = setTimeout(() => poll(currentGeneration), delay);
  }
}

$('start').addEventListener('click', () => {
  if (running || $('mode').value !== 'live') return;
  running = true;
  $('start').disabled = true;
  $('pause').disabled = false;
  const currentGeneration = ++generation;
  message('Connecting to device…', 'Connecting');
  poll(currentGeneration);
});

$('pause').addEventListener('click', () => {
  stop();
  message('Device disconnected. Previous results remain visible.', 'Not connected');
});

$('clear').addEventListener('click', () => {
  reset();
  message(running ? 'View cleared. Waiting for new shot results.' : 'Waiting for device connection.',
    failures ? 'Not connected' : (running ? 'Listening' : 'Not connected'));
});

$('mode').addEventListener('change', () => {
  stop();
  reset();
  cursor = 0;
  stream = null;
  failures = 0;
  message('Waiting for device connection.', 'Not connected');
});

$('unit').addEventListener('change', render);

$('export').addEventListener('click', () => {
  const fields = ['device_id', 'boot_id', 'shot_id', 'source', 'speed_mps',
    'speed_status', 'selected_zone', 'detected_zone', 'result', 'device_time_us'];
  const cell = value => '"' + String(value ?? '')
    .replace(/^[=+@-]/, "'$&").replaceAll('"', '""') + '"';
  const csv = [fields.join(','), ...shots.map(shot =>
    fields.map(field => cell(shot[field])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'soccer-shot-results.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

render();
