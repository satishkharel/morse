// Nepal Ham Morse Tutor - Android / web version.
// Morse table, timing, practice content, scoring and the sending decoder.
// No user interface code here, so tests.html can check it on its own.
'use strict';

const Morse = (() => {
  const TABLE = {
    A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..',
    J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.',
    S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
    0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....',
    7: '--...', 8: '---..', 9: '----.',
    '.': '.-.-.-', ',': '--..--', '?': '..--..', '/': '-..-.',
    '=': '-...-',   // BT, break
    '+': '.-.-.'    // AR, end of message
  };
  const REVERSE = {};
  for (const k in TABLE) REVERSE[TABLE[k]] = k;

  /** Upper-cases, drops characters without a Morse code, collapses spaces. */
  function normalize(text) {
    if (!text) return '';
    let out = '', pendingSpace = false;
    for (const raw of String(text).toUpperCase()) {
      if (/\s/.test(raw)) { if (out.length) pendingSpace = true; continue; }
      if (!TABLE[raw]) continue;
      if (pendingSpace) { out += ' '; pendingSpace = false; }
      out += raw;
    }
    return out;
  }

  /** PARIS timing, with ARRL Farnsworth spacing when effective speed is lower. */
  function timing(charWpm, effWpm) {
    const dot = 1.2 / charWpm;
    if (effWpm >= charWpm) return { dot, charGap: 3 * dot, wordGap: 7 * dot };
    const ta = (60 * charWpm - 37.2 * effWpm) / (effWpm * charWpm);
    return { dot, charGap: 3 * ta / 19, wordGap: 7 * ta / 19 };
  }

  /** List of {tone, s} pieces: a tone or a silence of s seconds. */
  function segments(text, charWpm, effWpm) {
    const t = timing(charWpm, effWpm);
    const segs = [];
    for (const word of normalize(text).split(' ')) {
      if (!word) continue;
      if (segs.length) segs.push({ tone: false, s: t.wordGap });
      [...word].forEach((ch, c) => {
        if (c > 0) segs.push({ tone: false, s: t.charGap });
        [...TABLE[ch]].forEach((el, e) => {
          if (e > 0) segs.push({ tone: false, s: t.dot });
          segs.push({ tone: true, s: el === '.' ? t.dot : 3 * t.dot });
        });
      });
    }
    return segs;
  }

  function totalSeconds(segs) { return segs.reduce((a, s) => a + s.s, 0); }
  function codeFor(ch) { return TABLE[String(ch).toUpperCase()] || ''; }
  /** "-.-" shown as "▬ • ▬", which reads clearly on a phone screen. */
  function codeDisplay(ch) { return [...codeFor(ch)].map(e => (e === '.' ? '•' : '▬')).join(' '); }

  return { TABLE, REVERSE, normalize, timing, segments, totalSeconds, codeFor, codeDisplay };
})();

const Content = (() => {
  const KOCH_ORDER = 'KMURESNAPTLWI.JZ=FOY,VG5/Q92H38B?47C1D60X';
  const MAX_LESSON = KOCH_ORDER.length - 1;
  const rnd = n => Math.floor(Math.random() * n);
  const pick = a => a[rnd(a.length)];
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  function lessonChars(lesson) {
    const n = Math.max(2, Math.min(KOCH_ORDER.length, lesson + 1));
    return KOCH_ORDER.slice(0, n);
  }

  /** Random groups from the lesson's characters; the newest is favoured a little. */
  function kochGroups(lesson, groups, size) {
    const chars = lessonChars(lesson), newest = chars[chars.length - 1];
    const out = [];
    for (let g = 0; g < groups; g++) {
      let s = '';
      for (let i = 0; i < size; i++) s += (lesson >= 2 && Math.random() < 0.25) ? newest : chars[rnd(chars.length)];
      out.push(s);
    }
    return out.join(' ');
  }

  /** Next drill letter: favours the newest, never the same letter three times running. */
  function drillPick(chars, prev1, prev2) {
    if (chars.length === 1) return chars[0];
    const newest = chars[chars.length - 1];
    for (let a = 0; a < 50; a++) {
      const c = Math.random() < 0.3 ? newest : chars[rnd(chars.length)];
      if (c === prev1 && c === prev2) continue;
      return c;
    }
    return [...chars].find(c => c !== prev1) || chars[0];
  }

  const PREFIXES = ['9N1', '9N2', '9N3', '9N4', '9N5', '9N6', '9N7', '9N1', '9N3', '9N7',
    'VU2', 'VU3', 'JA1', 'BY1', 'HS0', '4S7', 'S21', 'A5', 'W1', 'K2', 'G4', 'DL1', 'VK2', 'ZL1', 'UA3'];
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  function suffix() { let s = ''; const n = 2 + rnd(2); for (let i = 0; i < n; i++) s += LETTERS[rnd(26)]; return s; }
  const randomCall = () => pick(PREFIXES) + suffix();
  const randomNepalCall = () => '9N' + (1 + rnd(7)) + suffix();
  const callsigns = n => Array.from({ length: n }, randomCall).join(' ');

  const WORDS = ['CQ', 'DE', 'K', 'KN', 'BK', 'R', 'TNX', 'TU', 'FB', 'OM', 'YL', 'HR', 'UR',
    'RST', 'NAME', 'QTH', 'RIG', 'ANT', 'WX', 'PWR', '73', 'GM', 'GA', 'GE', 'GN',
    'ES', 'FER', 'AGN', 'PSE', 'HW', 'CPY', 'QSL', 'QRZ', 'QRM', 'QRN', 'QSB', 'QRS',
    'QRQ', 'QRT', 'QRV', 'QSY', 'DX', 'SRI', 'NR', 'ABT', 'CUL', 'GUD', 'OP',
    'THE', 'AND', 'FOR', 'YOU', 'ARE', 'WAS', 'ONE', 'TWO', 'RADIO', 'HAM', 'CALL',
    'SIGNAL', 'NEPAL', 'GOOD', 'WORK', 'HELLO', 'TODAY', 'WEATHER', 'SUNNY', 'RAIN',
    'COLD', 'WARM', 'DIPOLE', 'BAND', 'TEST', 'MORSE', 'CODE', 'LISTEN', 'SEND', 'COPY'];
  const wordList = n => Array.from({ length: n }, () => pick(WORDS)).join(' ');
  const sendWords = n => Array.from({ length: n }, () => (rnd(4) === 0 ? randomCall() : pick(WORDS))).join(' ');

  /** Five-letter English words with a meaning (mostly nouns), as in the Nepal exam. */
  const FIVE_LETTER_WORDS = ('APPLE BREAD CHAIR TABLE HOUSE WATER RIVER STONE PLANT TRAIN ' +
    'CLOUD STORM RADIO POWER METER CABLE PHONE LIGHT NIGHT EARTH ' +
    'OCEAN FIELD HORSE TIGER ZEBRA CAMEL SHEEP GOOSE EAGLE SNAKE ' +
    'MOUSE BEACH BOARD BRAIN BRICK BRUSH CANDY CHALK CHESS CHILD ' +
    'CLOCK COAST COUCH CROWN DANCE DREAM DRESS DRINK FLOOR FRUIT ' +
    'GLASS GRAPE GRASS HEART HOTEL JUICE KNIFE LEMON MANGO MONEY ' +
    'MONTH MUSIC NURSE OLIVE PAPER PARTY PEARL PIANO PILOT PLATE ' +
    'QUEEN RADAR ROBOT SALAD SHIRT SHORE SMILE SPOON SPORT STAMP ' +
    'STEEL STORY SUGAR TEETH THUMB TOWEL TOWER TRUCK UNCLE VOICE ' +
    'WATCH WHALE WHEAT WHEEL WORLD YOUTH BLOCK CREAM FENCE FLAME ' +
    'FLOUR GLOVE HONEY LEVEL MAGIC MATCH MODEL NOVEL PAINT PANEL ' +
    'PRIZE SCALE SCARF SHELF SKILL SLOPE SPACE STAFF STAGE STICK ' +
    'SWORD TASTE TOAST TORCH TRAIL VIDEO WAGON BENCH BERRY BOOTS ' +
    'CLIFF CORAL DAISY DRUMS FAIRY FEAST FROST GIANT HILLS JEWEL LODGE ' +
    'MAPLE MEDAL NORTH SOUTH ONION OTTER PEACH PENNY QUILT RIDGE ' +
    'ROOST SCOUT SHAWL SKIES SLATE SPICE SPRAY STRAW SWING THORN ' +
    'TULIP VAPOR VOTER WIRES WOMAN WRIST YIELD ANGLE ARROW BADGE ' +
    'BATCH BLADE CANAL CARGO CEDAR CIDER DELTA DEPOT DITCH ELBOW ' +
    'FERRY FORUM GAUGE GRAIN GUARD HABIT INDEX IVORY LABEL LASER ' +
    'LOTUS MOTOR OASIS ORBIT PIVOT PLAZA RELAY RIFLE ROUTE SAUCE ' +
    'SIREN SOLAR TEMPO TRUNK UNION VALVE VAULT VERSE WIDTH YACHT').split(' ');

  /** Mock exam in the Nepal licence format: five-letter words with a fixed number of
   *  callsigns at random places, long enough to last the requested time. */
  function ministryExam(minutes, charWpm, effWpm, calls) {
    const items = Array.from({ length: calls }, randomCall);
    const wordGap = Morse.timing(charWpm, effWpm).wordGap;
    const len = w => Morse.totalSeconds(Morse.segments(w, charWpm, effWpm)) + wordGap;
    let seconds = -wordGap;                    // no space after the last item
    items.forEach(c => { seconds += len(c); });
    let deck = [];
    const target = minutes * 60;
    while (seconds < target && items.length < 3000) {
      if (!deck.length) deck = shuffle(FIVE_LETTER_WORDS.slice());
      const w = deck.pop();
      items.push(w);
      seconds += len(w);
    }
    return shuffle(items).join(' ');
  }

  /** Numbered lines of groups, for checking a paper copy line by line. */
  function answerSheet(text, perLine) {
    const items = Morse.normalize(text).split(' ').filter(Boolean);
    const lines = Math.ceil(items.length / perLine);
    const width = String(lines).length;
    let out = '';
    for (let i = 0; i < items.length; i += perLine) {
      out += String(i / perLine + 1).padStart(width) + '.  ' +
        items.slice(i, i + perLine).map(w => w.padEnd(6)).join('  ').trimEnd() + '\n';
    }
    return out;
  }

  const NAMES = ['RAM', 'SITA', 'HARI', 'GITA', 'BIKASH', 'ANITA', 'SURESH', 'PRAKASH', 'MAYA', 'DIPAK', 'SUNITA', 'RAJU'];
  const QTHS = ['KATHMANDU', 'POKHARA', 'LALITPUR', 'BIRATNAGAR', 'DHARAN', 'BUTWAL', 'HETAUDA', 'NEPALGUNJ', 'JANAKPUR', 'BHARATPUR', 'DHANGADHI', 'ILAM'];
  const WEATHER = ['SUNNY', 'CLOUDY', 'RAIN', 'WARM', 'COLD', 'FOGGY'];
  const ANTENNAS = ['DIPOLE', 'VERTICAL', 'YAGI', 'WIRE'];

  /** One line of a typical short CW contact. */
  function qso() {
    const me = randomNepalCall(), other = randomCall();
    const rst = '5' + (5 + rnd(5)) + '9', name = pick(NAMES), qth = pick(QTHS);
    const power = 5 + 5 * rnd(20);
    switch (rnd(5)) {
      case 0: return `CQ CQ CQ DE ${me} ${me} ${me} K`;
      case 1: return `${other} DE ${me} GM OM UR RST ${rst} ${rst} NAME ${name} ${name} QTH ${qth} ${qth} HW? ${other} DE ${me} K`;
      case 2: return `${other} DE ${me} R TNX FER CALL UR RST ${rst} NAME ${name} QTH ${qth} RIG ${power}W ANT ${pick(ANTENNAS)} WX ${pick(WEATHER)} BK`;
      case 3: return `${other} DE ${me} QSL? PSE AGN UR NAME ES QTH ${other} DE ${me} KN`;
      default: return `TNX FER FB QSO ${name} 73 ES GUD DX ${other} DE ${me} SK`;
    }
  }

  return { KOCH_ORDER, MAX_LESSON, FIVE_LETTER_WORDS, lessonChars, kochGroups, drillPick,
    randomCall, randomNepalCall, callsigns, wordList, sendWords, ministryExam, answerSheet, qso };
})();

const Scoring = (() => {
  function levenshtein(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j), cur = new Array(b.length + 1);
    for (let i = 1; i <= a.length; i++) {
      cur[0] = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      [prev, cur] = [cur, prev];
    }
    return prev[b.length];
  }

  /** Accuracy by edit distance; missed characters counted group by group, position by position. */
  function score(sentText, typedText) {
    const sent = Morse.normalize(sentText), typed = Morse.normalize(typedText);
    const res = { accuracy: 0, sent, typed, missed: {} };
    if (!sent) return res;
    res.accuracy = Math.max(0, 1 - levenshtein(sent, typed) / sent.length);
    const sg = sent.split(' '), tg = typed ? typed.split(' ') : [];
    sg.forEach((s, g) => {
      const t = tg[g] || '';
      for (let i = 0; i < s.length; i++) if (t[i] !== s[i]) res.missed[s[i]] = (res.missed[s[i]] || 0) + 1;
    });
    return res;
  }
  return { levenshtein, score };
})();

/** Turns key-down / key-up times (seconds) into text, adapting to the learner's speed. */
class SendDecoder {
  constructor(charWpm, effWpm) { this.reset(charWpm, effWpm); }

  reset(charWpm, effWpm) {
    const t = Morse.timing(charWpm, effWpm);
    this.targetWpm = charWpm;
    this.expDot = t.dot; this.expCharGap = t.charGap; this.expWordGap = t.wordGap;
    this.dot = t.dot;
    this.down = false; this.downAt = 0; this.upAt = -1; this.wordSpaced = true;
    this.code = ''; this.text = '';
    this.dits = []; this.dahs = []; this.elementGaps = []; this.charGaps = []; this.wordGaps = [];
  }

  get elementThreshold() { return 2 * this.dot; }
  get wordThreshold() {
    const scaled = (this.expCharGap + this.expWordGap) / 2 * (this.dot / this.expDot);
    return Math.max(5 * this.dot, scaled);
  }
  /** Decoded text; a letter still being keyed is shown in brackets. */
  get display() { return this.code ? this.text + '[' + this.code + ']' : this.text; }

  appendLetter() { this.text += Morse.REVERSE[this.code] || '*'; this.code = ''; }
  finishedText() { if (this.code) this.appendLetter(); return this.text.trim(); }

  /** Call every ~20 ms while the key is up. Returns true if the text changed. */
  tick(now) {
    if (this.down || this.upAt < 0) return false;
    let changed = false;
    const gap = now - this.upAt;
    if (this.code && gap >= this.elementThreshold) { this.appendLetter(); changed = true; }
    if (!this.wordSpaced && !this.code && this.text && gap >= this.wordThreshold) {
      this.text += ' '; this.wordSpaced = true; changed = true;
    }
    return changed;
  }

  keyDown(now) {
    if (this.down) return;
    if (this.upAt >= 0) {
      const gap = now - this.upAt;
      this.tick(now);
      if (gap < this.elementThreshold) this.elementGaps.push(gap);
      else if (gap < this.wordThreshold) this.charGaps.push(gap);
      else this.wordGaps.push(gap);
    }
    this.down = true; this.downAt = now; this.wordSpaced = false;
  }

  keyUp(now) {
    if (!this.down) return;
    this.down = false;
    const mark = now - this.downAt;
    this.upAt = now;
    if (mark < 0.012) return;   // too short to be a dit (bounce or accidental touch)
    if (mark < this.elementThreshold) {
      this.code += '.'; this.dits.push(mark); this.dot = 0.7 * this.dot + 0.3 * mark;
    } else {
      this.code += '-'; this.dahs.push(mark); this.dot = 0.7 * this.dot + 0.3 * (mark / 3);
    }
    this.dot = Math.max(0.02, Math.min(0.4, this.dot));
  }

  analyze() {
    const avg = v => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);
    const st = { elements: this.dits.length + this.dahs.length, targetWpm: this.targetWpm,
      idealCharGap: this.expCharGap / this.expDot, idealWordGap: this.expWordGap / this.expDot,
      wpm: NaN, dahRatio: NaN, elementGap: NaN, charGap: NaN, wordGap: NaN, ditVariation: NaN };
    if (!st.elements) return st;
    const avgDit = avg(this.dits), avgDah = avg(this.dahs);
    const unit = !isNaN(avgDit) ? avgDit : avgDah / 3;
    st.wpm = 1.2 / unit;
    if (!isNaN(avgDit) && !isNaN(avgDah)) st.dahRatio = avgDah / avgDit;
    if (this.elementGaps.length) st.elementGap = avg(this.elementGaps) / unit;
    if (this.charGaps.length) st.charGap = avg(this.charGaps) / unit;
    if (this.wordGaps.length) st.wordGap = avg(this.wordGaps) / unit;
    if (this.dits.length >= 3) {
      const v = this.dits.reduce((a, d) => a + (d - avgDit) ** 2, 0) / this.dits.length;
      st.ditVariation = Math.sqrt(v) / avgDit * 100;
    }
    return st;
  }
}
