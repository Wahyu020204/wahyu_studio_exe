(function () {
'use strict';
var $ = function (s) { return document.querySelector(s); };
var LS_DRAFT = 'invoiceOffline.draft.v1', LS_SAVED = 'invoiceOffline.saved.v1';
var DAYS = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
var MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

/* ---------- util ---------- */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
function parseNum(s) {
  if (typeof s === 'number') return isFinite(s) ? s : 0;
  var t = String(s || '').replace(/[^\d,.]/g, '');
  if (!t) return 0;
  if (t.indexOf(',') >= 0) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  var n = parseFloat(t);
  return isFinite(n) ? n : 0;
}
function parseMoney(s) { return Math.round(parseNum(s)); }
function dots(n) { return String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function rp(n) { return (n < 0 ? '-' : '') + 'Rp' + dots(n); }
function neg(n) { return '\u2013 Rp' + dots(n); }
function fmtVol(v) { return String(Number(v.toFixed(3))).replace('.', ','); }
function normUnit(u) { return String(u || '').trim().replace(/^m2$/i, 'm\u00B2').replace(/^m3$/i, 'm\u00B3'); }
function todayISO() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
function fmtDate(iso) {
  if (!iso) return '';
  var p = iso.split('-').map(Number), dt = new Date(p[0], p[1] - 1, p[2], 12);
  return DAYS[dt.getDay()] + ', ' + p[2] + ' ' + MONTHS[p[1] - 1] + ' ' + p[0];
}
function toast(msg, ms) {
  var t = $('#toast'); t.textContent = msg; t.style.display = 'block';
  clearTimeout(toast._t); toast._t = setTimeout(function () { t.style.display = 'none'; }, ms || 3200);
}

/* ---------- state ---------- */
function blankLine() { return { desc: '', vol: '', unit: '', price: '' }; }
function blankItem() { return { title: '', inc: true, lines: [blankLine()], discount: '', flags: [], ref: 0, suggest: null, needsConfirm: false, confirmed: false, ocrWarned: false, fixedAmount: 0 }; }
function defaults() {
  return {
    client: '', contact: '', invNo: '', date: todayISO(), city: 'Makassar',
    purpose: 'Pelunasan pekerjaan mebel', extra: '',
    subtitle: 'TAGIHAN SISA PEMBAYARAN PEKERJAAN MEBEL',
    items: [blankItem()], panjar: '', discountTotal: '', printedTotal: 0, proposalName: '',
    bank: 'BCA', account: '1100 414 666', holder: 'IKETUT WAHYU YUSTA LESMANA',
    closing: 'Mohon melakukan transfer sebesar sisa pembayaran ke rekening yang tercantum di atas. Terima kasih atas kepercayaan dan kerja samanya.',
    signer: 'IKETUT WAHYU YUSTA LESMANA', business: 'Wahyu Interior Design'
  };
}
var S = defaults();
function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function saveDraft() { lsSet(LS_DRAFT, S); }
function normalizeState(o) {
  var d = defaults(), r = {};
  Object.keys(d).forEach(function (k) { r[k] = (o && o[k] != null) ? o[k] : d[k]; });
  if (o && o._id) r._id = o._id;
  if (!Array.isArray(r.items) || !r.items.length) r.items = [blankItem()];
  r.items = r.items.map(function (it) {
    var lines = Array.isArray(it.lines) && it.lines.length ? it.lines : [blankLine()];
    return { title: it.title || '', inc: it.inc !== false, flags: it.flags || [], ref: it.ref || 0, suggest: it.suggest || null, needsConfirm: !!it.needsConfirm, confirmed: !!it.confirmed, ocrWarned: !!it.ocrWarned, fixedAmount: it.fixedAmount || 0, dimNote: !!it.dimNote, discount: it.discount || '', lines: lines.map(function (l) { return { desc: l.desc || '', vol: l.vol == null ? '' : l.vol, unit: l.unit || '', price: l.price == null ? '' : l.price }; }) };
  });
  return r;
}

/* ---------- model ---------- */
function computeModel(st) {
  var rows = [], total = 0, n = 0, subs = [], amts = [];
  st.items.forEach(function (it, i) {
    amts[i] = it.lines.map(function (l, j) {
      var v = parseNum(l.vol), p = parseMoney(l.price);
      if (j === 0 && it.fixedAmount > 0 && p > 0) return it.fixedAmount; /* jumlah proposal yang dipilih pengguna (selisih pembulatan volume) */
      return p > 0 ? Math.round((v > 0 ? v : 1) * p) : 0;
    });
    subs[i] = 0;
    if (it.inc === false) return;
    var title = (it.title || '').trim();
    var hasAny = title || it.lines.some(function (l) { return l.desc || l.vol || l.price; });
    if (!hasAny) return;
    n++;
    var sub = 0;
    it.lines.forEach(function (l, j) {
      if (j > 0 && !(l.desc || l.vol || l.price)) return;
      var v = parseNum(l.vol), p = parseMoney(l.price), amt = amts[i][j];
      sub += amt;
      var unit = normUnit(l.unit);
      rows.push({
        kind: j === 0 ? 'main' : 'sub', no: j === 0 ? String(n) : '',
        b: j === 0 ? title : '', t: l.desc || '',
        vol: v > 0 ? fmtVol(v) + (unit ? ' ' + unit : '') : (unit || ''),
        price: p > 0 ? rp(p) + (unit ? '/' + unit : '') : '',
        amount: p > 0 ? rp(amt) : ''
      });
    });
    var disc = Math.min(parseMoney(it.discount), sub);
    var net = sub - disc;
    if (disc > 0) {
      var lc = title.toLowerCase() || 'pekerjaan';
      rows.push({ kind: 'disc', b: '', t: 'Diskon ' + lc, vol: '', price: '', amount: neg(disc), no: '' });
      rows.push({ kind: 'net', b: 'Harga ' + lc + ' setelah diskon', t: '', vol: '', price: '', amount: rp(net), no: '' });
    }
    subs[i] = net;
    total += net;
  });
  var subtotal = total, discT = Math.min(parseMoney(st.discountTotal), subtotal);
  total = subtotal - discT;
  var panjar = parseMoney(st.panjar), sisa = total - panjar;
  var info = [];
  if (st.invNo.trim()) info.push('No. Invoice: ' + st.invNo.trim());
  info.push('Tanggal: ' + fmtDate(st.date));
  info.push('Keperluan: ' + (st.purpose || '-'));
  if (st.extra.trim()) info.push('Catatan: ' + st.extra.trim());
  return {
    rows: rows, total: total, subtotal: subtotal, discountTotal: discT, panjar: panjar, sisa: sisa, subs: subs, amts: amts,
    client: st.client.trim(), contact: st.contact.trim(), info: info,
    subtitle: st.subtitle, bank: st.bank, account: st.account, holder: st.holder,
    closing: st.closing, signer: st.signer, business: st.business,
    sign1: (st.city ? st.city + ', ' : '') + fmtDate(st.date)
  };
}

/* ---------- preview ---------- */
function previewHTML(m) {
  var h = '<h1>INVOICE</h1><div class="st">' + esc(m.subtitle) + '</div>';
  h += '<table><tr><th style="width:50%">DITAGIHKAN KEPADA</th><th>INFORMASI INVOICE</th></tr><tr><td><b style="font-size:10.5px">' + esc(m.client || '-') + '</b>' + (m.contact ? '<br>CP: ' + esc(m.contact) : '') + '</td><td>' + m.info.map(esc).join('<br>') + '</td></tr></table>';
  h += '<h3>RINCIAN HARGA PEKERJAAN</h3><table class="it"><colgroup><col style="width:34px"><col style="width:226px"><col style="width:66px"><col style="width:96px"><col></colgroup><tr><th class="c">No.</th><th>Keterangan</th><th class="c">Volume</th><th class="r">Harga satuan</th><th class="r">Jumlah</th></tr>';
  m.rows.forEach(function (r) {
    var cls = r.kind === 'net' ? ' class="net"' : '';
    h += '<tr' + cls + '><td class="c">' + esc(r.no) + '</td><td>' + (r.b ? '<b>' + esc(r.b) + '</b>' : '') + (r.b && r.t ? '<br>' : '') + esc(r.t) + '</td><td class="c">' + esc(r.vol) + '</td><td class="r">' + esc(r.price) + '</td><td class="r">' + esc(r.amount) + '</td></tr>';
  });
  h += '</table><table style="margin-top:14px"><colgroup><col style="width:62%"><col></colgroup>' + (m.discountTotal > 0 ? '<tr><td>Subtotal pekerjaan</td><td class="r">' + rp(m.subtotal) + '</td></tr><tr><td>Diskon</td><td class="r">' + neg(m.discountTotal) + '</td></tr>' : '') + '<tr class="tot"><td>TOTAL HARGA PEKERJAAN MEBEL</td><td class="r">' + rp(m.total) + '</td></tr>';
  if (m.panjar > 0) h += '<tr><td>Panjar yang telah dibayarkan</td><td class="r">' + neg(m.panjar) + '</td></tr>';
  h += '<tr class="sisa"><td>SISA PEMBAYARAN</td><td class="r">' + rp(m.sisa) + '</td></tr></table>';
  h += '<h3 style="margin-top:22px">INFORMASI TRANSFER</h3><table><colgroup><col style="width:135px"><col></colgroup>' +
    '<tr><td class="lbl">Bank</td><td>' + esc(m.bank) + '</td></tr><tr><td class="lbl">Nomor rekening</td><td>' + esc(m.account) + '</td></tr>' +
    '<tr><td class="lbl">Atas nama</td><td>' + esc(m.holder) + '</td></tr><tr><td class="lbl">Jumlah transfer</td><td><b>' + rp(m.sisa) + '</b></td></tr></table>';
  h += '<p>' + esc(m.closing) + '</p><div class="sig">' + esc(m.sign1) + '<br>Hormat kami,<br><br><br><br><b style="color:#1f3448">' + esc(m.signer) + '</b><br><span style="color:#6b7885;font-size:9px">' + esc(m.business) + '</span></div>';
  return h;
}
function showPreview() {
  var m = computeModel(S), pg = $('#pg'), wrap = $('#wrap');
  if (pendingList().length) toast('Perhatian: item ' + pendingList().join(', ') + ' belum dikonfirmasi. Periksa di bagian rincian sebelum mencetak.', 6000);
  pg.innerHTML = previewHTML(m);
  $('#ov').style.display = 'flex';
  var k = Math.min(1, ($('#ov .body').clientWidth - 20) / 595);
  pg.style.transform = 'scale(' + k + ')';
  wrap.style.width = (595 * k) + 'px';
  wrap.style.height = (pg.offsetHeight * k) + 'px';
}

/* ---------- PDF ---------- */
function drawPDF(m) {
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  var W = 595.28, H = 841.89, M = 38, CW = W - 2 * M, PB = H - M, PX = 8, PY = 6, LH = 1.36;
  var C = { ink: '#1f3448', text: '#222d36', muted: '#6b7885', pale: '#edf2f6', line: '#cfd8e0', peach: '#f6d6b9', white: '#ffffff' };
  var y = M;
  function wrap(t, w, s, z) { doc.setFont('helvetica', s); doc.setFontSize(z); return doc.splitTextToSize(String(t), w); }
  function rowH(cols) {
    var h = 0;
    cols.forEach(function (c) {
      var hh = 0; c._ch = 0;
      (c.parts || []).forEach(function (p) {
        var z = p.z || 9.5;
        p._l = wrap(p.t, c.w - 2 * PX, p.s || 'normal', z);
        hh += p._l.length * z * LH;
      });
      c._ch = hh; h = Math.max(h, hh);
    });
    return h + 2 * PY;
  }
  function drawRow(cols, h) {
    var x = M;
    cols.forEach(function (c) {
      if (c.fill) { doc.setFillColor(c.fill); doc.rect(x, y, c.w, h, 'F'); }
      doc.setDrawColor(c.bd || C.line); doc.setLineWidth(0.6); doc.rect(x, y, c.w, h, 'S');
      var ty = y + (h - c._ch) / 2, al = c.al || 'left';
      (c.parts || []).forEach(function (p) {
        var z = p.z || 9.5;
        doc.setFont('helvetica', p.s || 'normal'); doc.setFontSize(z); doc.setTextColor(p.c || C.text);
        p._l.forEach(function (l) {
          var tx = al === 'right' ? x + c.w - PX : al === 'center' ? x + c.w / 2 : x + PX;
          doc.text(l, tx, ty, { align: al, baseline: 'top' });
          ty += z * LH;
        });
      });
      x += c.w;
    });
    y += h;
  }
  function row(cols, hdr) {
    var h = rowH(cols);
    if (y + h > PB) {
      doc.addPage(); y = M;
      if (hdr) { var hc = hdr(); drawRow(hc, rowH(hc)); }
    }
    drawRow(cols, h);
  }
  function ensure(h) { if (y + h > PB) { doc.addPage(); y = M; } }
  function heading(t) {
    ensure(70);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(C.ink);
    doc.text(t, M, y, { baseline: 'top' }); y += 19;
  }
  function P(t, o) { o = o || {}; o.t = t; return o; }

  /* judul */
  doc.setFont('helvetica', 'bold'); doc.setFontSize(27); doc.setTextColor(C.ink);
  doc.text('INVOICE', M, y, { baseline: 'top' }); y += 33;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(C.muted);
  doc.text(m.subtitle || '', M, y, { baseline: 'top' }); y += 24;

  /* klien + info */
  var half = CW / 2;
  var hd = function (t) { return { w: half, fill: C.pale, parts: [P(t, { s: 'bold', c: C.ink, z: 9 })] }; };
  row([hd('DITAGIHKAN KEPADA'), hd('INFORMASI INVOICE')]);
  var leftParts = [P(m.client || '-', { s: 'bold', z: 10.5 })];
  if (m.contact) leftParts.push(P('CP: ' + m.contact));
  row([{ w: half, parts: leftParts }, { w: half, parts: m.info.map(function (t) { return P(t); }) }]);
  y += 20;

  /* rincian */
  heading('RINCIAN HARGA PEKERJAAN');
  var cw = [34, 226, 66, 96]; cw.push(CW - cw[0] - cw[1] - cw[2] - cw[3]);
  var hdr = function () {
    var al = ['center', 'left', 'center', 'right', 'right'], tx = ['No.', 'Keterangan', 'Volume', 'Harga satuan', 'Jumlah'];
    return tx.map(function (t, i) { return { w: cw[i], fill: C.ink, bd: C.white, al: al[i], parts: [P(t, { s: 'bold', c: C.white, z: 9 })] }; });
  };
  var hc = hdr(); ensure(rowH(hc) + 60); drawRow(hc, rowH(hc));
  m.rows.forEach(function (r) {
    var net = r.kind === 'net', fill = net ? C.pale : null, st = net ? 'bold' : 'normal';
    var ket = [];
    if (r.b) ket.push(P(r.b, { s: 'bold' }));
    if (r.t) ket.push(P(r.t, { s: st }));
    if (!ket.length) ket.push(P(''));
    row([
      { w: cw[0], al: 'center', fill: fill, parts: [P(r.no)] },
      { w: cw[1], fill: fill, parts: ket },
      { w: cw[2], al: 'center', fill: fill, parts: [P(r.vol)] },
      { w: cw[3], al: 'right', fill: fill, parts: [P(r.price)] },
      { w: cw[4], al: 'right', fill: fill, parts: [P(r.amount, { s: st })] }
    ], hdr);
  });
  y += 14;

  /* total */
  ensure(m.discountTotal > 0 ? 150 : 100);
  var lw = CW * 0.62, rw = CW - lw;
  if (m.discountTotal > 0) {
    row([{ w: lw, parts: [P('Subtotal pekerjaan')] }, { w: rw, al: 'right', parts: [P(rp(m.subtotal))] }]);
    row([{ w: lw, parts: [P('Diskon')] }, { w: rw, al: 'right', parts: [P(neg(m.discountTotal))] }]);
  }
  row([{ w: lw, parts: [P('TOTAL HARGA PEKERJAAN MEBEL', { s: 'bold', c: C.ink, z: 10 })] }, { w: rw, al: 'right', parts: [P(rp(m.total))] }]);
  if (m.panjar > 0) row([{ w: lw, parts: [P('Panjar yang telah dibayarkan')] }, { w: rw, al: 'right', parts: [P(neg(m.panjar))] }]);
  row([{ w: lw, fill: C.peach, parts: [P('SISA PEMBAYARAN', { s: 'bold', c: C.ink, z: 10.5 })] }, { w: rw, fill: C.peach, al: 'right', parts: [P(rp(m.sisa), { s: 'bold', c: C.ink, z: 17 })] }]);
  y += 20;

  /* transfer */
  ensure(135);
  heading('INFORMASI TRANSFER');
  var l1 = 135, l2 = CW - l1;
  [['Bank', m.bank, 0], ['Nomor rekening', m.account, 0], ['Atas nama', m.holder, 0], ['Jumlah transfer', rp(m.sisa), 1]].forEach(function (r) {
    row([{ w: l1, fill: C.pale, parts: [P(r[0], { s: 'bold', c: C.ink })] }, { w: l2, parts: [P(r[1], { s: r[2] ? 'bold' : 'normal' })] }]);
  });
  y += 14;

  /* penutup */
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  var cl = doc.splitTextToSize(m.closing || '', CW);
  ensure(cl.length * 14 + 112);
  doc.setTextColor(C.text);
  cl.forEach(function (l) { doc.text(l, M, y, { baseline: 'top' }); y += 14; });
  y += 14;
  doc.text(m.sign1, M + 4, y, { baseline: 'top' }); y += 14;
  doc.text('Hormat kami,', M + 4, y, { baseline: 'top' }); y += 44;
  doc.setFont('helvetica', 'bold'); doc.setTextColor(C.ink);
  doc.text(m.signer || '', M + 4, y, { baseline: 'top' }); y += 14;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(C.muted);
  doc.text(m.business || '', M + 4, y, { baseline: 'top' });

  var pages = doc.getNumberOfPages();
  if (pages > 1) {
    for (var i = 1; i <= pages; i++) {
      doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(C.muted);
      doc.text('Halaman ' + i + ' dari ' + pages, W - M, H - 24, { align: 'right' });
    }
  }
  return doc;
}

/* ---------- file output ---------- */
function hasBridge() { return !!(window.AndroidBridge && window.AndroidBridge.save); }
function bridgeSave(name, b64, mime, action) {
  var r = String(window.AndroidBridge.save(name, b64, mime, action));
  if (r.indexOf('ERR:') === 0) throw new Error(r.slice(4));
  return r.slice(3);
}
function isNative() { var c = window.Capacitor; return !!(c && c.isNativePlatform && c.isNativePlatform()); }
function safeName(s) { return String(s || '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 40); }
function validate(m) {
  var msg = '';
  if (!m.client) msg = 'Isi nama klien terlebih dahulu.';
  else if (!m.rows.length || m.total <= 0) msg = 'Isi minimal satu item pekerjaan dengan harga.';
  else if (!S.bank.trim() || !S.account.trim() || !S.holder.trim()) msg = 'Lengkapi informasi transfer.';
  else if (m.sisa < 0) msg = 'Panjar lebih besar dari total pekerjaan. Periksa kembali angkanya.';
  else if (pendingList().length) msg = 'Item ' + pendingList().join(', ') + ' belum dikonfirmasi. Periksa volume, harga satuan, dan jumlahnya lebih dulu.';
  if (msg) { toast(msg, 4200); return false; }
  return true;
}
function triggerDownload(blob, name) {
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
function pdfBase64(doc) { var u = doc.output('datauristring'); return u.slice(u.indexOf('base64,') + 7); }
async function nativeShare(path, data, enc, title) {
  var P = window.Capacitor.Plugins;
  var o = { path: path, data: data, directory: 'CACHE' }; if (enc) o.encoding = enc;
  var r = await P.Filesystem.writeFile(o);
  await P.Share.share({ title: title, dialogTitle: title, files: [r.uri] });
}
async function outputPDF(mode) {
  var m = computeModel(S);
  if (!validate(m)) return;
  try {
    var doc = drawPDF(m);
    var name = 'Invoice_' + (safeName(m.client) || 'klien') + '_' + (S.date || todayISO()) + '.pdf';
    if (hasBridge()) {
      var p = bridgeSave(name, pdfBase64(doc), 'application/pdf', mode === 'share' ? 'share' : 'open');
      toast('Tersimpan: ' + p, 5000); return;
    }
    if (!isNative()) { doc.save(name); toast('PDF diunduh: ' + name); return; }
    var b64 = pdfBase64(doc);
    if (mode === 'share') { await nativeShare(name, b64, null, name); return; }
    try {
      var r = await window.Capacitor.Plugins.Filesystem.writeFile({ path: 'Invoice/' + name, data: b64, directory: 'DOCUMENTS', recursive: true });
      toast('Tersimpan: Documents/Invoice/' + name, 5000);
    } catch (e) {
      toast('Penyimpanan langsung gagal, membuka menu Bagikan…');
      await nativeShare(name, b64, null, name);
    }
  } catch (e) {
    if (e && /cancel/i.test(String(e.message || e))) return;
    toast('Gagal membuat PDF: ' + (e && e.message ? e.message : e), 6000);
  }
}

/* ---------- UI: static fields ---------- */
function bindStatic() {
  document.querySelectorAll('[data-k]').forEach(function (el) {
    var k = el.getAttribute('data-k');
    el.value = S[k] == null ? '' : S[k];
    el.addEventListener('input', function () { S[k] = el.value; saveDraft(); updateTotals(); });
    if (el.hasAttribute('data-money')) el.addEventListener('blur', function () {
      var n = parseMoney(el.value); el.value = n ? dots(n) : ''; S[k] = el.value; saveDraft(); updateTotals();
    });
  });
}
function refreshItemsInputs() {
  S.items.forEach(function (it, i) { var el = document.querySelector('.item[data-i="' + i + '"] .line[data-j="0"] [data-f="vol"]'); if (el) el.value = it.lines[0].vol; });
}
function refreshStatic() {
  document.querySelectorAll('[data-k]').forEach(function (el) { el.value = S[el.getAttribute('data-k')] == null ? '' : S[el.getAttribute('data-k')]; });
}

/* ---------- UI: items ---------- */
function renderItems() {
  $('#items').innerHTML = S.items.map(function (it, i) {
    var lines = it.lines.map(function (l, j) {
      return '<div class="line" data-j="' + j + '"><div class="field"><label>' + (j === 0 ? 'Dimensi / spesifikasi' : 'Keterangan baris') + '</label>' +
        '<input data-f="desc" value="' + esc(l.desc) + '" placeholder="' + (j === 0 ? 'Contoh: Dimensi: P 154 × T 150 × L 55 cm' : 'Contoh: Stopkontak + kabel + steker') + '"></div>' +
        '<div class="g3"><div><label>Volume</label><input data-f="vol" inputmode="decimal" value="' + esc(l.vol) + '" placeholder="2,31"></div>' +
        '<div><label>Satuan</label><input data-f="unit" value="' + esc(l.unit) + '" placeholder="m²"></div>' +
        '<div><label>Harga satuan (Rp)</label><input data-f="price" data-money inputmode="numeric" value="' + esc(l.price) + '" placeholder="2.500.000"></div></div>' +
        '<div class="lfoot">Jumlah baris: <span id="amt-' + i + '-' + j + '"></span>' + (j > 0 ? '<button type="button" class="danger" data-act="dline">Hapus baris</button>' : '') + '</div></div>';
    }).join('');
    return '<div class="item" data-i="' + i + '"><div class="ihead"><b>Item ' + (i + 1) + '</b><span class="sub" id="sub-' + i + '"></span>' +
      '<div class="mini"><button type="button" data-act="up">↑</button><button type="button" data-act="down">↓</button><button type="button" class="danger" data-act="del">Hapus</button></div></div>' +
      '<div class="field"><label>Nama pekerjaan</label><input data-f="title" value="' + esc(it.title) + '" placeholder="Contoh: LEMARI LOCKER"></div>' + lines +
      '<button type="button" class="link" data-act="aline">+ Tambah baris rincian</button>' +
      '<div class="field"><label>Diskon item (Rp, opsional)</label><input data-f="discount" data-money inputmode="numeric" value="' + esc(it.discount) + '" placeholder="275.000"></div></div>';
  }).join('');
  updateTotals();
}
function updateTotals() {
  var m = computeModel(S);
  S.items.forEach(function (it, i) {
    var s = $('#sub-' + i); if (s) s.textContent = m.subs[i] ? 'Subtotal ' + rp(m.subs[i]) : '';
    it.lines.forEach(function (l, j) { var a = $('#amt-' + i + '-' + j); if (a) a.textContent = m.amts[i] && m.amts[i][j] ? rp(m.amts[i][j]) : 'Rp0'; });
  });
  $('#sisa').textContent = rp(m.sisa);
  renderReview();
}
function bindItems() {
  var box = $('#items');
  box.addEventListener('input', function (e) {
    var el = e.target, f = el.getAttribute('data-f'); if (!f) return;
    var itEl = el.closest('.item'), i = +itEl.getAttribute('data-i'), lEl = el.closest('.line');
    if (lEl) S.items[i].lines[+lEl.getAttribute('data-j')][f] = el.value; else S.items[i][f] = el.value;
    if (lEl && +lEl.getAttribute('data-j') === 0 && (f === 'vol' || f === 'price')) reevalItem(S.items[i]);
    saveDraft(); updateTotals();
  });
  box.addEventListener('focusout', function (e) {
    var el = e.target; if (!el.hasAttribute || !el.hasAttribute('data-money')) return;
    var n = parseMoney(el.value); el.value = n ? dots(n) : '';
    var f = el.getAttribute('data-f'), i = +el.closest('.item').getAttribute('data-i'), lEl = el.closest('.line');
    if (lEl) S.items[i].lines[+lEl.getAttribute('data-j')][f] = el.value; else S.items[i][f] = el.value;
    if (lEl && +lEl.getAttribute('data-j') === 0 && f === 'price') reevalItem(S.items[i]);
    saveDraft(); updateTotals();
  });
  box.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var act = b.getAttribute('data-act'), i = +b.closest('.item').getAttribute('data-i'), lEl = b.closest('.line');
    if (act === 'aline') S.items[i].lines.push(blankLine());
    else if (act === 'dline') S.items[i].lines.splice(+lEl.getAttribute('data-j'), 1);
    else if (act === 'del') { if (!confirm('Hapus item ' + (i + 1) + '?')) return; S.items.splice(i, 1); if (!S.items.length) S.items.push(blankItem()); }
    else if (act === 'up' && i > 0) { var t = S.items[i]; S.items[i] = S.items[i - 1]; S.items[i - 1] = t; }
    else if (act === 'down' && i < S.items.length - 1) { var t2 = S.items[i]; S.items[i] = S.items[i + 1]; S.items[i + 1] = t2; }
    saveDraft(); renderItems();
  });
  $('#addItem').addEventListener('click', function () { S.items.push(blankItem()); saveDraft(); renderItems(); });
}

/* ---------- baca proposal ---------- */
var dpHint = 0;
function setStatus(t) { $('#rStatus').textContent = t || ''; }
/* Item yang diberi peringatan baca-proposal dan belum dikonfirmasi pengguna. */
function isPending(it) { return it.inc !== false && it.needsConfirm && !it.confirmed; }
function pendingList() { var r = []; S.items.forEach(function (it, i) { if (isPending(it)) r.push(i + 1); }); return r; }
/* Setelah pengguna mengubah volume/harga: jika hasilnya cocok dengan jumlah di proposal, peringatan selesai; jika tidak, perlu konfirmasi ulang. */
function volDecimals(s) { var m = /,(\d+)\s*$/.exec(String(s || '').trim()); return m ? m[1].length : 0; }
function reevalItem(it) {
  if (!it.needsConfirm && !it.ocrWarned) return;
  var l0 = it.lines[0], v = parseNum(l0.vol), p = parseMoney(l0.price);
  it.confirmed = false; it.suggest = null; it.fixedAmount = 0;
  if (it.ref > 0 && v > 0 && p > 0) {
    var c = ProposalParser.classify(v, p, it.ref, volDecimals(l0.vol));
    if (c.status === 'ok') { it.flags = []; it.needsConfirm = false; }
    else { it.flags = [c.flag]; it.needsConfirm = true; it.suggest = c.suggest; }
  }
}
function itemGross(it) {
  var g = 0;
  it.lines.forEach(function (l, j) { if (j > 0 && !(l.desc || l.vol || l.price)) return; var v = parseNum(l.vol), p = parseMoney(l.price); g += (j === 0 && it.fixedAmount > 0 && p > 0) ? it.fixedAmount : (p > 0 ? Math.round((v > 0 ? v : 1) * p) : 0); });
  return g;
}
function renderReview() {
  var box = $('#review'), vb = $('#verify');
  var list = [];
  S.items.forEach(function (it, i) { if ((it.title || '').trim() || it.lines.some(function (l) { return l.price || l.vol; })) list.push(i); });
  if (!list.length) { box.innerHTML = ''; vb.innerHTML = ''; return; }
  box.innerHTML = list.map(function (i) {
    var it = S.items[i], g = itemGross(it), d = Math.min(parseMoney(it.discount), g), l0 = it.lines[0], v = parseNum(l0.vol), p = parseMoney(l0.price), u = normUnit(l0.unit);
    var detail = [];
    if (it.lines[0].desc) detail.push(esc(it.lines[0].desc));
    if (p > 0) detail.push((v > 0 ? fmtVol(v) + (u ? ' ' + u : '') + ' × ' : '') + rp(p) + (it.lines.length > 1 ? ' (+' + (it.lines.length - 1) + ' baris)' : ''));
    if (d > 0) detail.push('Diskon ' + neg(d));
    var warn = (it.flags || []).map(function (f) { return '⚠ ' + esc(f); }).join(' · ');
    if (it.ref && Math.abs(it.ref - g) > 1 && !(it.flags || []).length) warn = '⚠ jumlah di proposal ' + rp(it.ref);
    else if (it.ref && (it.flags || []).length) warn += ' (proposal: ' + rp(it.ref) + ')';
    var act = '';
    if (it.dimNote) act += '<div class="warn">ℹ Periksa teks dimensi (huruf mungkin tertukar angka, mis. O↔0, S↔5, i↔1). Tidak memengaruhi hitungan.</div>';
    if (it.needsConfirm) {
      if (it.confirmed) act = '<div class="warn" style="color:#1b6e3c">✓ Angka dikonfirmasi pengguna</div>';
      else {
        act = '<div class="warn"><b>Wajib diperiksa:</b> ubah Volume / Harga di bawah bila salah, lalu tekan konfirmasi.</div><div>';
        if (it.suggest) act += '<button type="button" class="link" data-rs="' + i + '" style="margin:6px 6px 0 0">' + (it.suggest.amount ? 'Pakai ' + esc(it.suggest.reason) : 'Pakai volume ' + fmtVol(it.suggest.vol) + ' (' + esc(it.suggest.reason) + ')') + '</button>';
        act += '<button type="button" class="link" data-rc="' + i + '" style="margin:6px 0 0">' + (it.suggest && it.suggest.amount ? 'Tetap pakai hitungan ' + rp(g) : 'Angka sudah benar') + '</button></div>';
      }
    }
    return '<div class="rv' + (it.inc === false ? ' off' : '') + '"><label class="chk"><input type="checkbox" data-ri="' + i + '"' + (it.inc === false ? '' : ' checked') + '><span class="rt"><b>' + esc(it.title || '(tanpa nama)') + '</b><small>' + detail.join('<br>') + '</small>' + (warn ? '<div class="warn">' + warn + '</div>' : '') + '</span><span class="ra">' + rp(g - d) + '</span></label>' + act + '</div>';
  }).join('');
  var m = computeModel(S), h = '';
  if (S.printedTotal > 0) {
    var diff = m.total - S.printedTotal;
    h = Math.abs(diff) <= 1
      ? '<div class="vbox vok">✓ Total hasil baca ' + rp(m.total) + ' cocok dengan total di proposal.</div>'
      : '<div class="vbox vbad">⚠ Total hasil baca ' + rp(m.total) + ', total di proposal ' + rp(S.printedTotal) + ' (selisih ' + rp(Math.abs(diff)) + '). Periksa item di bawah. Jika ada item yang memang tidak ditagihkan, hilangkan centangnya.' + (S.items.some(function (it) { return it.inc !== false && it.suggest && it.suggest.amount && !it.fixedAmount; }) ? ' Sebagian selisih berasal dari pembulatan volume: tekan "Pakai jumlah proposal" pada item bertanda ⚠ agar total sama dengan proposal.' : '') + '</div>';
  } else if (S.proposalName) h = '<div class="vbox vnone">Total di proposal tidak terbaca. Periksa angka tiap item satu per satu.</div>';
  var ra = S.items.filter(function (it) { return isPending(it) && it.suggest && it.suggest.amount; }).length;
  if (ra > 1) h = '<button type="button" class="link" id="bRoundAll">Pakai jumlah proposal untuk ' + ra + ' item selisih pembulatan volume</button>' + h;
  var pl = pendingList();
  if (pl.length) h = '<div class="vbox vbad">⚠ Item ' + pl.join(', ') + ' belum dikonfirmasi. PDF invoice tidak dapat dibuat sebelum angka volume, harga, dan jumlahnya dikonfirmasi.</div>' + h;
  if (dpHint > 0 && !parseMoney(S.panjar)) h += '<button type="button" class="link" id="bDp">Proposal memuat DP ' + rp(dpHint) + ' · pakai sebagai panjar</button>';
  vb.innerHTML = h;
}
function toStateItem(it) {
  return {
    title: it.title, inc: true, flags: it.flags || [], ref: it.jumlah || 0, suggest: it.suggest || null, needsConfirm: !!it.needsConfirm, ocrWarned: !!it.needsConfirm, confirmed: false, fixedAmount: 0, dimNote: !!it.dimNote,
    discount: it.discount ? dots(it.discount) : '',
    lines: [{ desc: it.spec || '', vol: it.vol != null ? fmtVol(it.vol) : '', unit: it.unit || '', price: it.price ? dots(it.price) : '' }]
  };
}
async function handleProposal(file) {
  if (!file) return;
  $('#fName').textContent = file.name; setStatus('Memulai…');
  try {
    var res = await ProposalReader.read(file, setStatus);
    var raw = res.lines.join('\n'); $('#rawText').textContent = raw || '(tidak ada teks)';
    var p = ProposalParser.parseLines(res.lines);
    if (!p.items.length) { setStatus('Tidak ada baris harga yang terbaca (' + res.method + '). Buka “Lihat teks yang terbaca” di bawah, atau isi manual.'); return; }
    var hasData = S.items.some(function (it) { return (it.title || '').trim() || it.lines.some(function (l) { return l.price; }); });
    if (hasData && !confirm('Ganti rincian pekerjaan yang ada dengan hasil baca proposal?')) { setStatus(''); return; }
    S.items = p.items.map(toStateItem); S.printedTotal = p.printedTotal || p.printedSubtotal || 0; S.proposalName = file.name;
    S.discountTotal = p.globalDiscount ? dots(p.globalDiscount) : '';
    dpHint = p.panjar || 0;
    saveDraft(); refreshStatic(); renderItems();
    setStatus('Selesai: ' + p.items.length + ' item terbaca (' + res.method + '). Periksa hasilnya di bawah.' + (p.warnings.length ? ' ' + p.warnings.join(' ') : ''));
  } catch (e) { setStatus('Gagal membaca file: ' + (e && e.message ? e.message : e)); }
}

/* ---------- saved list / backup / import ---------- */
function renderSaved() {
  var list = lsGet(LS_SAVED, []);
  $('#saved').innerHTML = list.length ? list.map(function (r, k) {
    var m = computeModel(normalizeState(r.data));
    return '<div class="saved" data-n="' + k + '"><div class="t"><b>' + esc(r.data.client || '(tanpa nama)') + '</b>' + esc(fmtDate(r.data.date)) + ' · ' + rp(m.sisa) + '</div>' +
      '<button type="button" class="link" style="margin:0" data-sa="load">Buka</button><button type="button" class="danger" data-sa="del">Hapus</button></div>';
  }).join('') : '<p class="help" style="margin:0">Belum ada invoice tersimpan.</p>';
}
function saveCurrent() {
  if (!S.client.trim()) { toast('Isi nama klien sebelum menyimpan.'); return; }
  var list = lsGet(LS_SAVED, []), id = S._id || ('i' + Date.now());
  S._id = id;
  var rec = { id: id, at: Date.now(), data: JSON.parse(JSON.stringify(S)) };
  var idx = list.findIndex(function (r) { return r.id === id; });
  if (idx >= 0) list[idx] = rec; else list.unshift(rec);
  lsSet(LS_SAVED, list); saveDraft(); renderSaved(); toast('Invoice disimpan di HP ini.');
}
function restoreInvoiceFormInteractivity() {
  // Pulihkan status kontrol formulir secara eksplisit setelah membuat invoice baru.
  // Ini juga membersihkan status terkunci yang mungkin tertinggal dari sesi/overlay sebelumnya.
  var controls = document.querySelectorAll('main input, main textarea, main select');
  controls.forEach(function (el) {
    el.disabled = false;
    el.readOnly = false;
    el.removeAttribute('disabled');
    el.removeAttribute('readonly');
    el.style.pointerEvents = 'auto';
  });
  var main = $('main');
  if (main) { main.inert = false; main.style.pointerEvents = 'auto'; }
  document.querySelectorAll('main .card, main .field').forEach(function (el) {
    el.inert = false;
    el.style.pointerEvents = 'auto';
  });
  // Tutup paksa lapisan pratinjau bila status tampilnya tertinggal.
  var overlay = $('#ov');
  if (overlay) { overlay.style.display = 'none'; overlay.setAttribute('aria-hidden', 'true'); }
}
function newInvoice() {
  if (!confirm('Mulai invoice baru? Data rekening dan penandatangan tetap dipertahankan.')) return;
  var keep = { bank: S.bank, account: S.account, holder: S.holder, closing: S.closing, signer: S.signer, business: S.business, city: S.city, subtitle: S.subtitle };
  S = Object.assign(defaults(), keep); dpHint = 0;
  $('#fName').textContent = 'Belum ada file dipilih.'; setStatus(''); $('#rawText').textContent = '';
  saveDraft(); refreshStatic(); renderItems(); restoreInvoiceFormInteractivity();
  window.scrollTo(0, 0);
  // Kembalikan fokus ke kolom pertama agar pengguna langsung dapat mengetik.
  requestAnimationFrame(function () {
    var first = document.querySelector('main input[data-k="client"]');
    if (first) first.focus();
  });
}
async function doBackup() {
  var payload = JSON.stringify({ app: 'invoice-offline', version: 1, saved: lsGet(LS_SAVED, []), current: S }, null, 1);
  var name = 'backup_invoice_' + todayISO() + '.json';
  try {
    if (hasBridge()) { bridgeSave(name, btoa(unescape(encodeURIComponent(payload))), 'application/json', 'share'); }
    else if (isNative()) await nativeShare(name, payload, 'utf8', 'Backup invoice');
    else { triggerDownload(new Blob([payload], { type: 'application/json' }), name); toast('Backup diunduh.'); }
  } catch (e) { if (!/cancel/i.test(String(e && e.message))) toast('Backup gagal: ' + (e && e.message)); }
}
function doImport(file) {
  var rd = new FileReader();
  rd.onload = function () {
    try {
      var o = JSON.parse(rd.result);
      if (o && o.app === 'invoice-offline') {
        var cur = lsGet(LS_SAVED, []), ids = {}; cur.forEach(function (r) { ids[r.id] = 1; });
        (o.saved || []).forEach(function (r) { if (!ids[r.id]) cur.push(r); });
        lsSet(LS_SAVED, cur); renderSaved();
        if (o.current && confirm('Muat juga invoice yang sedang dikerjakan di backup?')) { S = normalizeState(o.current); saveDraft(); refreshStatic(); renderItems(); }
        toast('Backup dipulihkan.');
      } else toast('File ini bukan backup Invoice Offline. Untuk proposal, gunakan tombol Pilih file proposal.', 6000);
    } catch (e) { toast('File bukan JSON yang valid.'); }
  };
  rd.readAsText(file);
}

/* ---------- init ---------- */
/* ---------- ambil dari proposal tersimpan (app Proposal, penyimpanan yang sama) ---------- */
var LS_PROP = 'wahyuMebelProposalProjectsV1';
function pnum(v) { return Number(String(v == null ? '' : v).replace(',', '.')) || 0; }
function propVolume(it) {
  if (it.mode === 'other') return { qty: pnum(it.qty), unit: it.unit || 'unit' };
  var sc = it.dimensionUnit === 'cm' ? 100 : 1, p = pnum(it.length) / sc, t = pnum(it.height) / sc;
  return t > 1 ? { qty: p * t, unit: 'm\u00B2' } : { qty: p, unit: 'ml' };
}
function propGross(it) { return propVolume(it).qty * pnum(it.price); }
function propDisc(it) {
  var g = propGross(it), d = pnum(it.discount); if (d <= 0 || g <= 0) return 0;
  return it.discType === 'nominal' ? Math.min(d, g) : g * Math.min(d, 100) / 100;
}
function propTotal(d) { return d.items.reduce(function (s, it) { return s + propGross(it) - propDisc(it); }, 0); }
function readSavedProposals() {
  var l = lsGet(LS_PROP, []); if (!Array.isArray(l)) return [];
  return l.filter(function (p) { return p && p.data && p.data.fields && Array.isArray(p.data.items); })
    .sort(function (a, b) { return (b.serialNo || 0) - (a.serialNo || 0); });
}
function showPropPicker() {
  var box = $('#propPick'), list = readSavedProposals();
  if (!list.length) { box.innerHTML = '<p class="help">Belum ada proposal tersimpan di app Proposal. Buka menu Proposal, isi, lalu tekan “Simpan Proposal”.</p>'; box._list = []; return; }
  box._list = list;
  box.innerHTML = list.map(function (p, k) {
    var f = p.data.fields || {};
    return '<div class="saved" data-pi="' + k + '"><div class="t"><b>' + esc(String(p.serialNo || '').padStart(3, '0') + '. ' + ((f.customer || '').trim() || 'Tanpa nama')) + '</b><small>' + p.data.items.length + ' item · ' + rp(Math.round(propTotal(p.data))) + '</small></div><button type="button" class="link" data-pa="use" style="margin:0">Pakai</button></div>';
  }).join('');
}
function usePropData(d) {
  var hasData = S.items.some(function (it) { return (it.title || '').trim() || it.lines.some(function (l) { return l.price; }); });
  if (hasData && !confirm('Ganti rincian pekerjaan yang ada dengan data proposal ini?')) return;
  var f = d.fields || {};
  S.items = d.items.map(function (it) {
    var v = propVolume(it), g = propGross(it), dc = Math.round(propDisc(it)), pr = pnum(it.price);
    return {
      title: it.name || '', inc: true, flags: [], ref: Math.round(g),
      discount: dc > 0 ? dots(dc) : '',
      lines: [{ desc: it.details || '', vol: v.qty > 0 ? String(Number(v.qty.toFixed(6))).replace('.', ',') : '', unit: v.unit || '', price: pr > 0 ? dots(Math.round(pr)) : '' }]
    };
  });
  if (!S.items.length) S.items = [blankItem()];
  S.discountTotal = '';
  if (!(S.client || '').trim() && f.customer) S.client = f.customer;
  var exact = Math.round(propTotal(d)); S.proposalName = 'Proposal tersimpan: ' + ((f.customer || '').trim() || 'tanpa nama');
  S.printedTotal = exact;
  var m = computeModel(S); if (Math.abs(m.total - exact) <= 5) S.printedTotal = m.total;
  var pct = Math.max(0, Math.min(100, pnum(f.dp)));
  dpHint = pct > 0 ? Math.round(exact * pct / 100) : 0;
  $('#fName').textContent = S.proposalName; $('#propPick').innerHTML = '';
  saveDraft(); refreshStatic(); renderItems();
  setStatus('Selesai: ' + S.items.length + ' item diambil langsung dari proposal tersimpan. Periksa hasilnya di bawah.');
}

function init() {
  S = normalizeState(lsGet(LS_DRAFT, null));
  bindStatic(); bindItems(); renderItems(); renderSaved();
  $('#bPick').onclick = function () { $('#fProposal').click(); };
  $('#bSavedProp').onclick = showPropPicker;
  $('#propPick').addEventListener('click', function (e) { var b = e.target.closest('[data-pa]'); if (!b) return; var k = +b.closest('.saved').getAttribute('data-pi'), l = $('#propPick')._list; if (l && l[k]) usePropData(l[k].data); });
  $('#fProposal').onchange = function () { var f = this.files[0]; this.value = ''; if (f) handleProposal(f); };
  $('#review').addEventListener('change', function (e) {
    var el = e.target; if (!el.hasAttribute || !el.hasAttribute('data-ri')) return;
    S.items[+el.getAttribute('data-ri')].inc = el.checked; saveDraft(); updateTotals();
  });
  $('#review').addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-rs],[data-rc]'); if (!b) return;
    var sug = b.hasAttribute('data-rs'), it = S.items[+b.getAttribute(sug ? 'data-rs' : 'data-rc')]; if (!it) return;
    if (sug) { if (!it.suggest) return; if (it.suggest.amount) { it.fixedAmount = it.suggest.amount; it.confirmed = true; } else { it.lines[0].vol = fmtVol(it.suggest.vol); reevalItem(it); refreshItemsInputs(); } }
    else { it.confirmed = true; }
    saveDraft(); updateTotals();
  });
  $('#verify').addEventListener('click', function (e) {
    if (e.target.id === 'bRoundAll') { S.items.forEach(function (it) { if (isPending(it) && it.suggest && it.suggest.amount) { it.fixedAmount = it.suggest.amount; it.confirmed = true; } }); saveDraft(); updateTotals(); return; }
    if (e.target.id === 'bDp') { S.panjar = dots(dpHint); saveDraft(); refreshStatic(); updateTotals(); }
  });
  $('#bPrev').onclick = function () { showPreview(); };
  $('#bPdf').onclick = function () { outputPDF('save'); };
  $('#bShare').onclick = function () { outputPDF('share'); };
  $('#oClose').onclick = function () { $('#ov').style.display = 'none'; };
  $('#oPdf').onclick = function () { outputPDF('save'); };
  $('#oShare').onclick = function () { outputPDF('share'); };
  $('#bSave').onclick = saveCurrent; $('#bNew').onclick = newInvoice; $('#bBackup').onclick = doBackup;
  $('#bImport').onclick = function () { $('#fImport').click(); };
  $('#fImport').onchange = function () { if (this.files[0]) doImport(this.files[0]); this.value = ''; };
  $('#saved').addEventListener('click', function (e) {
    var b = e.target.closest('[data-sa]'); if (!b) return;
    var k = +b.closest('.saved').getAttribute('data-n'), list = lsGet(LS_SAVED, []);
    if (b.getAttribute('data-sa') === 'load') { S = normalizeState(list[k].data); S._id = list[k].id; saveDraft(); refreshStatic(); renderItems(); window.scrollTo(0, 0); toast('Invoice dibuka.'); }
    else if (confirm('Hapus invoice tersimpan ini?')) { list.splice(k, 1); lsSet(LS_SAVED, list); renderSaved(); }
  });
  window.addEventListener('resize', function () { if ($('#ov').style.display === 'flex') showPreview(); });
}
document.addEventListener('DOMContentLoaded', init);
})();
