/* Pembaca rincian proposal penawaran harga (teks hasil PDF / OCR -> item, volume, harga, diskon, total).
   Murni JavaScript, tanpa internet. Hasilnya SELALU diperiksa pengguna di layar sebelum dipakai. */
(function (root) {
'use strict';
var UNIT_LIST = 'm²|m2|m\\^2|m³|m3|meter|mtr|ml|m|cm|mm|pcs|pc|unit|buah|bh|set|lubang|titik|ls|lot|paket|pkt|kali|lembar|lbr|roll|kg|btg|batang|pasang|ps|bidang|rit|hari|org|orang|ttk|stel';
var UNIT_RE = new RegExp('^(?:' + UNIT_LIST + ')$', 'i');
var DIM_RE = /(?:(?:dimensi|ukuran|size|dim)\s*[:\-]?\s*)?(?:[PLTHDWplthdw]\s*[:=]?\s*)?\d+(?:[.,]\d+)?\s*(?:cm|mm|m)?\s*[x×*]\s*(?:[PLTHDWplthdw]\s*[:=]?\s*)?\d+(?:[.,]\d+)?(?:\s*(?:cm|mm|m)?\s*[x×*]\s*(?:[PLTHDWplthdw]\s*[:=]?\s*)?\d+(?:[.,]\d+)?)?\s*(?:cm|mm|m)?/i;
var SKIP_RE = /\b(rekening|rek\.|bca|bni|bri|mandiri|npwp|telp|telepon|phone|whatsapp|email|e-mail|alamat|website|www\.|terima kasih|hormat kami|termin|tahap|pelunasan|sisa pembayaran|cicilan|syarat|ketentuan|garansi|masa berlaku|berlaku)\b/i;
var SECTION_RE = /^(?:(?:spesifikasi|spek|ringkasan(?:\s+pembayaran)?|syarat(?:\s+(?:dan|&))?\s+ketentuan|ketentuan|catatan)\s*:?\s*){1,3}$/i;
var SPEC_START = /^\s*(dimensi|ukuran|spesifikasi|spek|material|bahan|finishing|warna|ket\.?|keterangan|detail|size|catatan|\(|-)/i;

function tokens(line) {
  var re = /(Rp\.?\s*)?([-–−]\s*)?(\d[\d.,]*\d|\d)(\s*%)?/gi, m, out = [];
  while ((m = re.exec(line))) {
    var d = m[3], t = { start: m.index, end: m.index + m[0].length, rp: !!m[1], neg: !!m[2], pct: !!m[4], raw: d, kind: null, val: 0 };
    var th = /^(\d{1,3}(?:[.,]\d{3})+)(?:[.,](\d{1,2}))?$/.exec(d);
    if (th) { t.kind = 'th'; t.val = parseInt(th[1].replace(/[.,]/g, ''), 10); if (th[2]) t.val = parseFloat(t.val + '.' + th[2]); }
    else if (/^\d+$/.test(d)) { t.kind = 'int'; t.val = parseInt(d, 10); }
    else if (/^\d+[.,]\d{1,2}$/.test(d)) { t.kind = 'dec'; t.val = parseFloat(d.replace(',', '.')); }
    else continue;
    var nx = /^\s*\/?\s*([A-Za-z²³^0-9µ]+)/.exec(line.slice(t.end));
    t.unit = nx && UNIT_RE.test(nx[1]) ? nx[1] : null;
    /* "1,250 m²" = desimal Indonesia (1,25), bukan seribu dua ratus lima puluh. Tandai ambigu agar diperiksa. */
    if (t.kind === 'th' && t.unit && !(nx && /\//.test(nx[0])) && /^\d{1,3},\d{3}$/.test(d)) { t.kind = 'dec'; t.val = parseFloat(d.replace(',', '.')); t.ambig = true; }
    t.unitEnd = t.unit ? t.end + nx[0].length : t.end;
    var pre = line.slice(Math.max(0, t.start - 1), t.start);
    t.slashUnit = !!(t.unit && /\//.test(nx[0]));
    t.isMoney = !t.pct && (t.rp || (t.kind === 'th' && !(t.unit && !t.slashUnit && t.val < 10000)) || (t.kind === 'int' && t.val >= 10000 && !/^0/.test(d) && d.length <= 10));
    out.push(t);
  }
  return out;
}
function fmtRp(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
var MM_FLAG = 'volume × harga ≠ jumlah di proposal';
/* Klasifikasi hubungan volume × harga satuan = jumlah.
   ok       : cocok (selisih ≤ Rp1)
   rounding : selisih kecil yang bisa dijelaskan pembulatan tampilan volume (mis. 10,96 padahal 10,9648) -> tawarkan jumlah dari proposal
   mismatch : tidak cocok (kemungkinan salah baca OCR) -> tawarkan volume yang cocok bila ada.  Hasil hanya SARAN, tidak pernah diterapkan otomatis. */
function classify(vol, price, jumlah, dec) {
  if (!(jumlah > 0) || vol == null || price == null) return { status: 'ok' };
  var calc = Math.round(vol * price);
  if (Math.abs(calc - jumlah) <= 1) return { status: 'ok' };
  var vt = price > 0 ? jumlah / price : 0, win = dec >= 1 ? 0.5 * Math.pow(10, -dec) + 1e-9 : 0;
  if (win && price > 0 && Math.abs(vt - vol) <= win) return { status: 'rounding', flag: 'selisih pembulatan volume: proposal Rp' + fmtRp(jumlah) + ', hitungan Rp' + fmtRp(calc), suggest: { amount: jumlah, reason: 'jumlah di proposal Rp' + fmtRp(jumlah) + ' (pembulatan volume)' } };
  return { status: 'mismatch', flag: MM_FLAG, suggest: suggestVolume(vol, price, jumlah) };
}
function mismatch(vol, price, jumlah, dec) { return classify(vol, price, jumlah, dec == null ? 2 : dec).status === 'mismatch'; }
function suggestVolume(vol, price, jumlah) {
  if (!(price > 0) || !(jumlah > 0)) return null;
  var dq = jumlah / price, cands = [];
  function add(v, why) { v = Math.round(v * 1000) / 1000; if (v > 0 && classify(v, price, jumlah, 0).status === 'ok' && !cands.some(function (c) { return c.vol === v; })) cands.push({ vol: v, reason: why }); }
  if (vol != null && vol > 0) { add(vol / 10, 'koma desimal mungkin hilang (÷10)'); add(vol / 100, 'koma desimal mungkin hilang (÷100)'); add(vol / 1000, 'koma desimal mungkin hilang (÷1000)'); }
  if (Math.abs(dq - Math.round(dq * 100) / 100) < 0.0005) add(dq, 'jumlah ÷ harga satuan');
  return cands.length ? cands[0] : null;
}
/* ---- Pembacaan per KOLOM: angka hanya diambil dari sel volume / harga / jumlah di ujung kanan baris, sehingga angka di dimensi (P175+121 x L60) tidak tertukar. ---- */
var GAP_RE = /\t+|\s{3,}/;
var MONEY_CELL = /^(?:Rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,](\d{1,2}))?(?:\s*\/\s*([A-Za-z²³^0-9]+))?$/i;
var QTY_CELL = new RegExp('^(\\d{1,3}(?:\\.\\d{3})+,\\d+|\\d+(?:[.,]\\d+)?)\\s*(' + UNIT_LIST + ')?$', 'i');
var ROWNO_JUNK = /^\s*\d{1,2}\s*[SsIl]?(?:[|\/\\)\]]|j(?=[A-Z]))+\s*/;
function moneyCell(s) {
  var m = MONEY_CELL.exec(String(s).trim()); if (!m) return null;
  var v = parseInt(m[1].replace(/[.,]/g, ''), 10); if (m[2]) v = parseFloat(v + '.' + m[2]);
  return { val: v, unit: m[3] || '' };
}
function qtyCell(s) {
  var m = QTY_CELL.exec(String(s).trim()); if (!m) return null;
  var raw = m[1], val, dec = 0, amb = false;
  if (/\./.test(raw) && /,/.test(raw)) { val = parseFloat(raw.replace(/\./g, '').replace(',', '.')); dec = raw.split(',')[1].length; }
  else if (/^\d{1,3}[.,]\d{3}$/.test(raw)) { val = parseFloat(raw.replace(',', '.')); dec = 3; amb = true; }
  else if (/[.,]/.test(raw)) { val = parseFloat(raw.replace(',', '.')); dec = raw.split(/[.,]/)[1].length; }
  else val = parseInt(raw, 10);
  return { val: val, dec: dec, amb: amb, raw: raw, unit: m[2] || '' };
}
function parseColumns(line) {
  var cells = line.split(GAP_RE).map(function (s) { return s.trim(); }).filter(Boolean), n = cells.length;
  if (n < 4) return null;
  var jm = moneyCell(cells[n - 1]), pm = moneyCell(cells[n - 2]); if (!jm || !pm) return null;
  var qi = n - 3, q = qtyCell(cells[qi]);
  if (!q && n >= 5 && UNIT_RE.test(cells[qi]) && qtyCell(cells[qi - 1]) && !qtyCell(cells[qi - 1]).unit) { q = qtyCell(cells[qi - 1]); q.unit = cells[qi]; qi = qi - 1; }
  if (!q || qi < 1) return null;
  var desc = cells.slice(0, qi); if (/^\d{1,2}[.)]?$/.test(desc[0]) && desc.length > 1) desc.shift();
  var masked = desc.join(' ').replace(ROWNO_JUNK, ''), dims = [], m;
  /* Dimensi dipisah dari nama: potong di koma/titik sebelum "P80 x ..." (huruf O/S/l yang tertukar dengan angka tetap ikut dikenali, teksnya TIDAK diubah). */
  var sp = /\s*[,.]\s*(?=[PLTHDW][0-9OSIl]\w*\s*(?:[x×*#+]|cm\b|mm\b|$))/.exec(masked);
  if (sp) { dims.push(masked.slice(sp.index + sp[0].length).trim()); masked = masked.slice(0, sp.index); }
  else while ((m = DIM_RE.exec(masked)) && dims.length < 2) {
    var seg = m[0].trim(); if (!/[x×*]/i.test(seg)) break;
    dims.push(seg); masked = masked.slice(0, m.index) + ' ' + masked.slice(m.index + m[0].length);
  }
  var flags = []; if (q.amb) flags.push('format volume "' + q.raw + '" ambigu (desimal atau ribuan) - periksa');
  var unit = q.unit ? normUnit(q.unit) : (pm.unit ? normUnit(pm.unit) : '');
  return { text: cleanText(masked), dims: dims, vol: q.val, unit: unit, price: pm.val, jumlah: jm.val, flags: flags, volDec: q.dec, cols: true };
}
function normUnit(u) { if (!u) return ''; var x = u.toLowerCase(); if (x === 'm2' || x === 'm^2') return 'm²'; if (x === 'm3') return 'm³'; return x; }
var HEAD_RE = /\b(spesifikasi|ringkasan\s+pembayaran|ringkasan|rincian\s+pembayaran)\b\s*:?/gi;
function stripSymbols(t) {
  return String(t == null ? '' : t).replace(/[?\u00BF\uFFFD]+/g, ' ').replace(/[\u2022\u2190-\u21FF\u25A0-\u25FF\u2B00-\u2BFF]+/g, ' ')
    .replace(/\s{2,}/g, ' ').replace(/^[\s,;:\-\u2013/|]+|[\s,;:\-\u2013/|]+$/g, '').trim();
}
function scrub(t) { return stripSymbols(String(t == null ? '' : t).replace(HEAD_RE, ' ')); }
function cleanText(s) {
  return scrub(cleanText0(s));
}
function cleanText0(s) {
  return s.replace(/\s[«»#]\s/g, ' + ').replace(/[^\p{L}\p{N}\s.,:;\/()+\-–×%&'"°²³#=|\t]/gu, ' ').replace(/\bRp\.?/gi, ' ').replace(/[|\t]+/g, ' ').replace(/\s*[:;]\s*$/, '').replace(/^[\s\-–:.,;/|)]+|[\s\-–:.,;/|(]+$/g, '').replace(/\s{2,}/g, ' ').trim();
}
function upperRatio(t) { var l = t.replace(/[^A-Za-z]/g, ''); if (!l) return 0; return l.replace(/[^A-Z]/g, '').length / l.length; }
function leftover(line, re) {
  var m = re.exec(line.toLowerCase()); if (!m || m.index < 3) return '';
  var t = cleanText(line.slice(0, m.index));
  return /[A-Za-z]{3,}/.test(t) ? t : '';
}
function pctOf(line) { var m = /(\d+(?:[.,]\d+)?)\s*%/.exec(line); return m ? parseFloat(m[1].replace(',', '.')) : 0; }

function parseItemRow(line) {
  var colRow = parseColumns(line); if (colRow) return colRow;
  var masked = line, dims = [], m;
  while ((m = DIM_RE.exec(masked)) && dims.length < 2) {
    var seg = m[0].trim(); if (!/[x×*]/i.test(seg)) break;
    dims.push(seg); masked = masked.slice(0, m.index) + new Array(m[0].length + 1).join(' ') + masked.slice(m.index + m[0].length);
  }
  var tk = tokens(masked), money = tk.filter(function (t) { return t.isMoney; });
  var qtyC = tk.filter(function (t) { return !t.isMoney && !t.pct && t.unit && !t.slashUnit && t.val > 0; });
  var firstText = masked.replace(/^\s+/, '');
  qtyC = qtyC.filter(function (t) { return !/^(mm|cm)$/i.test(t.unit); });
  var firstMoney = money.length ? money[0].start : 1e9;
  var before = qtyC.filter(function (t) { return t.start < firstMoney; });
  var qtok = before.length ? before[before.length - 1] : (qtyC[0] || null);
  if (!qtok) {
    qtok = tk.filter(function (t) { return !t.isMoney && !t.pct && (t.kind === 'int' || t.kind === 'dec') && t.val > 0 && t.val < 10000 && !(t.start <= 3 && t.kind === 'int' && t.val <= 99 && !t.unit); })[0] || null;
  }
  var jumlah = money.length ? money[money.length - 1].val : 0, price = null, flags = [];
  var q = qtok ? qtok.val : null;
  if (money.length >= 2) {
    price = money[money.length - 2].val;
    if (q != null && mismatch(q, price, jumlah, 0) && money.length >= 3) {
      var best = null;
      for (var a = 0; a < money.length - 1; a++) { var dlt = Math.abs(q * money[a].val - jumlah); if (!best || dlt < best.d) best = { p: money[a].val, d: dlt }; }
      if (best) { if (best.p !== price) flags.push('harga satuan dipilih dari beberapa angka - periksa'); price = best.p; }
    }
  }
  if (qtok && qtok.ambig) flags.push('format volume "' + qtok.raw + '" ambigu (desimal atau ribuan) - periksa');
  var unit = qtok && qtok.unit ? normUnit(qtok.unit) : '';
  if (!unit) { var su = tk.filter(function (t) { return t.isMoney && t.slashUnit; })[0]; if (su) unit = normUnit(su.unit); }
  var vol = q;
  if (price != null) {
    if (q == null) {
      var dq = jumlah / price;
      if (price > 0 && Math.abs(dq - Math.round(dq * 100) / 100) < 0.0001 && dq > 0) { vol = Math.round(dq * 100) / 100; flags.push('volume tidak terbaca, dihitung dari jumlah ÷ harga - wajib diperiksa'); }
      else { vol = 1; price = jumlah; unit = unit || 'paket'; flags.push('volume tidak terbaca, dianggap 1 paket - periksa'); }
    }
  } else if (jumlah) {
    if (q != null && q > 0 && q !== 1) { price = Math.round(jumlah / q); vol = q; flags.push('harga satuan tidak terbaca, dihitung dari jumlah ÷ volume - wajib diperiksa'); }
    else { price = jumlah; vol = 1; unit = unit || 'paket'; }
  }
  // sisa teks -> judul
  var cuts = [];
  money.forEach(function (t) { cuts.push([t.start, t.slashUnit ? t.unitEnd : t.end]); });
  tk.forEach(function (t) { if (t.isMoney && t.unit && t.slashUnit) cuts.push([t.end, t.unitEnd]); if (t.pct) cuts.push([t.start, t.end]); });
  if (qtok) cuts.push([qtok.start, qtok.unitEnd]);
  var lead = /^\s*(\d{1,2})[.)]?(?=\s|\t)/.exec(masked);
  if (lead) { var leadStart = lead[0].indexOf(lead[1]); if (!(qtok && qtok.start === leadStart)) cuts.push([0, lead[0].length]); }
  cuts.sort(function (x, y) { return y[0] - x[0]; });
  var rest = masked;
  cuts.forEach(function (c) { rest = rest.slice(0, c[0]) + ' ' + rest.slice(c[1]); });
  return { text: cleanText(rest), dims: dims, vol: vol, unit: unit, price: price, jumlah: jumlah, flags: flags, volDec: qtok && qtok.kind === 'dec' ? qtok.raw.split(/[.,]/).pop().length : 0 };
}

function parseLines(lines) {
  var res = { items: [], printedTotal: 0, printedSubtotal: 0, panjar: 0, globalDiscount: 0, warnings: [] };
  var pending = [], afterTotal = false, last = null, inSection = false;
  function absorb(t) { if (!inSection && t && last && last.spec.indexOf(t) < 0) last.spec = (last.spec ? last.spec + ' ' : '') + t; }
  lines.forEach(function (raw) {
    var line = String(raw).replace(/\u00A0/g, ' ').replace(/\s+$/, '');
    if (!line.trim()) { pending = []; return; }
    var low = line.toLowerCase();
    var tk = tokens(line), money = tk.filter(function (t) { return t.isMoney; });
    var hdr = (low.match(/\b(no|deskripsi|keterangan|uraian|item|pekerjaan|qty|vol|volume|satuan|harga|jumlah|total|dimensi|ukuran|sat)\b/g) || []).length;
    if (!money.length && hdr >= 3) return;
    if (/setelah\s+diskon|after\s+disc/.test(low)) return;
    if (SKIP_RE.test(line)) return;
    if (/\b(dp|down\s*payment|panjar|uang\s*muka|terbayar|sudah\s*dibayar|telah\s*dibayar|pembayaran\s*(?:1|pertama|awal))\b/.test(low) && money.length) {
      absorb(leftover(line, /\b(dp|down\s*payment|panjar|uang\s*muka|terbayar|sudah\s*dibayar|telah\s*dibayar|pembayaran)\b/));
      if (!res.panjar) res.panjar = money[money.length - 1].val; return;
    }
    if (/\b(diskon|potongan|discount|disc)\b/.test(low) && (money.length || pctOf(line))) {
      absorb(leftover(line, /\b(diskon|potongan|discount|disc)\b/));
      var dv = money.length ? money[money.length - 1].val : 0;
      if (last && !afterTotal) { if (dv) last.discount = (last.discount || 0) + dv; else last.discountPct = pctOf(line); }
      else if (dv) res.globalDiscount += dv;
      else res.warnings.push('Diskon persen setelah total tidak dapat dipetakan: ' + line.trim());
      return;
    }
    if (/\b(ppn|pajak|tax)\b/.test(low) && money.length) { res.warnings.push('Proposal memuat baris pajak/PPN: ' + line.trim() + ' (tidak dimasukkan).'); return; }
    if (/\b(grand\s*total|total|subtotal|sub\s*total|jumlah\s*total)\b/.test(low) && money.length) {
      absorb(leftover(line, /\b(grand\s*total|total|subtotal|sub\s*total|jumlah\s*total)\b/));
      var v = money[money.length - 1].val;
      if (/sub\s*total/.test(low)) res.printedSubtotal = v; else res.printedTotal = v;
      afterTotal = true; return;
    }
    if (!money.length && SECTION_RE.test(line.replace(/[|\t]+/g, ' ').trim())) { inSection = true; pending = []; return; }
    if (money.length) {
      var r = parseItemRow(line), title = r.text, spec = r.dims.join(' ');
      if (inSection) { if (r.vol != null && r.price && money.length >= 2) inSection = false; else return; }
      if (pending.length && last && title && !SPEC_START.test(title) && !(r.dims.length && title.length < 12) && upperRatio(pending[0]) < 0.6) {
        last.spec = ((last.spec ? last.spec + ' ' : '') + pending.join(' ')).trim(); pending = [];
      }
      if (pending.length) {
        if (!title) {
          var lp = pending[pending.length - 1];
          if (pending.length > 1 && !SPEC_START.test(lp)) {
            var early = pending.slice(0, -1).join(' ');
            if (last && upperRatio(early) < 0.6) last.spec = ((last.spec ? last.spec + ' ' : '') + early).trim();
            title = lp;
          } else { title = pending[0]; spec = (pending.slice(1).join(' ') + ' ' + spec).trim(); }
        }
        else if (SPEC_START.test(title) || (r.dims.length && title.length < 12) || (upperRatio(pending[0]) >= 0.6 && upperRatio(title) < 0.6)) {
          spec = (title + ' ' + spec).trim(); title = pending[0];
          if (pending.length > 1) spec = (pending.slice(1).join(' ') + ' ' + spec).trim();
        }
      }
      pending = [];
      if (!title) title = '(tanpa nama)';
      last = { title: title, spec: spec.trim(), vol: r.vol, volDec: r.volDec || 0, unit: r.unit, price: r.price, jumlah: r.jumlah, discount: 0, discountPct: 0, flags: r.flags.slice() };
      res.items.push(last); afterTotal = false;
      return;
    }
    // baris tanpa angka uang
    var txt = cleanText(line);
    if (!txt || inSection) return;
    if (last && (SPEC_START.test(txt) || DIM_RE.test(txt)) && !pending.length) { last.spec = (last.spec ? last.spec + ' ' : '') + txt; return; }
    pending.push(txt); if (pending.length > 2) pending.shift();
  });
  res.items.forEach(function (it) {
    it.title = scrub(it.title) || '(tanpa nama)'; it.spec = scrub(it.spec);
    if (it.discountPct && !it.discount) it.discount = Math.round((it.jumlah || 0) * it.discountPct / 100);
    it.suggest = null;
    if (it.vol != null && it.price != null) {
      if (it.jumlah > 0) {
        var c = classify(it.vol, it.price, it.jumlah, it.volDec);
        if (c.status !== 'ok') { if (it.flags.indexOf(c.flag) < 0) it.flags.push(c.flag); it.suggest = c.suggest; }
      } else it.flags.push('jumlah di proposal tidak terbaca, volume × harga tidak dapat diverifikasi');
    } else it.flags.push('volume atau harga satuan tidak terbaca');
    /* Teks dimensi yang kemungkinan salah baca OCR (O↔0, S↔5, i↔1 di dalam angka). Hanya catatan, TIDAK memblokir dan TIDAK mengubah teks. */
    it.dimNote = /\b[PLTHDW][0-9]*[OSIil]+[0-9OSIil]*(?:cm|mm|m)?\b|\b[PLTHDW]\d{5,}\b|\d[iIl]\d/.test(it.spec || '');
    /* Item dengan peringatan apa pun harus dikonfirmasi pengguna sebelum dipakai di invoice. */
    it.needsConfirm = it.flags.length > 0;
  });
  return res;
}
root.ProposalParser = { classify: classify, mismatch: mismatch, suggestVolume: suggestVolume, parseLines: parseLines, parseItemRow: parseItemRow, tokens: tokens, scrub: scrub, stripSymbols: stripSymbols };
if (typeof module !== 'undefined') module.exports = root.ProposalParser;
})(typeof window !== 'undefined' ? window : globalThis);
