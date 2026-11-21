// Nepal Ham Morse Tutor - Android / web version: screens, sound and settings.
'use strict';

const VERSION = '0.3';
const AUTHOR = '9N1AA';
const CONTACT_URL = 'https://www.qrz.com/db/9N1AA';
const EXAM_REVEAL_DELAY_S = 30;

const MODES = ['drill', 'koch', 'calls', 'words', 'qso', 'free', 'exam', 'sendLetters', 'sendWords'];

// ---------- Settings ----------

const DEFAULTS = { charWpm: 15, effWpm: 5, toneHz: 600, volume: 70, groups: 10, groupSize: 5,
  lesson: 1, examMinutes: 15, passMark: 60, lang: 'ne', best: {} };
const STORE_KEY = 'nhmt-settings';

function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { s = {}; }
  return Object.assign({}, DEFAULTS, s, { best: Object.assign({}, s.best || {}) });
}
const settings = loadSettings();
function saveSettings() { try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* private mode */ } }

const $ = id => document.getElementById(id);
// Inside the Android APK, the app provides window.AndroidApp for sharing, saving and so on.
const androidApp = (window.AndroidApp && typeof window.AndroidApp.isAndroidApp === 'function') ? window.AndroidApp : null;
const nepali = () => settings.lang === 'ne';
const S = (en, ne) => (nepali() ? ne : en);
const fmt = (s, ...a) => s.replace(/\{(\d+)\}/g, (_, i) => a[i]);

// ---------- State ----------

let mode = 'drill';                 // the app always opens in the letter drill
let currentText = '';
let examInProgress = false, examLocked = false, examRevealAt = 0, revealTimer = 0, examInfo = '';
let drillActive = false, drillAwaiting = false, drillChar = '', drillPrev1 = '', drillPrev2 = '';
let drillRight = 0, drillTotal = 0, drillMissed = {}, drillTimer = 0;
let decoder = new SendDecoder(settings.charWpm, settings.effWpm);
let keyIsDown = false, decodeTimer = 0;

const usesLesson = () => mode === 'drill' || mode === 'koch' || mode === 'sendLetters';
const isSending = () => mode === 'sendLetters' || mode === 'sendWords';

// ---------- Sound ----------

let ctx = null;
let playback = null;     // { osc, gain }
let sidetone = null;     // { osc, gain }
let wakeLock = null;

function audio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
const amplitude = () => Math.max(0, Math.min(1, settings.volume / 100)) * 0.6;

async function keepScreenOn(on) {
  if (androidApp) { androidApp.keepScreenOn(!!on); return; }
  try {
    if (on && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { wakeLock = null; }
}

/** Plays text as Morse. Calls onEnd when it finishes (not when stopped). Returns seconds. */
function play(text, onEnd) {
  stopPlayback();
  const segs = Morse.segments(text, settings.charWpm, settings.effWpm);
  if (!segs.length) return 0;
  const c = audio();
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.value = settings.toneHz;
  gain.gain.value = 0;
  osc.connect(gain).connect(c.destination);
  const amp = amplitude();
  const start = c.currentTime + 0.15;
  let t = start;
  for (const s of segs) {
    if (s.tone) {
      const r = Math.min(0.005, s.s / 4);     // 5 ms rise and fall: no key clicks
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(amp, t + r);
      gain.gain.setValueAtTime(amp, t + s.s - r);
      gain.gain.linearRampToValueAtTime(0, t + s.s);
    }
    t += s.s;
  }
  const p = { osc, gain };
  osc.onended = () => {
    if (playback !== p) return;
    playback = null;
    keepScreenOn(false);
    updateButtons();
    if (onEnd) onEnd();
  };
  osc.start(start - 0.01);
  osc.stop(t + 0.3);
  playback = p;
  keepScreenOn(true);
  updateButtons();
  return t - start;
}

function stopPlayback() {
  if (!playback) return;
  const p = playback;
  playback = null;
  p.osc.onended = null;
  try {
    p.gain.gain.cancelScheduledValues(0);
    p.gain.gain.setValueAtTime(0, ctx.currentTime);
    p.osc.stop();
  } catch (e) { /* already stopped */ }
  keepScreenOn(false);
  updateButtons();
}

function beep() {
  try {
    const c = audio(), o = c.createOscillator(), g = c.createGain();
    o.frequency.value = 880; g.gain.value = 0;
    o.connect(g).connect(c.destination);
    const t = c.currentTime + 0.02;
    g.gain.linearRampToValueAtTime(amplitude(), t + 0.01);
    g.gain.setValueAtTime(amplitude(), t + 0.25);
    g.gain.linearRampToValueAtTime(0, t + 0.27);
    o.start(t); o.stop(t + 0.3);
  } catch (e) { /* no sound */ }
  if (androidApp) androidApp.vibrate(200);
  else if (navigator.vibrate) navigator.vibrate(200);
}

function sidetoneKey(down) {
  try {
    const c = audio();
    if (!sidetone) {
      const osc = c.createOscillator(), gain = c.createGain();
      osc.frequency.value = settings.toneHz; gain.gain.value = 0;
      osc.connect(gain).connect(c.destination);
      osc.start();
      sidetone = { osc, gain };
    }
    sidetone.osc.frequency.setValueAtTime(settings.toneHz, c.currentTime);
    sidetone.gain.gain.setTargetAtTime(down ? amplitude() : 0, c.currentTime, 0.002);
  } catch (e) { /* send without tone */ }
}

function stopSidetone() {
  if (!sidetone) return;
  try { sidetone.osc.stop(); } catch (e) { /* ignore */ }
  sidetone = null;
}

// ---------- Text in both languages ----------

function modeName(m) {
  switch (m) {
    case 'drill': return S('Letter drill (one at a time, answer to continue)', 'एक-एक अक्षर अभ्यास (उत्तर दिएपछि मात्र अर्को)');
    case 'koch': return S('Koch lessons (random letter groups)', 'कोच पाठ (अक्षरका अनियमित समूह)');
    case 'calls': return S('Callsigns', 'कल साइन');
    case 'words': return S('Ham words and abbreviations', 'ह्याम शब्द र संक्षिप्त रूप');
    case 'qso': return S('Practice QSO (on-air exchange)', 'अभ्यास QSO (रेडियो सम्पर्क)');
    case 'free': return S('Free text (type text, hear it in Morse)', 'आफ्नै पाठ (टाइप गर्नुहोस्, मोर्समा सुन्नुहोस्)');
    case 'exam': return S('Mock exam', 'नमुना परीक्षा');
    case 'sendLetters': return S('Sending practice (Koch letters)', 'पठाउने अभ्यास (कोच अक्षर)');
    default: return S('Sending practice (words and callsigns)', 'पठाउने अभ्यास (शब्द र कल साइन)');
  }
}

function applyLanguage() {
  document.documentElement.lang = nepali() ? 'ne' : 'en';
  const set = (id, en, ne) => { $(id).textContent = S(en, ne); };
  set('appTitle', 'Nepal Ham Morse Tutor', 'नेपाल ह्याम मोर्स ट्युटर');
  $('btnLang').textContent = nepali() ? 'English' : 'नेपाली';
  set('btnAbout', 'About', 'यसको बारेमा');
  set('lblMode', 'Mode', 'विधि');
  set('lblLesson', 'Koch lesson', 'कोच पाठ');
  set('btnNewChar', 'Hear new letter', 'नयाँ अक्षर सुन्नुहोस्');
  set('lblExamMinutes', 'Length (min)', 'अवधि (मिनेट)');
  set('lblPassMark', 'Pass mark (%)', 'उत्तीर्णांक (%)');
  set('btnExamPreset', 'Use Nepal exam settings (15/5 WPM, 15 min)', 'नेपाल परीक्षाको ढाँचा (15/5 WPM, 15 मिनेट)');
  set('examNote', '5-letter words and 10 callsigns, sent without a break. Write on paper; the answer sheet opens 30 seconds after the test ends.',
    '५ अक्षरका शब्द र १० कल साइन, लगातार बज्छन्। कागजमा लेख्नुहोस्; परीक्षा सकिएको ३० सेकेन्डपछि उत्तरपत्र खुल्छ।');
  set('lblGroupSize', 'Letters per group', 'प्रति समूह अक्षर');
  set('lblSound', 'Sound and speed', 'आवाज र गति');
  set('lblCharWpm', 'Character speed (WPM)', 'अक्षर गति (WPM)');
  set('lblEffWpm', 'Effective speed (WPM, Farnsworth)', 'प्रभावकारी गति (WPM, फार्न्सवर्थ)');
  set('lblTone', 'Tone pitch (Hz)', 'टोनको पिच (Hz)');
  set('lblVolume', 'Volume', 'भोल्युम');
  set('soundNote', 'Letters are sent at character speed; extra space is added between them.',
    'अक्षर पूरा गतिमै बज्छन्; अक्षरहरूबीच सोच्ने थप समय दिइन्छ।');
  set('lblSendTarget', 'SEND:', 'पठाउनुहोस्:');
  set('lblSendYou', 'YOU:', 'तपाईं:');
  set('keyPadText', 'KEY\nHold here to send', 'बटन (KEY)\nपठाउन यहाँ थिचिराख्नुहोस्');
  $('keyPadText').style.whiteSpace = 'pre-line';
  set('btnStart', 'Start', 'सुरु');
  set('btnStop', 'Stop', 'रोक');
  set('btnReplay', 'Replay', 'फेरि सुन');
  set('btnCheck', 'Check', 'जाँच');
  set('btnShow', 'Show answer', 'उत्तर हेर');
  set('sheetTitle', 'Answer sheet', 'उत्तरपत्र');
  set('btnSheetShare', 'Share', 'सेयर');
  set('btnSheetSave', 'Save to file', 'फाइलमा सुरक्षित');
  set('btnSheetCopy', 'Copy', 'कपी');
  set('btnSheetClose', 'Close', 'बन्द');
  set('btnAskYes', 'Yes', 'हो');
  set('btnAskNo', 'No', 'होइन');

  const sel = $('mode');
  sel.innerHTML = '';
  for (const m of MODES) {
    const o = document.createElement('option');
    o.value = m; o.textContent = modeName(m);
    sel.appendChild(o);
  }
  sel.value = mode;
  updateModeUi(false);
}

// ---------- Screens ----------

function setStatus(text) { $('status').textContent = text; }
function setResult(text) { $('result').textContent = text; }

function updateLessonInfo() {
  const lesson = settings.lesson;
  $('lessonNum').textContent = lesson;
  const chars = Content.lessonChars(lesson), newest = chars[chars.length - 1];
  let s = S('Letters: ', 'अक्षर: ') + [...chars].join(' ') + '\n' + S('New: ', 'नयाँ: ');
  s += lesson === 1 ? `K  ${Morse.codeDisplay('K')}     M  ${Morse.codeDisplay('M')}` : `${newest}  ${Morse.codeDisplay(newest)}`;
  if (mode === 'koch' && settings.best[lesson] !== undefined) s += S('    Best: ', '    उत्कृष्ट: ') + settings.best[lesson] + '%';
  $('lessonInfo').textContent = s;
  if (mode === 'drill') buildDrillButtons();
}

function buildDrillButtons() {
  const box = $('drillButtons');
  box.innerHTML = '';
  const chars = Content.lessonChars(settings.lesson);
  [...chars].forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = c;
    if (i === chars.length - 1 && settings.lesson > 1) b.className = 'newest';
    b.addEventListener('click', () => drillAnswer(c));
    box.appendChild(b);
  });
}

function modeHint() {
  if (mode === 'exam') return S('Write on paper during the test. Afterwards you may type your copy here and press Check for a score:',
    'परीक्षाको बेला कागजमा लेख्नुहोस्। पछि चाहेमा आफ्नो उत्तर यहाँ टाइप गरी \'जाँच\' थिचेर अंक हेर्न सकिन्छ:');
  if (mode === 'free') return S('Type or paste any text below, then press Start to hear it in Morse:',
    'तल कुनै पनि पाठ टाइप वा पेस्ट गर्नुहोस्, अनि मोर्समा सुन्न \'सुरु\' थिच्नुहोस्:');
  if (mode === 'qso') return S('Copy the exchange as you hear it (callsigns, RST, name, QTH):',
    'सुनेको सम्पर्क सन्देश लेख्नुहोस् (कल साइन, RST, नाम, QTH):');
  return S('Type what you hear. Put a space between groups. If you miss a letter, just leave it out:',
    'सुनेको टाइप गर्नुहोस्। समूहहरूबीच खाली ठाउँ राख्नुहोस्। अक्षर छुटेमा छोडेर अगाडि बढ्नुहोस्:');
}

function modeStartMessage() {
  if (mode === 'drill') return S('One letter at a time from this lesson. Answer each one to hear the next. Press Start to begin.',
    'यस पाठका अक्षर एक-एक गरी बज्छन्। हरेकको उत्तर दिएपछि अर्को सुनिन्छ। सुरु गर्न \'सुरु\' थिच्नुहोस्।');
  if (isSending()) return S('Press Start for text to send. Hold the blue KEY to send.',
    'पठाउने पाठ पाउन \'सुरु\' थिच्नुहोस्। पठाउन नीलो बटन (KEY) थिचिराख्नुहोस्।');
  if (mode === 'exam') return S('Have paper and pen ready, then press Start. The test is heard only once.',
    'कागज र कलम तयार राखेर \'सुरु\' थिच्नुहोस्। परीक्षा एकपटक मात्र सुनिन्छ।');
  if (mode === 'free') return S('Type some text, then press Start.', 'केही पाठ टाइप गरेर \'सुरु\' थिच्नुहोस्।');
  return S('Press Start to hear Morse, type what you hear, then press Check.',
    'मोर्स सुन्न \'सुरु\' थिच्नुहोस्, सुनेको टाइप गर्नुहोस्, अनि \'जाँच\' थिच्नुहोस्।');
}

/** Shows the parts of the screen this mode uses. modeChanged resets the practice. */
function updateModeUi(modeChanged) {
  const drill = mode === 'drill', exam = mode === 'exam', sending = isSending();
  $('lessonRow').hidden = !usesLesson();
  $('examRow').hidden = !exam;
  const groupsUsed = ['koch', 'calls', 'words', 'sendLetters', 'sendWords'].includes(mode);
  $('countRow').hidden = !groupsUsed;
  const sizeUsed = mode === 'koch' || mode === 'sendLetters';
  $('lblGroupSize').hidden = $('groupSize').hidden = !sizeUsed;
  $('lblGroups').textContent = sizeUsed ? S('Groups', 'समूह') : S('Items', 'संख्या');
  $('drillPanel').hidden = !drill;
  $('copyPanel').hidden = drill || sending;
  $('sendPanel').hidden = !sending;
  $('btnCheck').hidden = drill || mode === 'free';
  $('btnShow').hidden = drill || sending || mode === 'free';
  $('inputHint').textContent = modeHint();
  $('copyInput').style.textTransform = mode === 'free' ? 'none' : 'uppercase';
  updateLessonInfo();

  if (modeChanged) {
    stopPlayback();
    clearTimeout(drillTimer);
    clearInterval(revealTimer);
    currentText = '';
    examInProgress = examLocked = false;
    drillActive = drillAwaiting = false;
    $('copyInput').value = '';
    setResult('');
    const dr = $('drillResult');
    dr.className = 'drill-result';
    dr.textContent = '';
    if (sending) {
      decoder.reset(settings.charWpm, settings.effWpm);
      clearInterval(decodeTimer);
      decodeTimer = setInterval(() => { if (decoder.tick(performance.now() / 1000)) refreshSendDisplay(); }, 20);
    } else {
      clearInterval(decodeTimer);
      stopSidetone();
    }
    refreshSendDisplay();
    setStatus(modeStartMessage());
  }
  updateButtons();
}

function updateButtons() {
  const playing = !!playback;
  $('btnStart').disabled = examInProgress;
  $('btnStop').disabled = !(playing || drillActive || examInProgress);
  $('btnReplay').disabled = !currentText || examInProgress || examLocked;
  $('btnCheck').disabled = !currentText || examInProgress || examLocked;
  $('btnShow').disabled = !currentText || examInProgress || examLocked;
  $('mode').disabled = examInProgress || examLocked;
  $('btnNewChar').disabled = playing || examInProgress;
}

// ---------- Letter drill ----------

function drillScore() {
  const pct = drillTotal ? Math.round(100 * drillRight / drillTotal) : 0;
  return fmt(S('Right: {0} of {1} ({2}%)', 'सही: {1} मध्ये {0} ({2}%)'), drillRight, drillTotal, pct);
}
const askWhich = () => S('Which letter was that? Tap its button. Replay plays it again.',
  'कुन अक्षर बज्यो? त्यसको बटन थिच्नुहोस्। फेरि सुन्न \'फेरि सुन\'।');

function drillNext() {
  const c = Content.drillPick(Content.lessonChars(settings.lesson), drillPrev1, drillPrev2);
  drillPrev2 = drillPrev1; drillPrev1 = c;
  drillChar = c;
  drillAwaiting = true;
  currentText = c;
  play(c);
  setStatus(askWhich());
}

function drillAnswer(answer) {
  if (!drillActive || !drillAwaiting) return;
  drillAwaiting = false;
  stopPlayback();
  drillTotal++;
  const right = answer.toUpperCase() === drillChar;
  const dr = $('drillResult');
  if (right) {
    drillRight++;
    dr.className = 'drill-result right';
    dr.textContent = fmt(S('✔  Right:  {0}   {1}', '✔  सही:  {0}   {1}'), drillChar, Morse.codeDisplay(drillChar)) + '\n' + drillScore();
  } else {
    drillMissed[drillChar] = (drillMissed[drillChar] || 0) + 1;
    dr.className = 'drill-result wrong';
    dr.textContent = fmt(S('✘  Wrong: you pressed {0}.  It was {1}   {2}', '✘  गलत: तपाईंले {0} थिच्नुभयो।  सही: {1}   {2}'),
      answer.toUpperCase(), drillChar, Morse.codeDisplay(drillChar)) + '\n' + drillScore();
  }
  updateButtons();
  // Next letter after a short pause; longer after a mistake so the answer can be read.
  drillTimer = setTimeout(() => { if (drillActive) drillNext(); }, right ? 700 : 1600);
}

function endDrill() {
  drillActive = drillAwaiting = false;
  clearTimeout(drillTimer);
  stopPlayback();
  const dr = $('drillResult');
  dr.className = 'drill-result';
  let s = S('Stopped.  ', 'रोकियो।  ') + drillScore();
  const missed = Object.entries(drillMissed).sort((a, b) => b[1] - a[1]);
  if (missed.length) s += '\n' + S('Practise: ', 'अभ्यास गर्नुहोस्: ') + missed.map(([c, n]) => `${c} ×${n}`).join('   ');
  dr.textContent = s;
  setStatus(S('Press Start to drill again.', 'फेरि अभ्यास गर्न \'सुरु\' थिच्नुहोस्।'));
  updateButtons();
}

// ---------- Start, stop, replay ----------

function playingMessage(seconds) {
  return fmt(S('Sending at {0} WPM (effective {1} WPM), about {2} seconds...', '{0} WPM गतिमा (प्रभावकारी {1} WPM) बज्दैछ, करिब {2} सेकेन्ड...'),
    settings.charWpm, settings.effWpm, Math.round(seconds));
}

function onPlaybackFinished() {
  if (mode === 'drill') { if (drillAwaiting) setStatus(askWhich()); return; }
  if (isSending()) setStatus(S('Now send it yourself.', 'अब आफैँ पठाउनुहोस्।'));
  else if (mode === 'free') setStatus(S('Done.', 'सकियो।'));
  else setStatus(S('Done. Finish typing, then press Check.', 'सकियो। टाइप गरिसक्नुहोस्, अनि \'जाँच\' थिच्नुहोस्।'));
}

function onStart() {
  audio();      // phones allow sound only after a tap: start it here
  clearInterval(revealTimer);
  examLocked = examInProgress = false;

  if (mode === 'drill') {
    clearTimeout(drillTimer);
    drillActive = true;
    drillRight = drillTotal = 0;
    drillMissed = {};
    drillPrev1 = drillPrev2 = '';
    const dr = $('drillResult');
    dr.className = 'drill-result';
    dr.textContent = S('Listen...', 'सुन्नुहोस्...');
    drillNext();
    return;
  }

  let text;
  switch (mode) {
    case 'koch': case 'sendLetters': text = Content.kochGroups(settings.lesson, settings.groups, settings.groupSize); break;
    case 'calls': text = Content.callsigns(settings.groups); break;
    case 'words': text = Content.wordList(settings.groups); break;
    case 'sendWords': text = Content.sendWords(settings.groups); break;
    case 'qso': text = Content.qso(); break;
    case 'exam': text = Content.ministryExam(settings.examMinutes, settings.charWpm, settings.effWpm, 10); break;
    default: text = $('copyInput').value;
  }
  text = Morse.normalize(text);
  if (!text) {
    setStatus(S('Nothing to send. Type some letters or numbers first.', 'पठाउन केही छैन। पहिले केही अक्षर वा अंक टाइप गर्नुहोस्।'));
    return;
  }
  currentText = text;
  setResult('');

  if (isSending()) {
    stopPlayback();
    decoder.reset(settings.charWpm, settings.effWpm);
    refreshSendDisplay();
    setStatus(S('Hold the blue KEY to send the text, then press Check. Replay lets you hear it first.',
      'नीलो बटन (KEY) थिचिराखेर पाठ पठाउनुहोस्, अनि \'जाँच\' थिच्नुहोस्। पहिले सुन्न \'फेरि सुन\'।'));
    updateButtons();
    return;
  }

  if (mode !== 'free') $('copyInput').value = '';
  if (mode === 'exam') {
    examInProgress = true;
    const items = text.split(' ');
    const calls = items.filter(w => /\d/.test(w)).length;
    const d = new Date(), p2 = n => String(n).padStart(2, '0');
    const when = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
    examInfo = fmt(S('{0}   {1} minutes, {2} WPM characters, {3} WPM effective   {4} groups ({5} callsigns)',
      '{0}   {1} मिनेट, अक्षर गति {2} WPM, प्रभावकारी गति {3} WPM   {4} समूह ({5} कल साइन)'),
      when, settings.examMinutes, settings.charWpm, settings.effWpm, items.length, calls);
    play(text, beginExamLock);
    setStatus(fmt(S('Test running: {0} minute(s) at {1} WPM (effective {2} WPM). Write on paper. Stop ends the test early.',
      'परीक्षा चलिरहेको छ: {0} मिनेट, {1} WPM (प्रभावकारी {2} WPM)। कागजमा लेख्नुहोस्। \'रोक\' थिचे परीक्षा अगाडि नै सकिन्छ।'),
      settings.examMinutes, settings.charWpm, settings.effWpm));
    updateButtons();
    return;
  }
  const secs = play(text, onPlaybackFinished);
  setStatus(playingMessage(secs));
}

function onStop() {
  if (examInProgress) { stopPlayback(); beginExamLock(); return; }
  if (drillActive) { endDrill(); return; }
  stopPlayback();
  setStatus(S('Stopped.', 'रोकियो।'));
}

function onReplay() {
  if (!currentText || examInProgress || examLocked) return;
  audio();
  if (mode === 'drill') { play(currentText); setStatus(askWhich()); return; }
  const secs = play(currentText, onPlaybackFinished);
  setStatus(playingMessage(secs));
}

function onHearNewChar() {
  audio();
  const chars = Content.lessonChars(settings.lesson);
  const c = chars[chars.length - 1];
  play(settings.lesson === 1 ? 'K K K M M M' : `${c} ${c} ${c}`);
  setStatus(S('Listen to the rhythm of the new letter. Don\'t count dots and dashes.', 'नयाँ अक्षरको लय सुन्नुहोस्। डट र ड्यास नगन्नुहोस्।'));
}

// ---------- Mock exam lock ----------

function beginExamLock() {
  examInProgress = false;
  examLocked = true;
  examRevealAt = Date.now() + EXAM_REVEAL_DELAY_S * 1000;
  clearInterval(revealTimer);
  revealTimer = setInterval(revealTick, 250);
  revealTick();
  updateButtons();
}

function revealTick() {
  if (!examLocked) { clearInterval(revealTimer); return; }
  const left = Math.ceil((examRevealAt - Date.now()) / 1000);
  if (left > 0) {
    setStatus(fmt(S('Test finished. Finish writing on paper. The answer sheet opens in {0} seconds.',
      'परीक्षा सकियो। कागजमा लेखिसक्नुहोस्। उत्तरपत्र {0} सेकेन्डपछि खुल्छ।'), left));
    return;
  }
  examLocked = false;
  clearInterval(revealTimer);
  updateButtons();
  setStatus(S('The answer sheet is ready: press "Show answer". You may also type your paper copy above and press Check for a score.',
    'उत्तरपत्र तयार छ: \'उत्तर हेर\' थिच्नुहोस्। चाहेमा कागजको उत्तर माथि टाइप गरी \'जाँच\' थिचेर अंक हेर्न सकिन्छ।'));
  beep();
}

function examSheetText() {
  return S('MOCK EXAM ANSWER SHEET', 'नमुना परीक्षा उत्तरपत्र') + '\n' + examInfo + '\n\n' + Content.answerSheet(currentText, 5);
}

function onShowAnswer() {
  if (!currentText || examInProgress || examLocked) return;
  if (mode === 'exam') {
    $('sheetText').textContent = examSheetText();
    $('sheetDialog').showModal();
    return;
  }
  setResult(S('Sent:      ', 'पठाइएको:    ') + currentText);
}

function saveSheet() {
  const text = examSheetText().replace(/\n/g, '\r\n');
  const d = new Date(), p2 = n => String(n).padStart(2, '0');
  const fileName = `mock-exam-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.txt`;
  if (androidApp) { androidApp.saveText(fileName, text); return; }
  const blob = new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.download = fileName;
  a.href = URL.createObjectURL(blob);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function shareSheet() {
  const text = examSheetText();
  if (androidApp) { androidApp.share(S('Answer sheet', 'उत्तरपत्र'), text); return; }
  try {
    if (navigator.share) await navigator.share({ title: S('Answer sheet', 'उत्तरपत्र'), text });
    else { await navigator.clipboard.writeText(text); setStatus(S('Copied.', 'कपी भयो।')); }
  } catch (e) { /* cancelled */ }
}

async function copySheet() {
  if (androidApp) { androidApp.copy(examSheetText()); setStatus(S('Answer sheet copied.', 'उत्तरपत्र कपी भयो।')); return; }
  try { await navigator.clipboard.writeText(examSheetText()); setStatus(S('Answer sheet copied.', 'उत्तरपत्र कपी भयो।')); }
  catch (e) { setStatus(S('Could not copy.', 'कपी गर्न सकिएन।')); }
}

// ---------- Checking ----------

function missedList(r) {
  const missed = Object.entries(r.missed).sort((a, b) => b[1] - a[1]);
  if (!missed.length) return '';
  return S('Practise these: ', 'यी अक्षर अभ्यास गर्नुहोस्: ') + missed.map(([c]) => `${c} (${Morse.codeDisplay(c)})`).join('   ');
}

function ask(text) {
  return new Promise(resolve => {
    const dlg = $('askDialog');
    $('askText').textContent = text;
    const done = v => { $('btnAskYes').onclick = $('btnAskNo').onclick = null; dlg.close(); resolve(v); };
    $('btnAskYes').onclick = () => done(true);
    $('btnAskNo').onclick = () => done(false);
    dlg.showModal();
  });
}

async function onCheck() {
  if (mode === 'free' || mode === 'drill') return;
  if (!currentText) { setStatus(S('Press Start first.', 'पहिले \'सुरु\' थिच्नुहोस्।')); return; }
  if (isSending()) { checkSending(); return; }

  stopPlayback();
  const r = Scoring.score(currentText, $('copyInput').value);
  const pct = Math.round(r.accuracy * 100);
  let s = '';
  if (mode === 'exam') {
    const pass = pct >= settings.passMark;
    s += fmt(S('RESULT: {0}   accuracy {1}%, pass mark {2}%', 'नतिजा: {0}   शुद्धता {1}%, उत्तीर्णांक {2}%'),
      pass ? S('PASS', 'उत्तीर्ण') : S('NOT PASSED', 'अनुत्तीर्ण'), pct, settings.passMark) + '\n';
  } else {
    s += fmt(S('Accuracy: {0}%', 'शुद्धता: {0}%'), pct) + '\n';
  }
  s += S('Sent:      ', 'पठाइएको:    ') + r.sent + '\n';
  s += S('You typed: ', 'तपाईंले लेख्नुभएको: ') + r.typed + '\n';
  s += missedList(r);
  setResult(s);

  if (mode === 'exam') {
    setStatus(S('You can now replay the exam and compare. Press Start for a new exam.',
      'अब परीक्षा फेरि सुनेर दाँज्न सक्नुहुन्छ। नयाँ परीक्षाका लागि \'सुरु\' थिच्नुहोस्।'));
    return;
  }
  if (mode === 'koch') {
    const lesson = settings.lesson;
    if (settings.best[lesson] === undefined || pct > settings.best[lesson]) {
      settings.best[lesson] = pct;
      saveSettings();
      updateLessonInfo();
    }
    if (pct >= 90 && lesson < Content.MAX_LESSON) {
      const next = Content.lessonChars(lesson + 1)[lesson + 1];
      const yes = await ask(fmt(S('Well done: {0}% on lesson {1}.\n\nMove to lesson {2} and learn the letter {3}?',
        'शाबास! पाठ {1} मा {0}%।\n\nपाठ {2} मा गएर \'{3}\' अक्षर सिक्ने?'), pct, lesson, lesson + 1, next));
      if (yes) {
        setLesson(lesson + 1);
        setStatus(S('New lesson. Press "Hear new letter" first, then Start.',
          'नयाँ पाठ। पहिले \'नयाँ अक्षर सुन्नुहोस्\' थिच्नुहोस्, अनि \'सुरु\'।'));
        return;
      }
    } else if (pct < 90) {
      setStatus(S('Reach 90% to move on to the next lesson. Press Start for a new set.',
        'अर्को पाठमा जान 90% पुग्नुपर्छ। नयाँ सेटका लागि \'सुरु\' थिच्नुहोस्।'));
      return;
    }
  }
  setStatus(S('Press Start for a new set.', 'नयाँ सेटका लागि \'सुरु\' थिच्नुहोस्।'));
}

// ---------- Sending practice ----------

function refreshSendDisplay() {
  $('sendTarget').textContent = currentText && isSending() ? currentText
    : S('(press Start for text to send)', '(पठाउने पाठका लागि \'सुरु\' थिच्नुहोस्)');
  $('sendYou').textContent = decoder.display;
}

function keyAction(pressed) {
  if (!isSending() || pressed === keyIsDown) return;
  keyIsDown = pressed;
  sidetoneKey(pressed);
  const now = performance.now() / 1000;
  if (pressed) decoder.keyDown(now); else decoder.keyUp(now);
  $('keyPad').classList.toggle('down', pressed);
  refreshSendDisplay();
}

const num = (v, d) => (isNaN(v) ? '-' : v.toFixed(d));

function checkSending() {
  if (keyIsDown) keyAction(false);
  const sent = decoder.finishedText();
  refreshSendDisplay();
  const r = Scoring.score(currentText, sent);
  const pct = Math.round(r.accuracy * 100);
  const st = decoder.analyze();
  const lines = [fmt(S('Accuracy: {0}%    ', 'शुद्धता: {0}%    '), pct) + missedList(r)];
  if (st.elements < 3) {
    lines.push(S('Send a little more so your timing can be measured.', 'समय नाप्न अलि बढी पठाउनुहोस्।'));
  } else {
    lines.push(fmt(S('Your speed: about {0} WPM (target {1}).', 'तपाईंको गति: करिब {0} WPM (लक्ष्य {1})।'), num(st.wpm, 0), st.targetWpm));
    if (!isNaN(st.dahRatio)) {
      let l = fmt(S('Dah length: {0} x dit (ideal 3.0).', 'ड्याहको लम्बाइ: डिटको {0} गुणा (आदर्श 3.0)।'), num(st.dahRatio, 1));
      if (st.dahRatio < 2.5) l += S(' Make dahs longer, about three dits.', ' ड्याह अलि लामो बनाउनुहोस्, करिब तीन डिट बराबर।');
      else if (st.dahRatio > 3.6) l += S(' Make dahs a little shorter.', ' ड्याह अलि छोटो बनाउनुहोस्।');
      lines.push(l);
    }
    if (!isNaN(st.elementGap)) lines.push(fmt(S('Space inside letters: {0} dits (ideal 1.0).', 'अक्षरभित्रको खाली समय: {0} डिट (आदर्श 1.0)।'), num(st.elementGap, 1)));
    if (!isNaN(st.charGap)) {
      let l = fmt(S('Space between letters: {0} dits (ideal {1}).', 'अक्षरबीचको खाली समय: {0} डिट (आदर्श {1})।'), num(st.charGap, 1), num(st.idealCharGap, 1));
      if (st.charGap < 0.75 * st.idealCharGap) l += S(' Leave more space between letters, or they run together.', ' अक्षरहरूबीच अलि बढी खाली समय राख्नुहोस्, नत्र अक्षर जोडिन्छन्।');
      lines.push(l);
    }
    if (!isNaN(st.wordGap)) {
      let l = fmt(S('Space between words: {0} dits (ideal {1}).', 'शब्दबीचको खाली समय: {0} डिट (आदर्श {1})।'), num(st.wordGap, 1), num(st.idealWordGap, 1));
      if (st.wordGap < 0.75 * st.idealWordGap) l += S(' Pause a little longer between words.', ' शब्दहरूबीच अलि बढी रोकिनुहोस्।');
      lines.push(l);
    }
    if (!isNaN(st.ditVariation)) lines.push(fmt(S('Dit steadiness: varies by {0}% (under 15% is good).', 'डिटको स्थिरता: {0}% सम्म फरक (15% भन्दा कम राम्रो)।'), num(st.ditVariation, 0)));
  }
  setResult(lines.join('\n'));
  setStatus(S('Press Start for new text to send.', 'नयाँ पाठ पठाउन \'सुरु\' थिच्नुहोस्।'));
}

// ---------- About ----------

function showAbout() {
  const t = nepali()
    ? `नेपाल ह्याम मोर्स ट्युटर  संस्करण ${VERSION} (Android / वेब)\n\n` +
      'नयाँ एमेच्योर रेडियो सञ्चालकहरूका लागि निःशुल्क मोर्स कोड अभ्यास कार्यक्रम।\nनिःशुल्क प्रयोग, प्रतिलिपि र वितरण गर्न सकिन्छ।\n\n' +
      'कसरी सिक्ने:\n' +
      '1. पाठ 1 बाट सुरु गर्नुहोस्। अक्षर गति 15 WPM (परीक्षाको गति) र प्रभावकारी गति 5 WPM राख्नुहोस्।\n' +
      '2. हरेक अक्षरको आवाज (लय) सुन्नुहोस्; डट र ड्यास नगन्नुहोस्।\n' +
      '3. 90% वा बढी अंक आएपछि अर्को पाठमा जानुहोस्।\n' +
      '4. हप्तामा एकपटक घण्टौँ होइन, दिनहुँ 10–20 मिनेट अभ्यास गर्नुहोस्।\n\n' +
      'किबोर्ड भएको ट्याबलेटमा: F5 सुरु, F6 फेरि सुन, F8 जाँच, Esc रोक; पठाउने अभ्यासमा स्पेस बार नै मोर्स बटन हो।\n\n' +
      `निर्माता: ${AUTHOR}\nत्रुटि (bug) वा सुझाव पठाउन: ${CONTACT_URL} मा दिइएको इमेलमा सम्पर्क गर्नुहोस्।\n` +
      'MIT इजाजतअन्तर्गत निःशुल्क। कुनै वारेन्टी छैन।'
    : `Nepal Ham Morse Tutor  version ${VERSION} (Android / web)\n\n` +
      'A free Morse code trainer for new amateur radio operators.\nFree to copy and share.\n\n' +
      'How to learn:\n' +
      '1. Start at lesson 1 with character speed 15 WPM (the exam speed) and effective speed 5 WPM.\n' +
      '2. Listen to the sound of each letter; don\'t count dots and dashes.\n' +
      '3. When you score 90% or more, move to the next lesson.\n' +
      '4. Practise 10 to 20 minutes a day rather than for hours once a week.\n\n' +
      'On a tablet with a keyboard: F5 Start, F6 Replay, F8 Check, Esc Stop; in sending practice the Space bar is the Morse key.\n\n' +
      `Author: ${AUTHOR}\nBug reports and suggestions: use the e-mail address on ${CONTACT_URL}\n` +
      'Free under the MIT licence. No warranty.';
  const box = $('aboutText');
  box.textContent = '';
  // Make the QRZ address a link.
  const [before, after] = t.split(CONTACT_URL);
  box.append(before);
  const a = document.createElement('a');
  a.href = CONTACT_URL; a.target = '_blank'; a.rel = 'noopener'; a.textContent = CONTACT_URL;
  box.append(a, after);
  $('aboutDialog').showModal();
}

// ---------- Settings fields ----------

function clampInt(v, lo, hi, dflt) { v = parseInt(v, 10); return isNaN(v) ? dflt : Math.max(lo, Math.min(hi, v)); }

function readFields() {
  settings.charWpm = clampInt($('charWpm').value, 5, 40, DEFAULTS.charWpm);
  settings.effWpm = Math.min(settings.charWpm, clampInt($('effWpm').value, 2, 40, DEFAULTS.effWpm));
  settings.toneHz = clampInt($('toneHz').value, 300, 1200, DEFAULTS.toneHz);
  settings.volume = clampInt($('volume').value, 5, 100, DEFAULTS.volume);
  settings.groups = clampInt($('groups').value, 1, 100, DEFAULTS.groups);
  settings.groupSize = clampInt($('groupSize').value, 1, 10, DEFAULTS.groupSize);
  settings.examMinutes = clampInt($('examMinutes').value, 1, 60, DEFAULTS.examMinutes);
  settings.passMark = clampInt($('passMark').value, 10, 100, DEFAULTS.passMark);
  saveSettings();
}

function writeFields() {
  for (const k of ['charWpm', 'effWpm', 'toneHz', 'volume', 'groups', 'groupSize', 'examMinutes', 'passMark']) $(k).value = settings[k];
}

function setLesson(n) {
  settings.lesson = Math.max(1, Math.min(Content.MAX_LESSON, n));
  saveSettings();
  updateLessonInfo();
}

// ---------- Wiring ----------

function wire() {
  $('mode').addEventListener('change', e => { mode = e.target.value; updateModeUi(true); });
  $('btnLang').addEventListener('click', () => { settings.lang = nepali() ? 'en' : 'ne'; saveSettings(); applyLanguage(); setStatus(modeStartMessage()); });
  $('btnAbout').addEventListener('click', showAbout);
  $('btnAboutClose').addEventListener('click', () => $('aboutDialog').close());
  $('lessonDown').addEventListener('click', () => setLesson(settings.lesson - 1));
  $('lessonUp').addEventListener('click', () => setLesson(settings.lesson + 1));
  $('btnNewChar').addEventListener('click', onHearNewChar);
  $('btnExamPreset').addEventListener('click', () => {
    Object.assign(settings, { charWpm: 15, effWpm: 5, examMinutes: 15, passMark: 60 });
    saveSettings(); writeFields();
    setStatus(S('Nepal exam settings applied. Press Start to begin.', 'नेपाल परीक्षाको ढाँचा लागू भयो। सुरु गर्न \'सुरु\' थिच्नुहोस्।'));
  });
  for (const id of ['charWpm', 'effWpm', 'toneHz', 'volume', 'groups', 'groupSize', 'examMinutes', 'passMark']) {
    $(id).addEventListener('change', () => { readFields(); writeFields(); });
  }
  $('volume').addEventListener('input', readFields);

  $('btnStart').addEventListener('click', onStart);
  $('btnStop').addEventListener('click', onStop);
  $('btnReplay').addEventListener('click', onReplay);
  $('btnCheck').addEventListener('click', onCheck);
  $('btnShow').addEventListener('click', onShowAnswer);
  $('btnSheetClose').addEventListener('click', () => $('sheetDialog').close());
  $('btnSheetSave').addEventListener('click', saveSheet);
  $('btnSheetShare').addEventListener('click', shareSheet);
  $('btnSheetCopy').addEventListener('click', copySheet);
  if (!navigator.share && !androidApp) $('btnSheetShare').hidden = true;

  // The Morse key: touch, mouse or pen. Capturing the pointer means a finger that
  // slides off the pad still lifts the key.
  const pad = $('keyPad');
  pad.addEventListener('pointerdown', e => { e.preventDefault(); pad.setPointerCapture(e.pointerId); keyAction(true); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) pad.addEventListener(ev, () => keyAction(false));
  pad.addEventListener('contextmenu', e => e.preventDefault());

  // Hardware keyboard (tablets with a keyboard, Chromebooks, PCs).
  document.addEventListener('keydown', e => {
    const fkeys = { F5: onStart, F6: onReplay, F8: onCheck, Escape: onStop };
    if (document.querySelector('dialog[open]')) return;
    if (fkeys[e.key]) { e.preventDefault(); fkeys[e.key](); return; }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (isSending() && e.code === 'Space' && !typing) { e.preventDefault(); if (!e.repeat) keyAction(true); return; }
    if (mode === 'drill' && drillActive && !typing && !e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1) {
      const c = e.key.toUpperCase();
      if (Morse.TABLE[c]) { e.preventDefault(); drillAnswer(c); }
    }
  });
  document.addEventListener('keyup', e => { if (isSending() && e.code === 'Space') { e.preventDefault(); keyAction(false); } });

  // Re-take the screen lock if the app comes back while the exam is still playing.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && playback) keepScreenOn(true); });
}

function init() {
  writeFields();
  wire();
  applyLanguage();
  updateModeUi(true);
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* works online without it */ });
  }
}

init();
