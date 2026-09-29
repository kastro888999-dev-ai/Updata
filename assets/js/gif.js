/* ================= Modo GIF (reproductor + editor, 100% offline) ================= */
/* Decodificador y codificador GIF propios (LZW, disposal, cuantización de color) — sin librerías */

/* ---------- Decodificador GIF (puro, sin DOM) ----------
   Devuelve { width, height, loopCount, frames: [{ rgba, delayMs, delayCs }] } */

function gifReadColorTable(bytes, p, size) {
  const t = new Array(size);
  for (let i = 0; i < size; i++) {
    t[i] = [bytes[p + i * 3], bytes[p + i * 3 + 1], bytes[p + i * 3 + 2]];
  }
  return t;
}

function gifSkipSubBlocks(bytes, p) {
  while (p < bytes.length) {
    const len = bytes[p++];
    if (!len) break;
    p += len;
  }
  return p;
}

function gifDeinterlace(indices, w, h) {
  const out = new Uint8Array(w * h);
  const passes = [[0, 8], [4, 8], [2, 4], [1, 2]];
  let srcRow = 0;
  for (let c = 0; c < passes.length; c++) {
    const start = passes[c][0], step = passes[c][1];
    for (let y = start; y < h; y += step) {
      out.set(indices.subarray(srcRow * w, (srcRow + 1) * w), y * w);
      srcRow++;
    }
  }
  return out;
}

function gifLzwDecode(data, minCodeSize, pixelCount) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  const prefixes = new Int32Array(4096);
  const suffixes = new Uint8Array(4096);
  const lengths = new Int32Array(4096);
  for (let i = 0; i < clearCode; i++) { prefixes[i] = -1; suffixes[i] = i; lengths[i] = 1; }
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  const out = new Uint8Array(pixelCount);
  let outPos = 0;
  let bitPos = 0;
  let prev = -1;

  const readCode = () => {
    const bytePos = bitPos >> 3;
    if (bytePos >= data.length) return -1;
    const b0 = data[bytePos];
    const b1 = bytePos + 1 < data.length ? data[bytePos + 1] : 0;
    const b2 = bytePos + 2 < data.length ? data[bytePos + 2] : 0;
    const chunk = b0 | (b1 << 8) | (b2 << 16);
    const code = (chunk >>> (bitPos & 7)) & ((1 << codeSize) - 1);
    bitPos += codeSize;
    return code;
  };

  while (outPos < pixelCount) {
    const code = readCode();
    if (code === -1 || code === eoiCode) break;
    if (code === clearCode) {
      codeSize = minCodeSize + 1;
      nextCode = eoiCode + 1;
      prev = -1;
      continue;
    }
    if (prev === -1) {
      if (code >= nextCode) break; // corrupto
      out[outPos++] = suffixes[code];
      prev = code;
      continue;
    }
    const inTable = code < nextCode;
    if (code > nextCode) break; // corrupto
    const emitCode = inTable ? code : prev; // KwKwK
    const L = lengths[emitCode];
    let end = outPos + L;
    if (end > pixelCount) end = pixelCount;
    let c = emitCode, pos = end - 1;
    while (c >= 0 && pos >= outPos) { out[pos--] = suffixes[c]; c = prefixes[c]; }
    const first = out[outPos];
    outPos = end;
    if (!inTable && outPos < pixelCount) out[outPos++] = first;
    if (nextCode < 4096) {
      prefixes[nextCode] = prev;
      suffixes[nextCode] = first;
      lengths[nextCode] = lengths[prev] + 1;
      nextCode++;
      // el decodificador va una entrada por detrás del codificador:
      // subir el tamaño de código cuando la PRÓXIMA entrada no cabría
      if (nextCode >= (1 << codeSize) && codeSize < 12) codeSize++;
    }
    prev = code;
  }
  return out;
}

function decodeGifBytes(bytes) {
  if (bytes.length < 13) throw new Error("archivo demasiado corto");
  if (bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x38)
    throw new Error("no es un archivo GIF");
  let p = 6;
  const width = bytes[p] | (bytes[p + 1] << 8);
  const height = bytes[p + 2] | (bytes[p + 3] << 8);
  const packed = bytes[p + 4];
  p += 7;
  if (!width || !height) throw new Error("dimensiones inválidas");
  let gct = null;
  if (packed & 0x80) {
    const size = 2 << (packed & 7);
    gct = gifReadColorTable(bytes, p, size);
    p += size * 3;
  }
  let loopCount = null;
  let gce = null;
  const frames = [];
  const comp = new Uint8ClampedArray(width * height * 4);

  while (p < bytes.length) {
    const b = bytes[p++];
    if (b === 0x3b) break; // trailer
    if (b === 0x21) { // extensión
      const label = bytes[p++];
      if (label === 0xf9) { // Graphic Control Extension
        const size = bytes[p++];
        const gp = bytes[p];
        const delayCs = bytes[p + 1] | (bytes[p + 2] << 8);
        const tIdx = bytes[p + 3];
        p += size;
        p = gifSkipSubBlocks(bytes, p);
        gce = { disposal: (gp >> 2) & 7, delayCs: delayCs, transparent: !!(gp & 1), transparentIndex: tIdx };
      } else if (label === 0xff) { // Application Extension (NETSCAPE2.0 = bucle)
        const size = bytes[p++];
        let app = "";
        for (let i = 0; i < size && p + i < bytes.length; i++) app += String.fromCharCode(bytes[p + i]);
        p += size;
        if (app === "NETSCAPE2.0") {
          while (p < bytes.length) {
            const len = bytes[p++];
            if (!len) break;
            if (len >= 3 && bytes[p] === 1) loopCount = bytes[p + 1] | (bytes[p + 2] << 8);
            p += len;
          }
        } else {
          p = gifSkipSubBlocks(bytes, p);
        }
      } else {
        p = gifSkipSubBlocks(bytes, p);
      }
    } else if (b === 0x2c) { // Image Descriptor
      const left = bytes[p] | (bytes[p + 1] << 8);
      const top = bytes[p + 2] | (bytes[p + 3] << 8);
      const fw = bytes[p + 4] | (bytes[p + 5] << 8);
      const fh = bytes[p + 6] | (bytes[p + 7] << 8);
      const ipacked = bytes[p + 8];
      p += 9;
      let lct = null;
      if (ipacked & 0x80) {
        const size = 2 << (ipacked & 7);
        lct = gifReadColorTable(bytes, p, size);
        p += size * 3;
      }
      const interlaced = !!(ipacked & 0x40);
      const minCodeSize = bytes[p++];
      const data = [];
      while (p < bytes.length) {
        const len = bytes[p++];
        if (!len) break;
        for (let i = 0; i < len; i++) data.push(bytes[p + i]);
        p += len;
      }
      if (!fw || !fh) { gce = null; continue; }
      let indices = gifLzwDecode(data, minCodeSize, fw * fh);
      if (interlaced) indices = gifDeinterlace(indices, fw, fh);
      const palette = lct || gct;
      if (!palette) { gce = null; continue; }
      const tIdx = (gce && gce.transparent) ? gce.transparentIndex : -1;
      const saved = (gce && gce.disposal === 3) ? comp.slice() : null;

      for (let y = 0; y < fh; y++) {
        const cy = top + y;
        if (cy < 0 || cy >= height) continue;
        for (let x = 0; x < fw; x++) {
          const cx = left + x;
          if (cx < 0 || cx >= width) continue;
          const idx = indices[y * fw + x];
          if (idx === tIdx) continue; // píxel transparente: no cambia el lienzo
          const c = palette[idx] || [0, 0, 0];
          const di = (cy * width + cx) * 4;
          comp[di] = c[0]; comp[di + 1] = c[1]; comp[di + 2] = c[2]; comp[di + 3] = 255;
        }
      }
      const delayCs = gce ? gce.delayCs : 10;
      let delayMs = delayCs * 10;
      if (delayMs < 20) delayMs = 100; // normalización de los navegadores
      frames.push({ rgba: comp.slice(), delayMs: delayMs, delayCs: delayCs });

      if (gce && gce.disposal === 2) { // restaurar a transparente (solo el rect del frame)
        for (let y = 0; y < fh; y++) {
          const cy = top + y;
          if (cy < 0 || cy >= height) continue;
          for (let x = 0; x < fw; x++) {
            const cx = left + x;
            if (cx < 0 || cx >= width) continue;
            const di = (cy * width + cx) * 4;
            comp[di] = comp[di + 1] = comp[di + 2] = comp[di + 3] = 0;
          }
        }
      } else if (saved) { // disposal 3: restaurar el lienzo anterior
        comp.set(saved);
      }
      gce = null;
    } else {
      break; // bloque desconocido: detener el análisis
    }
  }
  if (!frames.length) throw new Error("el GIF no contiene imágenes");
  return { width: width, height: height, loopCount: loopCount, frames: frames };
}

/* ---------- Codificador GIF (puro, sin DOM) ---------- */

function gifLzwEncode(indices, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  const dict = new Map(); // clave: (códigoPrefijo << 8) | k
  const out = [];
  let cur = 0, curBits = 0;
  const emit = code => {
    cur |= code << curBits;
    curBits += codeSize;
    while (curBits >= 8) { out.push(cur & 0xff); cur >>>= 8; curBits -= 8; }
  };
  emit(clearCode);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const found = dict.get(key);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix);
    if (nextCode === 4096) {
      emit(clearCode);
      dict.clear();
      nextCode = eoiCode + 1;
      codeSize = minCodeSize + 1;
    } else {
      if (nextCode >= (1 << codeSize) && codeSize < 12) codeSize++;
      dict.set(key, nextCode++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoiCode);
  if (curBits > 0) out.push(cur & 0xff);
  return out;
}

function gifPaletteSizeExp(n) {
  let e = 0;
  while ((2 << e) < n) e++;
  return e; // tabla de 2^(e+1) entradas
}

function gifMedianCut(counts, maxColors) {
  const colors = [];
  for (const entry of counts) {
    const key = entry[0], count = entry[1];
    colors.push([(key >> 16) & 255, (key >> 8) & 255, key & 255, count]);
  }
  const boxes = [colors];
  while (boxes.length < maxColors) {
    let bi = -1, bAxis = -1, bRange = -1;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.length < 2) continue;
      let range = -1, axis = -1;
      for (let a = 0; a < 3; a++) {
        let mn = 255, mx = 0;
        for (let j = 0; j < box.length; j++) {
          if (box[j][a] < mn) mn = box[j][a];
          if (box[j][a] > mx) mx = box[j][a];
        }
        if (mx - mn > range) { range = mx - mn; axis = a; }
      }
      if (range > bRange) { bRange = range; bAxis = axis; bi = i; }
    }
    if (bi < 0 || bRange <= 0) break;
    const box = boxes[bi];
    box.sort((x, y) => x[bAxis] - y[bAxis]);
    let total = 0;
    for (let j = 0; j < box.length; j++) total += box[j][3];
    let acc = 0, split = box.length - 1;
    for (let j = 0; j < box.length; j++) {
      acc += box[j][3];
      if (acc >= total / 2) { split = Math.min(j + 1, box.length - 1); break; }
    }
    boxes.splice(bi, 1, box.slice(0, split), box.slice(split));
  }
  return boxes.map(box => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let j = 0; j < box.length; j++) {
      r += box[j][0] * box[j][3]; g += box[j][1] * box[j][3]; b += box[j][2] * box[j][3]; n += box[j][3];
    }
    return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [0, 0, 0];
  });
}

/* Cuantiza RGBA a ≤256 colores (paleta exacta si cabe; si no, median cut).
   Devuelve { indices, palette, transparentIndex } */
function gifQuantize(rgba, maxColors) {
  const n = rgba.length / 4;
  const counts = new Map();
  let hasAlpha = false;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) { hasAlpha = true; continue; }
    const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const maxPal = hasAlpha ? maxColors - 1 : maxColors;
  let palette;
  if (!counts.size) {
    palette = [[0, 0, 0]];
  } else if (counts.size <= maxPal) {
    palette = [];
    for (const key of counts.keys())
      palette.push([(key >> 16) & 255, (key >> 8) & 255, key & 255]);
  } else {
    palette = gifMedianCut(counts, maxPal);
  }
  let transparentIndex = null;
  if (hasAlpha) { transparentIndex = palette.length; palette.push([0, 0, 0]); }

  const cache = new Map();
  const indices = new Uint8Array(n);
  for (let i = 0, px = 0; i < rgba.length; i += 4, px++) {
    if (rgba[i + 3] < 128) { indices[px] = transparentIndex; continue; }
    const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    let idx = cache.get(key);
    if (idx === undefined) {
      let best = 0, bestD = Infinity;
      for (let j = 0; j < palette.length; j++) {
        const dr = rgba[i] - palette[j][0], dg = rgba[i + 1] - palette[j][1], db = rgba[i + 2] - palette[j][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = j; }
      }
      idx = best;
      cache.set(key, idx);
    }
    indices[px] = idx;
  }
  return { indices: indices, palette: palette, transparentIndex: transparentIndex };
}

/* framesData: [{ indices, palette, transparentIndex, delayCs }] */
function buildGifFile(width, height, framesData, loopCount) {
  const parts = [];
  const u16 = v => [v & 255, (v >> 8) & 255];
  const ascii = s => { const a = []; for (let i = 0; i < s.length; i++) a.push(s.charCodeAt(i)); return a; };
  const writeTable = palette => {
    const exp = gifPaletteSizeExp(palette.length);
    const size = 2 << exp;
    const t = new Uint8Array(size * 3);
    for (let i = 0; i < size; i++) {
      const c = palette[i] || [0, 0, 0];
      t[i * 3] = c[0]; t[i * 3 + 1] = c[1]; t[i * 3 + 2] = c[2];
    }
    parts.push([0x80 | exp], t);
    return exp;
  };

  parts.push(ascii("GIF89a"), u16(width), u16(height));
  // tabla de color global = paleta del primer frame (cada frame lleva además su LCT)
  const gctExp = gifPaletteSizeExp(framesData[0].palette.length);
  const gct = new Uint8Array((2 << gctExp) * 3);
  for (let i = 0; i < (2 << gctExp); i++) {
    const c = framesData[0].palette[i] || [0, 0, 0];
    gct[i * 3] = c[0]; gct[i * 3 + 1] = c[1]; gct[i * 3 + 2] = c[2];
  }
  parts.push([0x80 | 0x70 | gctExp, 0, 0], gct);
  // bucle NETSCAPE (0 = infinito)
  parts.push([0x21, 0xff, 0x0b], ascii("NETSCAPE2.0"), [0x03, 0x01], u16(loopCount || 0), [0x00]);

  for (let f = 0; f < framesData.length; f++) {
    const fd = framesData[f];
    const delay = Math.max(0, Math.min(65535, fd.delayCs || 0));
    const packedG = (2 << 2) | (fd.transparentIndex !== null ? 1 : 0); // disposal 2
    parts.push([0x21, 0xf9, 0x04, packedG], u16(delay),
      [fd.transparentIndex !== null ? fd.transparentIndex : 0, 0x00]);
    parts.push([0x2c], u16(0), u16(0), u16(width), u16(height));
    const exp = writeTable(fd.palette); // tabla local
    const minCodeSize = Math.max(2, exp + 1);
    parts.push([minCodeSize]);
    const enc = gifLzwEncode(fd.indices, minCodeSize);
    for (let i = 0; i < enc.length; i += 255) {
      const chunk = enc.slice(i, i + 255);
      parts.push([chunk.length], chunk);
    }
    parts.push([0x00]);
  }
  parts.push([0x3b]);

  let total = 0;
  for (let i = 0; i < parts.length; i++) total += parts[i].length;
  const outBytes = new Uint8Array(total);
  let off = 0;
  for (let i = 0; i < parts.length; i++) { outBytes.set(parts[i], off); off += parts[i].length; }
  return outBytes;
}

/* ================= Estado y modo ================= */

const gifState = {
  fileName: "",
  width: 0, height: 0,
  frames: [],   // [{ rgba, delayMs, delayCs }]
  loopCount: 0,
  annos: [],    // por frame: [{ type, x, y, w?, h?, color, shape?, points?, strokeWidth?, text?, fontSize?, fontCss? }]
  current: 0,
  playing: false,
  speed: 1,
  timer: null,
  tool: "select",
  color: "#ffe066",
  shape: "rect",
  pendingImage: null, // dataURL de la imagen recortada lista para colocar (herramienta 🖼 Imagen)
  history: [],
  redoStack: []
};

let gifUi = null; // { wrap, canvas, layer, slider, counter, playBtn }
let gifOffscreen = null, gifOffCtx = null;

function isGifMode() { return appMode === "gif"; }

function updateGifExportButtons() {
  const show = isGifMode() && gifState.frames.length > 0;
  $("#gifExportPngBtn").hidden = !show;
  $("#gifExportGifBtn").hidden = !show;
}

function enterGifMode() {
  $("#gifTools").hidden = !gifState.frames.length;
  updateGifExportButtons();
  if (gifState.frames.length) {
    renderGifViewer();
  } else {
    viewer.innerHTML = '<div class="hint">Carga un GIF animado a la izquierda para reproducirlo y editarlo aquí.<br><br>' +
      '• ▶ Reproduce, ⏸ pausa, ⏹ stop y navega frame a frame con ⏮ / ⏭ o el deslizador.<br>' +
      '• Herramientas: resaltar, pintar, trazo a mano alzada y texto sobre el frame actual.<br>' +
      '• Exporta el frame visible como <b>PNG</b> o la animación completa (con ediciones) como <b>GIF</b>.<br>' +
      '• Todo ocurre en tu equipo, sin conexión.</div>';
    statusEl.textContent = "GIF";
  }
}

function stopGifPlayback() { gifPause(); }

/* ---------- Carga de archivos ---------- */

$("#gifPickBtn").addEventListener("click", () => $("#gifFile").click());
$("#gifFile").addEventListener("change", () => {
  const f = $("#gifFile").files[0];
  if (f) loadGifFile(f);
  $("#gifFile").value = "";
});

["dragover", "dragenter"].forEach(ev => $("#gifDrop").addEventListener(ev, e => {
  e.preventDefault();
  $("#gifDrop").classList.add("dragover");
}));
["dragleave", "drop"].forEach(ev => $("#gifDrop").addEventListener(ev, e => {
  e.preventDefault();
  $("#gifDrop").classList.remove("dragover");
}));
$("#gifDrop").addEventListener("drop", e => {
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f && (f.type === "image/gif" || /\.gif$/i.test(f.name))) loadGifFile(f);
  else toast("Suelta un archivo .gif");
});

async function loadGifFile(file, append) {
  try {
    statusEl.textContent = "GIF · cargando…";
    const buf = await file.arrayBuffer();
    const gif = decodeGifBytes(new Uint8Array(buf));
    gifPause();
    if (!append || !gifState.frames.length) {
      // carga inicial (o primera): reemplazar todo
      gifState.fileName = file.name;
      gifState.width = gif.width;
      gifState.height = gif.height;
      gifState.frames = gif.frames;
      gifState.loopCount = gif.loopCount !== null ? gif.loopCount : 0;
      gifState.annos = gif.frames.map(() => []);
      gifState.current = 0;
      gifState.history = [];
      gifState.redoStack = [];
    } else {
      // añadir las imágenes del otro GIF al final del actual.
      // Se mantienen las dimensiones del GIF en edición; el nuevo GIF se compone
      // centrado a su tamaño natural (escalado para caber, sin agrandar) para no
      // alterar el lienzo ni las anotaciones existentes.
      const W = gifState.width, H = gifState.height;
      const s = Math.min(1, W / gif.width, H / gif.height);
      const dw = Math.max(1, Math.round(gif.width * s));
      const dh = Math.max(1, Math.round(gif.height * s));
      const offX = Math.round((W - dw) / 2);
      const offY = Math.round((H - dh) / 2);
      const srcC = document.createElement("canvas");
      srcC.width = gif.width; srcC.height = gif.height;
      const dst = document.createElement("canvas");
      dst.width = W; dst.height = H;
      const dctx = dst.getContext("2d");
      for (const frame of gif.frames) {
        const sctx = srcC.getContext("2d");
        sctx.imageSmoothingEnabled = true;
        sctx.clearRect(0, 0, gif.width, gif.height);
        sctx.putImageData(new ImageData(frame.rgba, gif.width, gif.height), 0, 0);
        dctx.clearRect(0, 0, W, H);
        dctx.imageSmoothingEnabled = true;
        dctx.drawImage(srcC, offX, offY, dw, dh);
        gifState.frames.push({ rgba: dctx.getImageData(0, 0, W, H).data, delayMs: frame.delayMs, delayCs: frame.delayCs });
        gifState.annos.push([]);
      }
    }
    const total = gifState.frames.length;
    updateGifInfo();
    $("#gifInfoBox").hidden = false;
    $("#gifTools").hidden = false;
    updateGifExportButtons();
    renderGifFrames();
    renderGifViewer();
    statusEl.textContent = "GIF · " + total + " frames · " + gifState.width + "×" + gifState.height;
    toast(append ? "GIF añadido (" + gif.frames.length + " frames)" : "GIF cargado: " + total + " frames");
    if (append) updateGifDisplay();
    else gifPlay();
  } catch (err) {
    statusEl.textContent = "GIF · error";
    toast("No se pudo leer el GIF: " + err.message);
  }
}

/* ---------- Info + miniaturas de frames (reordenar / añadir / duplicar / eliminar) ---------- */

function updateGifInfo() {
  const total = gifState.frames.length;
  $("#gifInfo").textContent = gifState.fileName + " · " + total +
    (total === 1 ? " frame" : " frames") + " · " + gifState.width + "×" + gifState.height;
}

function renderGifFrames() {
  const box = $("#gifFrames");
  if (!box) return;
  box.innerHTML = "";
  if (!gifState.frames.length) { box.hidden = true; return; }
  box.hidden = false;
  for (let pos = 0; pos < gifState.frames.length; pos++) {
    const item = document.createElement("div");
    item.className = "gif-thumb" + (pos === gifState.current ? " current" : "");
    item.draggable = true;
    item.dataset.pos = pos;

    const canvas = document.createElement("canvas");
    const maxT = 46;
    const scale = Math.min(maxT / gifState.width, maxT / gifState.height);
    canvas.width = Math.max(1, Math.round(gifState.width * scale));
    canvas.height = Math.max(1, Math.round(gifState.height * scale));
    const off = document.createElement("canvas");
    off.width = gifState.width; off.height = gifState.height;
    off.getContext("2d").putImageData(gifFrameImageData(pos), 0, 0);
    canvas.getContext("2d").drawImage(off, 0, 0, canvas.width, canvas.height);

    const meta = document.createElement("div");
    meta.className = "pt-meta";
    const nAnnos = (gifState.annos[pos] || []).length;
    // mostrar duración en texto de la suma de los 2 decimales más bonitos: usa s del delayMs
    const secs = Math.round(gifState.frames[pos].delayMs) / 1000;
    meta.innerHTML = '<div class="pt-num">Frame ' + (pos + 1) + "</div>" +
      "<div>" + secs.toFixed(1).replace(".", ",") + " s" +
      (nAnnos ? " · ✎" + nAnnos : "") + "</div>";

    const actions = document.createElement("div");
    actions.className = "pt-actions";
    const dupBtn = document.createElement("button");
    dupBtn.className = "mini";
    dupBtn.textContent = "⧉";
    dupBtn.title = "Duplicar frame (copia debajo)";
    dupBtn.addEventListener("click", e => { e.stopPropagation(); gifDupFrame(pos); });
    const delBtn = document.createElement("button");
    delBtn.className = "mini";
    delBtn.textContent = "✕";
    delBtn.title = "Eliminar este frame";
    delBtn.addEventListener("click", e => { e.stopPropagation(); gifDelFrame(pos); });
    actions.appendChild(dupBtn);
    actions.appendChild(delBtn);

    item.appendChild(canvas);
    item.appendChild(meta);
    item.appendChild(actions);

    item.addEventListener("click", () => {
      if (gifState.current !== pos) {
        gifState.current = pos;
        updateGifDisplay();
        renderGifFrames();
      }
    });

    item.addEventListener("dragstart", e => {
      item.classList.add("dragging");
      e.dataTransfer.setData("text/plain", String(pos));
      e.dataTransfer.effectAllowed = "move";
    });
    item.addEventListener("dragend", () => item.classList.remove("dragging"));
    item.addEventListener("dragover", e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      item.classList.add("dragover-thumb");
    });
    item.addEventListener("dragleave", () => item.classList.remove("dragover-thumb"));
    item.addEventListener("drop", e => {
      e.preventDefault();
      e.stopPropagation();
      item.classList.remove("dragover-thumb");
      const from = parseInt(e.dataTransfer.getData("text/plain"), 10);
      const to = parseInt(item.dataset.pos, 10);
      if (isNaN(from) || from === to) return;
      const [moved] = gifState.frames.splice(from, 1);
      const [movedAnnos] = gifState.annos.splice(from, 1);
      gifState.frames.splice(to, 0, moved);
      gifState.annos.splice(to, 0, movedAnnos);
      gifState.current = Math.min(to, gifState.frames.length - 1);
      updateGifInfo();
      renderGifFrames();
      renderGifViewer();
      toast("Frame reordenado");
    });

    box.appendChild(item);
  }
}

/* añade un frame nuevo en blanco (transparente) justo después del frame actual */
function gifAddFrame() {
  if (!gifState.frames.length) return;
  gifPause();
  const blank = new Uint8ClampedArray(gifState.width * gifState.height * 4);
  const at = Math.min(gifState.current + 1, gifState.frames.length);
  gifState.frames.splice(at, 0, { rgba: blank, delayMs: 100, delayCs: 10 });
  gifState.annos.splice(at, 0, []);
  gifState.current = at;
  updateGifInfo();
  renderGifFrames();
  renderGifViewer();
  updateGifDisplay();
  toast("Frame añadido en posición " + (at + 1));
}

/* copia el frame pos (contenido + anotaciones) y lo inserta debajo */
function gifDupFrame(pos) {
  gifPause();
  const src = gifState.frames[pos];
  const copy = { rgba: src.rgba.slice(), delayMs: src.delayMs, delayCs: src.delayCs };
  const copyAnnos = (gifState.annos[pos] || []).map(a => JSON.parse(JSON.stringify(a)));
  const at = pos + 1;
  gifState.frames.splice(at, 0, copy);
  gifState.annos.splice(at, 0, copyAnnos);
  gifState.current = at;
  updateGifInfo();
  renderGifFrames();
  renderGifViewer();
  updateGifDisplay();
  toast("Frame " + (pos + 1) + " duplicado");
}

/* elimina el frame pos y sus anotaciones */
function gifDelFrame(pos) {
  if (gifState.frames.length <= 1) { toast("No se puede eliminar el último frame"); return; }
  gifPause();
  gifState.frames.splice(pos, 1);
  gifState.annos.splice(pos, 1);
  gifState.current = Math.min(gifState.current, gifState.frames.length - 1);
  updateGifInfo();
  renderGifFrames();
  renderGifViewer();
  updateGifDisplay();
  toast("Frame eliminado");
}

$("#gifAddFrameBtn").addEventListener("click", gifAddFrame);

/* ---------- Añadir otro GIF al final ---------- */

$("#gifAppendBtn").addEventListener("click", () => $("#gifAppendFile").click());
$("#gifAppendFile").addEventListener("change", () => {
  const f = $("#gifAppendFile").files[0];
  if (f) loadGifFile(f, true);
  $("#gifAppendFile").value = "";
});

/* ---------- Visor: canvas + capa de anotaciones + controles ---------- */

function gifDisplayScale() {
  const maxW = Math.max(Math.min((viewer.clientWidth || 800) - 40, 1000), 280);
  return Math.min(maxW / gifState.width, 2);
}

function renderGifViewer() {
  if (!gifState.frames.length) return;
  viewer.innerHTML = "";
  const contentWrap = document.createElement("div");
  contentWrap.id = "viewerContent";
  contentWrap.style.zoom = "1";
  viewer.appendChild(contentWrap);

  const box = document.createElement("div");
  box.className = "gif-player";
  box.id = "gifPlayer";

  const scale = gifDisplayScale() * appZoom;
  const dw = Math.max(1, Math.round(gifState.width * scale));
  const dh = Math.max(1, Math.round(gifState.height * scale));

  const wrap = document.createElement("div");
  wrap.className = "gif-frame-wrap";
  wrap.dataset.tool = gifState.tool;

  const canvas = document.createElement("canvas");
  canvas.width = dw; canvas.height = dh;
  wrap.appendChild(canvas);

  const layer = document.createElement("div");
  layer.className = "gif-anno-layer";
  wrap.appendChild(layer);

  const controls = document.createElement("div");
  controls.className = "gif-controls";

  const mkBtn = (txt, title) => {
    const b = document.createElement("button");
    b.className = "btn small";
    b.textContent = txt; b.title = title;
    return b;
  };

  const prevBtn = mkBtn("⏮", "Frame anterior");
  const playBtn = mkBtn("▶", "Reproducir / pausar");
  playBtn.classList.add("gif-play");
  const stopBtn = mkBtn("⏹", "Stop (vuelve al primer frame)");
  const nextBtn = mkBtn("⏭", "Frame siguiente");

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = 0; slider.max = gifState.frames.length - 1; slider.value = gifState.current;
  slider.title = "Navegar entre frames";

  const counter = document.createElement("span");
  counter.className = "gif-counter";

  const speedSel = document.createElement("select");
  speedSel.title = "Velocidad de reproducción";
  [[0.25, "0.25x"], [0.5, "0.5x"], [1, "1x"], [2, "2x"], [4, "4x"]].forEach(([v, t]) => {
    const o = document.createElement("option");
    o.value = v; o.textContent = t;
    if (v === gifState.speed) o.selected = true;
    speedSel.appendChild(o);
  });

  prevBtn.addEventListener("click", () => { gifPause(); gifStep(-1); });
  nextBtn.addEventListener("click", () => { gifPause(); gifStep(1); });
  playBtn.addEventListener("click", () => { gifState.playing ? gifPause() : gifPlay(); });
  stopBtn.addEventListener("click", gifStop);
  slider.addEventListener("input", () => { gifPause(); gifState.current = +slider.value; updateGifDisplay(); });
  speedSel.addEventListener("change", () => {
    gifState.speed = parseFloat(speedSel.value);
    if (gifState.playing) scheduleGifFrame();
  });

  controls.appendChild(prevBtn);
  controls.appendChild(playBtn);
  controls.appendChild(stopBtn);
  controls.appendChild(nextBtn);
  controls.appendChild(slider);
  controls.appendChild(counter);
  controls.appendChild(speedSel);

  box.appendChild(wrap);
  box.appendChild(controls);
  contentWrap.appendChild(box);

  gifUi = { wrap: wrap, canvas: canvas, layer: layer, slider: slider, counter: counter, playBtn: playBtn };
  attachGifAnnoEvents(layer, wrap, dw, dh);
  updateGifDisplay();
}

/* ---------- Reproducción ---------- */

function gifFrameImageData(i) {
  return new ImageData(gifState.frames[i].rgba, gifState.width, gifState.height);
}

function updateGifDisplay() {
  if (!gifUi || !gifState.frames.length) return;
  const f = gifState.frames[gifState.current];
  if (!gifOffscreen || gifOffscreen.width !== gifState.width || gifOffscreen.height !== gifState.height) {
    gifOffscreen = document.createElement("canvas");
    gifOffscreen.width = gifState.width;
    gifOffscreen.height = gifState.height;
    gifOffCtx = gifOffscreen.getContext("2d");
  }
  gifOffCtx.putImageData(gifFrameImageData(gifState.current), 0, 0);
  const dctx = gifUi.canvas.getContext("2d");
  dctx.imageSmoothingEnabled = false;
  dctx.clearRect(0, 0, gifUi.canvas.width, gifUi.canvas.height);
  dctx.drawImage(gifOffscreen, 0, 0, gifUi.canvas.width, gifUi.canvas.height);

  // no redibujar anotaciones si hay un editor de texto abierto
  if (!gifUi.layer.querySelector(".anno-text-holder")) {
    drawGifAnnos(gifUi.layer, gifState.current, gifUi.canvas.width, gifUi.canvas.height);
  }
  gifUi.slider.value = gifState.current;
  gifUi.counter.textContent = (gifState.current + 1) + " / " + gifState.frames.length;
}

function updateGifPlayBtn() {
  if (!gifUi) return;
  gifUi.playBtn.textContent = gifState.playing ? "⏸" : "▶";
  gifUi.playBtn.classList.toggle("active", gifState.playing);
}

function gifPlay() {
  if (!gifState.frames.length || gifState.frames.length === 1) return;
  gifState.playing = true;
  updateGifPlayBtn();
  scheduleGifFrame();
}

function gifPause() {
  gifState.playing = false;
  clearTimeout(gifState.timer);
  updateGifPlayBtn();
}

function gifStop() {
  gifPause();
  gifState.current = 0;
  updateGifDisplay();
}

function gifStep(dir) {
  if (!gifState.frames.length) return;
  gifState.current = (gifState.current + dir + gifState.frames.length) % gifState.frames.length;
  updateGifDisplay();
}

function scheduleGifFrame() {
  clearTimeout(gifState.timer);
  const d = Math.max(gifState.frames[gifState.current].delayMs, 20);
  gifState.timer = setTimeout(() => {
    if (!gifState.playing) return;
    gifState.current = (gifState.current + 1) % gifState.frames.length;
    updateGifDisplay();
    if (gifState.playing) scheduleGifFrame();
  }, d / gifState.speed);
}

let gifResizeTimer = null;
window.addEventListener("resize", () => {
  if (!isGifMode() || !gifState.frames.length) return;
  clearTimeout(gifResizeTimer);
  gifResizeTimer = setTimeout(() => renderGifViewer(), 350);
});

/* ---------- Anotaciones (coordenadas fraccionarias 0-1, por frame) ---------- */

function drawGifAnnos(layer, frameIdx, W, H) {
  layer.innerHTML = "";
  const annos = gifState.annos[frameIdx] || [];
  for (let i = 0; i < annos.length; i++) {
    const a = annos[i];
    if (a.type === "free") {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "anno anno-free");
      svg.style.position = "absolute";
      svg.style.inset = "0";
      svg.style.width = "100%";
      svg.style.height = "100%";
      svg.style.pointerEvents = "none";
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", a.color);
      path.setAttribute("stroke-width", String(a.strokeWidth * W));
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      path.setAttribute("d", "M " + a.points.map(p => (p.x * W) + " " + (p.y * H)).join(" L "));
      svg.appendChild(path);
      layer.appendChild(svg);
      continue;
    }
    const el = document.createElement("div");
    el.className = "anno anno-" + a.type;
    el.style.left = (a.x * W) + "px";
    el.style.top = (a.y * H) + "px";
    if (a.type === "highlight" || a.type === "redact") {
      el.style.width = (a.w * W) + "px";
      el.style.height = (a.h * H) + "px";
      el.style.background = a.color;
      if (a.shape === "round") el.style.borderRadius = "12px";
      if (a.shape === "ellipse") el.style.borderRadius = "50%";
    }
    if (a.type === "text") {
      el.textContent = a.text;
      el.style.color = a.color;
      el.style.fontSize = (a.fontSize * H) + "px";
      el.style.height = "auto";
      el.style.width = "auto";
      el.style.maxWidth = ((1 - a.x) * W) + "px";
      el.style.fontFamily = a.fontCss || "sans-serif";
      makeGifTextEditable(el, a, layer, W, H);
    }
    if (a.type === "image") {
      const img = document.createElement("img");
      img.src = a.imgData;
      el.appendChild(img);
      el.style.left = (a.x * W) + "px";
      el.style.top = (a.y * H) + "px";
      el.style.width = (a.w * W) + "px";
      el.style.height = (a.h * H) + "px";
      makeGifImageEditable(el, a, layer, W, H);
    }
    layer.appendChild(el);
  }
}

/* ---------- Texto: mover, editar, eliminar ---------- */

function makeGifTextEditable(el, anno, layer, W, H) {
  const delHandle = document.createElement("div");
  delHandle.className = "delete-handle";
  delHandle.textContent = "✕";
  delHandle.title = "Eliminar texto";
  el.appendChild(delHandle);

  const editHandle = document.createElement("div");
  editHandle.className = "edit-handle";
  editHandle.textContent = "✎";
  editHandle.title = "Editar texto";
  el.appendChild(editHandle);

  const openEditor = () => {
    el.style.display = "none";
    openGifTextInput(layer, anno.x * W, anno.y * H, anno, W, H);
  };
  editHandle.addEventListener("mousedown", e => { e.preventDefault(); e.stopPropagation(); });
  editHandle.addEventListener("click", e => { e.stopPropagation(); openEditor(); });

  el.classList.add("anno-text-interactive");

  el.addEventListener("mousedown", e => {
    if (e.target === delHandle || e.target === editHandle) return;
    e.preventDefault();
    e.stopPropagation();
    gifPause(); // evitar que la reproducción reconstruya la capa a mitad del arrastre
    layer.querySelectorAll(".selected").forEach(i => i.classList.remove("selected"));
    el.classList.add("selected");
    const startMX = e.clientX, startMY = e.clientY;
    const origX = anno.x, origY = anno.y;
    const before = gifSnapshotAnno(anno);
    let moved = false;
    const onMove = ev => {
      const dx = (ev.clientX - startMX) / W;
      const dy = (ev.clientY - startMY) / H;
      if (Math.abs(ev.clientX - startMX) + Math.abs(ev.clientY - startMY) > 3) moved = true;
      anno.x = Math.min(Math.max(origX + dx, 0), 0.98);
      anno.y = Math.min(Math.max(origY + dy, 0), 0.98);
      el.style.left = (anno.x * W) + "px";
      el.style.top = (anno.y * H) + "px";
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (moved) recordGifAction({ type: "edit", frame: gifState.current, anno: anno, before: before, after: gifSnapshotAnno(anno) });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  el.addEventListener("dblclick", e => { e.preventDefault(); e.stopPropagation(); openEditor(); });

  delHandle.addEventListener("click", e => {
    e.stopPropagation();
    const list = gifState.annos[gifState.current] || [];
    const idx = list.indexOf(anno);
    if (idx >= 0) {
      list.splice(idx, 1);
      recordGifAction({ type: "delete", frame: gifState.current, anno: anno, index: idx });
    }
    updateGifDisplay();
    toast("Texto eliminado");
  });
}

/* ---------- Imagen: mover, redimensionar, eliminar ---------- */

function makeGifImageEditable(el, anno, layer, W, H) {
  const handle = document.createElement("div");
  handle.className = "resize-handle";
  el.appendChild(handle);
  const delHandle = document.createElement("div");
  delHandle.className = "delete-handle";
  delHandle.textContent = "✕";
  delHandle.title = "Eliminar imagen";
  el.appendChild(delHandle);

  const deselectAll = () => layer.querySelectorAll(".anno-image.selected").forEach(i => i.classList.remove("selected"));

  el.addEventListener("mousedown", e => {
    if (e.target === handle || e.target === delHandle) return;
    e.preventDefault();
    e.stopPropagation();
    gifPause();
    deselectAll();
    el.classList.add("selected");
    const startMX = e.clientX, startMY = e.clientY;
    const origX = anno.x, origY = anno.y;
    const before = gifSnapshotAnno(anno);
    let moved = false;
    const onMove = ev => {
      if (Math.abs(ev.clientX - startMX) + Math.abs(ev.clientY - startMY) > 3) moved = true;
      anno.x = Math.min(Math.max(origX + (ev.clientX - startMX) / W, 0), 1 - anno.w);
      anno.y = Math.min(Math.max(origY + (ev.clientY - startMY) / H, 0), 1 - anno.h);
      el.style.left = (anno.x * W) + "px";
      el.style.top = (anno.y * H) + "px";
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (moved) recordGifAction({ type: "edit", frame: gifState.current, anno: anno, before: before, after: gifSnapshotAnno(anno) });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  handle.addEventListener("mousedown", e => {
    e.preventDefault();
    e.stopPropagation();
    gifPause();
    const startMX = e.clientX, startMY = e.clientY;
    const origW = anno.w, origH = anno.h;
    const before = gifSnapshotAnno(anno);
    let resized = false;
    const ratio = origW / origH;
    const onMove = ev => {
      resized = true;
      let newW = Math.max(origW + (ev.clientX - startMX) / W, 0.02);
      let newH = Math.max(origH + (ev.clientY - startMY) / H, 0.02);
      if (ev.shiftKey) newH = newW / ratio;
      anno.w = Math.min(newW, 1 - anno.x);
      anno.h = Math.min(newH, 1 - anno.y);
      el.style.width = (anno.w * W) + "px";
      el.style.height = (anno.h * H) + "px";
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (resized) recordGifAction({ type: "edit", frame: gifState.current, anno: anno, before: before, after: gifSnapshotAnno(anno) });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  delHandle.addEventListener("click", e => {
    e.stopPropagation();
    const list = gifState.annos[gifState.current] || [];
    const idx = list.indexOf(anno);
    if (idx >= 0) {
      list.splice(idx, 1);
      recordGifAction({ type: "delete", frame: gifState.current, anno: anno, index: idx });
    }
    updateGifDisplay();
    toast("Imagen eliminada");
  });
}

/* ---------- Herramienta 🖼 Imagen: elegir, recortar y colocar ---------- */

let gifCropSource = null; // { dataUrl, naturalW, naturalH, img, displayW, displayH, sel, box }

function gifOpenCropDialog(dataUrl) {
  const img = new Image();
  img.onload = () => {
    gifCropSource = { dataUrl: dataUrl, naturalW: img.naturalWidth, naturalH: img.naturalHeight, img: img, sel: null, box: null };
    const stage = $("#gifCropStage");
    stage.innerHTML = "";
    const maxW = 640, maxH = 400;
    const s = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
    const dw = Math.max(1, Math.round(img.naturalWidth * s));
    const dh = Math.max(1, Math.round(img.naturalHeight * s));
    stage.style.width = dw + "px";
    stage.style.height = dh + "px";
    img.style.width = dw + "px";
    img.style.height = dh + "px";
    stage.appendChild(img);
    gifCropSource.displayW = dw;
    gifCropSource.displayH = dh;
    const sel = document.createElement("div");
    sel.className = "crop-selection";
    stage.appendChild(sel);
    gifCropSource.sel = sel;
    $("#gifCropModal").hidden = false;
  };
  img.src = dataUrl;
}

$("#gifCropStage").addEventListener("mousedown", e => {
  if (!gifCropSource) return;
  e.preventDefault();
  const stage = $("#gifCropStage");
  const rect = stage.getBoundingClientRect();
  const pos = ev => ({
    x: Math.min(Math.max(ev.clientX - rect.left, 0), rect.width),
    y: Math.min(Math.max(ev.clientY - rect.top, 0), rect.height)
  });
  const start = pos(e);
  const sel = gifCropSource.sel;
  let box = null;
  const onMove = ev => {
    const cur = pos(ev);
    box = { x: Math.min(start.x, cur.x), y: Math.min(start.y, cur.y), w: Math.abs(cur.x - start.x), h: Math.abs(cur.y - start.y) };
    sel.style.left = box.x + "px";
    sel.style.top = box.y + "px";
    sel.style.width = box.w + "px";
    sel.style.height = box.h + "px";
  };
  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    gifCropSource.box = box;
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
});

$("#gifCropBtn").addEventListener("click", () => {
  if (!gifCropSource || !gifCropSource.box) { toast("Arrastra sobre la imagen para elegir la zona a recortar"); return; }
  const b = gifCropSource.box;
  if (b && (b.w < 4 || b.h < 4)) { toast("La zona de recorte es demasiado pequeña"); return; }
  const src = gifCropSource;
  const sx = b.x / src.displayW, sy = b.y / src.displayH;
  const sw = b.w / src.displayW, sh = b.h / src.displayH;
  const cx = Math.round(sx * src.naturalW), cy = Math.round(sy * src.naturalH);
  const cw = Math.max(1, Math.round(sw * src.naturalW)), ch = Math.max(1, Math.round(sh * src.naturalH));
  const c = document.createElement("canvas");
  c.width = cw; c.height = ch;
  c.getContext("2d").drawImage(src.img, cx, cy, cw, ch, 0, 0, cw, ch);
  gifState.pendingImage = c.toDataURL("image/png");
  $("#gifCropModal").hidden = true;
  gifCropSource = null;
  toast("Imagen recortada: arrastra en el frame dónde colocarla");
});

$("#gifCropCancel").addEventListener("click", () => {
  $("#gifCropModal").hidden = true;
  gifCropSource = null;
});

$("#gifImgFile").addEventListener("change", () => {
  const f = $("#gifImgFile").files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => gifOpenCropDialog(reader.result);
  reader.readAsDataURL(f);
  $("#gifImgFile").value = "";
});

function openGifTextInput(layer, xPx, yPx, editAnno, W, H) {
  gifPause();
  const wrap = layer.closest(".gif-frame-wrap");
  const holder = document.createElement("div");
  holder.className = "anno-text-holder";
  holder.style.left = xPx + "px";
  holder.style.top = yPx + "px";

  const bar = document.createElement("div");
  bar.className = "text-format-bar";

  const sizeSel = document.createElement("select");
  sizeSel.className = "tfb-size";
  [10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 60].forEach(v => {
    const o = document.createElement("option");
    o.value = v; o.textContent = v + "px";
    sizeSel.appendChild(o);
  });
  sizeSel.value = editAnno ? String(Math.round(editAnno.fontSize * H)) : "16";
  if (sizeSel.selectedIndex === -1) sizeSel.value = "16";

  const colorInp = document.createElement("input");
  colorInp.type = "color";
  colorInp.className = "tfb-color";
  colorInp.title = "Color del texto";
  colorInp.value = editAnno ? editAnno.color : (gifState.color === "#ffe066" ? "#000000" : gifState.color);

  const okBtn = document.createElement("button");
  okBtn.type = "button";
  okBtn.className = "tfb tfb-ok";
  okBtn.textContent = "✔";
  okBtn.title = "Confirmar (Ctrl+Enter)";
  okBtn.addEventListener("mousedown", e => e.preventDefault());
  okBtn.addEventListener("click", () => input.blur());

  bar.appendChild(sizeSel);
  bar.appendChild(colorInp);
  bar.appendChild(okBtn);

  const input = document.createElement("textarea");
  input.className = "anno-text-input";
  input.rows = 2;
  input.placeholder = "Escribe aquí…";
  if (editAnno) input.value = editAnno.text;

  const applyStyle = () => {
    input.style.fontSize = sizeSel.value + "px";
    input.style.color = colorInp.value;
  };
  applyStyle();
  sizeSel.addEventListener("mousedown", e => e.stopPropagation());
  sizeSel.addEventListener("change", () => { applyStyle(); input.focus(); });
  colorInp.addEventListener("mousedown", e => e.stopPropagation());
  colorInp.addEventListener("input", applyStyle);
  colorInp.addEventListener("change", () => input.focus());

  holder.appendChild(bar);
  holder.appendChild(input);
  wrap.appendChild(holder);
  setTimeout(() => input.focus(), 0);

  const commit = () => {
    const text = input.value.replace(/\s+$/, "");
    holder.remove();
    if (text.trim()) {
      const x = xPx / W, y = yPx / H;
      if (editAnno) {
        const before = gifSnapshotAnno(editAnno);
        editAnno.text = text;
        editAnno.color = colorInp.value;
        editAnno.fontSize = parseInt(sizeSel.value, 10) / H;
        recordGifAction({ type: "edit", frame: gifState.current, anno: editAnno, before: before, after: gifSnapshotAnno(editAnno) });
      } else {
        const anno = {
          type: "text", x: x, y: y, text: text,
          color: colorInp.value,
          fontSize: parseInt(sizeSel.value, 10) / H,
          fontCss: getComputedStyle(document.documentElement).getPropertyValue("--content-font") || "sans-serif"
        };
        (gifState.annos[gifState.current] = gifState.annos[gifState.current] || []).push(anno);
        recordGifAction({ type: "add", frame: gifState.current, anno: anno });
      }
    } else if (editAnno) {
      // texto vacío sobre una edición: eliminar
      const list = gifState.annos[gifState.current] || [];
      const idx = list.indexOf(editAnno);
      if (idx >= 0) {
        list.splice(idx, 1);
        recordGifAction({ type: "delete", frame: gifState.current, anno: editAnno, index: idx });
      }
    }
    updateGifDisplay();
  };

  input.addEventListener("blur", () => {
    // pequeña espera: si el foco pasó a la barra de formato, no confirmar aún
    setTimeout(() => {
      if (!holder.contains(document.activeElement)) commit();
    }, 120);
  });
  input.addEventListener("keydown", e => {
    if (e.key === "Escape") { input.value = ""; holder.remove(); updateGifDisplay(); }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) input.blur();
  });
}

/* ---------- Creación de anotaciones con el ratón ---------- */

function attachGifAnnoEvents(layer, wrap, W, H) {
  layer.addEventListener("mousedown", e => {
    if (e.button !== 0 || e.target !== layer) return;
    const tool = gifState.tool;
    if (tool === "select") return;
    e.preventDefault();
    gifPause();
    const rect = layer.getBoundingClientRect();
    const px = ev => ({ x: (ev.clientX - rect.left) / W, y: (ev.clientY - rect.top) / H });
    const start = px(e);

    if (tool === "text") {
      openGifTextInput(layer, start.x * W, start.y * H, null, W, H);
      return;
    }

    if (tool === "image") {
      if (!gifState.pendingImage) { toast("Primero elige/imagen y recórtala (botón 🖼 Imagen)"); return; }
      const draft = document.createElement("div");
      draft.className = "anno anno-image";
      draft.style.pointerEvents = "none";
      const img = document.createElement("img");
      img.src = gifState.pendingImage;
      draft.appendChild(img);
      layer.appendChild(draft);
      let box = null;
      const onMove = ev => {
        const cur = px(ev);
        box = {
          x: Math.min(start.x, cur.x), y: Math.min(start.y, cur.y),
          w: Math.abs(cur.x - start.x), h: Math.abs(cur.y - start.y)
        };
        draft.style.left = (box.x * W) + "px";
        draft.style.top = (box.y * H) + "px";
        draft.style.width = (box.w * W) + "px";
        draft.style.height = (box.h * H) + "px";
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        draft.remove();
        if (box && box.w * W >= 8 && box.h * H >= 8) {
          const anno = { type: "image", x: box.x, y: box.y, w: box.w, h: box.h, imgData: gifState.pendingImage };
          (gifState.annos[gifState.current] = gifState.annos[gifState.current] || []).push(anno);
          recordGifAction({ type: "add", frame: gifState.current, anno: anno });
          updateGifDisplay();
        }
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      return;
    }

    if (tool === "highlight" || tool === "redact") {
      const draft = document.createElement("div");
      draft.className = "anno anno-" + tool;
      draft.style.background = gifState.color;
      draft.style.pointerEvents = "none";
      if (gifState.shape === "round") draft.style.borderRadius = "12px";
      if (gifState.shape === "ellipse") draft.style.borderRadius = "50%";
      layer.appendChild(draft);
      let box = null;
      const onMove = ev => {
        const cur = px(ev);
        box = {
          x: Math.min(start.x, cur.x), y: Math.min(start.y, cur.y),
          w: Math.abs(cur.x - start.x), h: Math.abs(cur.y - start.y)
        };
        draft.style.left = (box.x * W) + "px";
        draft.style.top = (box.y * H) + "px";
        draft.style.width = (box.w * W) + "px";
        draft.style.height = (box.h * H) + "px";
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        draft.remove();
        if (box && box.w * W >= 4 && box.h * H >= 4) {
          const anno = { type: tool, x: box.x, y: box.y, w: box.w, h: box.h, color: gifState.color, shape: gifState.shape };
          (gifState.annos[gifState.current] = gifState.annos[gifState.current] || []).push(anno);
          recordGifAction({ type: "add", frame: gifState.current, anno: anno });
          updateGifDisplay();
        }
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      return;
    }

    if (tool === "free") {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "anno anno-free");
      svg.style.position = "absolute";
      svg.style.inset = "0";
      svg.style.width = "100%";
      svg.style.height = "100%";
      svg.style.pointerEvents = "none";
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", gifState.color);
      path.setAttribute("stroke-width", String(3));
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      svg.appendChild(path);
      layer.appendChild(svg);
      const points = [start];
      const redraw = () => {
        path.setAttribute("d", "M " + points.map(p => (p.x * W) + " " + (p.y * H)).join(" L "));
      };
      redraw();
      const onMove = ev => {
        const cur = px(ev);
        const last = points[points.length - 1];
        if (Math.hypot(cur.x - last.x, cur.y - last.y) * W > 3) { points.push(cur); redraw(); }
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        svg.remove();
        if (points.length >= 2) {
          const anno = { type: "free", points: points, color: gifState.color, strokeWidth: 3 / W };
          (gifState.annos[gifState.current] = gifState.annos[gifState.current] || []).push(anno);
          recordGifAction({ type: "add", frame: gifState.current, anno: anno });
          updateGifDisplay();
        }
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    }
  });
}

/* ---------- Historial de acciones (deshacer/rehacer) ---------- */

function gifSnapshotAnno(a) { return JSON.parse(JSON.stringify(a)); }

function gifApplySnapshot(anno, snap) {
  Object.keys(anno).forEach(k => delete anno[k]);
  Object.assign(anno, JSON.parse(JSON.stringify(snap)));
}

function recordGifAction(action) {
  gifState.history.push(action);
  gifState.redoStack.length = 0;
}

function undoLastGifAction() {
  const act = gifState.history.pop();
  if (!act) { toast("No hay nada que deshacer"); return; }
  const list = gifState.annos[act.frame] = gifState.annos[act.frame] || [];
  if (act.type === "add") {
    const i = list.indexOf(act.anno);
    if (i >= 0) list.splice(i, 1);
  } else if (act.type === "delete") {
    list.splice(Math.min(act.index, list.length), 0, act.anno);
  } else if (act.type === "edit") {
    gifApplySnapshot(act.anno, act.before);
  }
  gifState.redoStack.push(act);
  updateGifDisplay();
  toast("Deshecho");
}

function redoLastGifAction() {
  const act = gifState.redoStack.pop();
  if (!act) { toast("No hay nada que rehacer"); return; }
  const list = gifState.annos[act.frame] = gifState.annos[act.frame] || [];
  if (act.type === "add") {
    list.push(act.anno);
  } else if (act.type === "delete") {
    const i = list.indexOf(act.anno);
    if (i >= 0) list.splice(i, 1);
  } else if (act.type === "edit") {
    gifApplySnapshot(act.anno, act.after);
  }
  gifState.history.push(act);
  updateGifDisplay();
  toast("Rehecho");
}

$("#gifUndoBtn").addEventListener("click", undoLastGifAction);

document.addEventListener("keydown", e => {
  if (!isGifMode()) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    const tag = (document.activeElement && document.activeElement.tagName) || "";
    if (tag === "TEXTAREA" || tag === "INPUT") return; // dejar el undo nativo del campo
    e.preventDefault();
    if (e.shiftKey) redoLastGifAction();
    else undoLastGifAction();
  }
});

/* ---------- Render de anotaciones sobre canvas (exportación) ---------- */

function gifShapePath(ctx, shape, x, y, w, h) {
  ctx.beginPath();
  if (shape === "ellipse") {
    ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
  } else if (shape === "round") {
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, Math.min(12, Math.abs(w / 2), Math.abs(h / 2)));
    else ctx.rect(x, y, w, h);
  } else {
    ctx.rect(x, y, w, h);
  }
}

function drawGifAnnosToCtx(ctx, W, H, annos, imgMap) {
  for (let i = 0; i < (annos || []).length; i++) {
    const a = annos[i];
    const x = a.x * W, y = a.y * H;
    const w = (a.w || 0) * W, h = (a.h || 0) * H;
    if (a.type === "highlight") {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = a.color;
      gifShapePath(ctx, a.shape, x, y, w, h);
      ctx.fill();
      ctx.restore();
    } else if (a.type === "redact") {
      ctx.fillStyle = a.color;
      gifShapePath(ctx, a.shape, x, y, w, h);
      ctx.fill();
    } else if (a.type === "free") {
      ctx.save();
      ctx.strokeStyle = a.color;
      ctx.lineWidth = Math.max(1, a.strokeWidth * W);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let j = 0; j < a.points.length; j++) {
        if (j) ctx.lineTo(a.points[j].x * W, a.points[j].y * H);
        else ctx.moveTo(a.points[j].x * W, a.points[j].y * H);
      }
      ctx.stroke();
      ctx.restore();
    } else if (a.type === "text") {
      ctx.save();
      ctx.fillStyle = a.color;
      const fs = Math.max(4, a.fontSize * H);
      ctx.font = fs + "px " + (a.fontCss || "sans-serif");
      ctx.textBaseline = "top";
      const lines = (a.text || "").split("\n");
      const lh = fs * 1.25;
      for (let j = 0; j < lines.length; j++) ctx.fillText(lines[j], x, y + j * lh);
      ctx.restore();
    } else if (a.type === "image") {
      const imgC = imgMap && imgMap.get(a.imgData);
      if (imgC) ctx.drawImage(imgC, x, y, w, h);
    }
  }
}

/* decodifica cada imagen/annos a un canvas (para exportar sin asincronía por frame) */
const gifImgCanvasCache = new Map();
function gifImageCanvasFor(dataUrl) {
  if (gifImgCanvasCache.has(dataUrl)) return Promise.resolve(gifImgCanvasCache.get(dataUrl));
  const img = new Image();
  return new Promise((resolve, reject) => {
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d").drawImage(img, 0, 0);
      gifImgCanvasCache.set(dataUrl, c);
      resolve(c);
    };
    img.onerror = () => reject(new Error("imagen no soportada"));
    img.src = dataUrl;
  });
}

async function gifPreloadFrameImages(annos) {
  for (const a of annos || []) {
    if (a.type === "image") await gifImageCanvasFor(a.imgData);
  }
}

/* ---------- Exportación ---------- */

function gifDownload(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function gifBaseName() {
  return (gifState.fileName || "gif").replace(/\.gif$/i, "") || "gif";
}

$("#gifExportPngBtn").addEventListener("click", async () => {
  if (!gifState.frames.length) return;
  gifPause();
  const W = gifState.width, H = gifState.height;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.putImageData(gifFrameImageData(gifState.current), 0, 0);
  await gifPreloadFrameImages(gifState.annos[gifState.current]);
  drawGifAnnosToCtx(ctx, W, H, gifState.annos[gifState.current], gifImgCanvasCache);
  c.toBlob(b => {
    if (!b) { toast("No se pudo generar el PNG"); return; }
    gifDownload(b, gifBaseName() + "-frame-" + (gifState.current + 1) + ".png");
    toast("Frame " + (gifState.current + 1) + " exportado como PNG");
  }, "image/png");
});

$("#gifExportGifBtn").addEventListener("click", async () => {
  if (!gifState.frames.length) return;
  const wasPlaying = gifState.playing;
  gifPause();
  try {
    const W = gifState.width, H = gifState.height;
    const framesData = [];
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    for (let i = 0; i < gifState.frames.length; i++) {
      statusEl.textContent = "GIF · exportando frame " + (i + 1) + "/" + gifState.frames.length + "…";
      await gifPreloadFrameImages(gifState.annos[i]);
      ctx.putImageData(gifFrameImageData(i), 0, 0);
      drawGifAnnosToCtx(ctx, W, H, gifState.annos[i], gifImgCanvasCache);
      const q = gifQuantize(ctx.getImageData(0, 0, W, H).data, 256);
      framesData.push({
        indices: q.indices, palette: q.palette, transparentIndex: q.transparentIndex,
        delayCs: Math.round(gifState.frames[i].delayMs / 10)
      });
      if (i % 2 === 1) await new Promise(r => setTimeout(r, 0)); // mantener la UI viva
    }
    statusEl.textContent = "GIF · generando archivo…";
    await new Promise(r => setTimeout(r, 0));
    const bytes = buildGifFile(W, H, framesData, gifState.loopCount);
    gifDownload(new Blob([bytes], { type: "image/gif" }), gifBaseName() + "-editado.gif");
    statusEl.textContent = "GIF · " + gifState.frames.length + " frames · " + W + "×" + H;
    toast("GIF exportado con las ediciones");
    if (wasPlaying) gifPlay();
  } catch (err) {
    statusEl.textContent = "GIF · error al exportar";
    toast("Error al exportar: " + err.message);
  }
});

/* ---------- Barra de herramientas ---------- */

document.querySelectorAll("#gifTools .pdftool").forEach(btn => {
  btn.addEventListener("click", () => {
    gifState.tool = btn.dataset.giftool;
    document.querySelectorAll("#gifTools .pdftool").forEach(b => b.classList.toggle("active", b === btn));
    if (gifUi && gifUi.wrap) gifUi.wrap.dataset.tool = gifState.tool;
    if (gifState.tool === "image") $("#gifImgFile").click();
  });
});

function setGifColor(v) {
  gifState.color = v;
  $("#gifColorDot").style.background = v;
  $("#gifColor").value = v;
  $("#gifColorHex").value = v;
}

$("#gifColor").addEventListener("input", () => setGifColor($("#gifColor").value));
$("#gifColorHex").addEventListener("change", () => {
  let v = $("#gifColorHex").value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(v)) v = "#" + v.slice(1).split("").map(c => c + c).join("");
  if (/^#[0-9a-f]{6}$/.test(v)) setGifColor(v);
  else { toast("Hex inválido, usa #RRGGBB"); $("#gifColorHex").value = gifState.color; }
});
$("#gifShape").addEventListener("change", () => { gifState.shape = $("#gifShape").value; });
setGifColor("#ffe066");
