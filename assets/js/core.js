"use strict";

/* ================= Utilidades ================= */
const $ = sel => document.querySelector(sel);
const viewer = $("#viewer");
let inputEl = null; // textarea del documento activo (se asigna al crear/editar docs)
const statusEl = $("#status");
const MASK = "***";

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), 1800);
}

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext !== false) {
    navigator.clipboard.writeText(text).then(() => toast("Copiado al portapapeles ✔"))
      .catch(() => fallbackCopy(text));
  } else fallbackCopy(text);
}
function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); toast("Copiado al portapapeles ✔"); }
  catch (e) { toast("No se pudo copiar"); }
  document.body.removeChild(ta);
}

/* ================= Modos (datos | md | pdf | office | gif) ================= */
let appMode = "data"; // "data" (JSON/CSV) | "md" | "pdf" | "office" | "gif"

function setMode(mode) {
  appMode = mode;
  document.body.classList.toggle("md-mode", mode === "md");
  document.body.classList.toggle("pdf-mode", mode === "pdf");
  document.body.classList.toggle("office-mode", mode === "office");
  document.body.classList.toggle("gif-mode", mode === "gif");
  $("#formatSelect").classList.toggle("active-mode", mode === "data");
  $("#mdModeBtn").classList.toggle("active-mode", mode === "md");
  $("#pdfModeBtn").classList.toggle("active-mode", mode === "pdf");
  $("#officeModeBtn").classList.toggle("active-mode", mode === "office");
  $("#gifModeBtn").classList.toggle("active-mode", mode === "gif");
  $("#mdExportPdfBtn").hidden = mode !== "md";
  // notificar a cada módulo
  if (typeof onModeChange === "function") onModeChange(mode);
}

/* ================= Tipo de letra del contenido (editores/visores, no la UI) ================= */
$("#fontSelect").addEventListener("change", () => {
  const font = $("#fontSelect").value;
  document.documentElement.style.setProperty("--content-font", font);
  try { localStorage.setItem("updata-font", font); } catch (e) { }
});
(function () {
  let savedFont = null;
  try { savedFont = localStorage.getItem("updata-font"); } catch (e) { }
  if (savedFont) {
    document.documentElement.style.setProperty("--content-font", savedFont);
    const opt = [...$("#fontSelect").options].find(o => o.value === savedFont);
    if (opt) opt.selected = true;
  }
})();

/* ================= Tema ================= */
const themeBtn = $("#themeToggle");
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  themeBtn.textContent = t === "dark" ? "☀️ Light" : "🌙 Dark";
  try { localStorage.setItem("updata-theme", t); } catch (e) { }
}
themeBtn.addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(cur);
});
(function () {
  let saved = null;
  try { saved = localStorage.getItem("updata-theme"); } catch (e) { }
  if (!saved) saved = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  applyTheme(saved);
})();

/* ================= Zoom del visor ================= */
let appZoom = 1.0;

function setZoom(factor) {
  appZoom = Math.max(0.25, Math.min(5, factor));
  const pct = Math.round(appZoom * 100);
  $("#zoomLevel").textContent = pct + "%";
  applyViewerZoom();
}

function zoomIn() { setZoom(appZoom * 1.25); }
function zoomOut() { setZoom(appZoom * 0.8); }

function applyViewerZoom() {
  if (isGifMode()) {
    if (gifState.frames.length) renderGifViewer();
    return;
  }
  if (isPdfMode()) {
    if (pdfState.pages.length) {
      // preservar la página visible: el re-render borra el scroll del visor
      const anchor = captureViewerAnchor(".pdf-page-wrap[data-page-id]");
      Promise.resolve(renderPdfViewer()).then(() => restoreViewerAnchor(anchor));
      // refuerzo: en cuanto la página ancla exista en el DOM, restaura el scroll
      // (el render es secuencial y puede tardar; así el salto es mínimo)
      restoreViewerAnchorWhenReady(anchor, 600);
    }
    return;
  }
  // fallback: vistas sin wrapper (manual de bienvenida, errores) → primer hijo del visor
  const wrap = $("#viewerContent") || viewer.firstElementChild;
  if (wrap) {
    wrap.style.zoom = appZoom;
  }
}

/* ---------- anclaje de scroll del visor (para re-renders que lo reinician) ---------- */
/* Captura la página más visible y la fracción de scroll dentro de ella. */
function captureViewerAnchor(selector) {
  const viewerRect = viewer.getBoundingClientRect();
  let best = null, bestVisible = -1;
  for (const el of viewer.querySelectorAll(selector)) {
    const r = el.getBoundingClientRect();
    const visible = Math.max(0, Math.min(r.bottom, viewerRect.bottom) - Math.max(r.top, viewerRect.top));
    if (visible > bestVisible) { bestVisible = visible; best = el; }
  }
  if (!best) return null;
  const r = best.getBoundingClientRect();
  return { id: best.dataset.pageId, ratio: (viewerRect.top - r.top) / (r.height || 1) };
}

/* Restaura el scroll anclado a la página capturada (tras el re-render). */
function restoreViewerAnchor(anchor) {
  if (!anchor || !anchor.id) return;
  const el = viewer.querySelector('[data-page-id="' + anchor.id + '"]');
  if (!el) return;
  const viewerRect = viewer.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const top = r.top - viewerRect.top + viewer.scrollTop;
  viewer.scrollTop = top + anchor.ratio * (r.height || 1);
}

/* Reintenta la restauración hasta que la página ancla exista en el DOM
   (el render es secuencial; así el scroll se recupera lo antes posible). */
function restoreViewerAnchorWhenReady(anchor, tries) {
  if (!anchor || !anchor.id) return;
  if (viewer.querySelector('[data-page-id="' + anchor.id + '"]')) {
    restoreViewerAnchor(anchor);
    return;
  }
  if (tries > 0) requestAnimationFrame(() => restoreViewerAnchorWhenReady(anchor, tries - 1));
}

/* ================= Paneo (arrastrar para mover cuando hay overflow) ================= */
(function () {
  let dragging = false;
  let startX = 0, startY = 0, startSL = 0, startST = 0;
  let moved = false;

  viewer.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    // .pdf-anno-layer / .gif-anno-layer: cuando hay una herramienta activa la capa
    // gestiona su propio arrastre (dibujar zona, resaltar, etc.); el paneo debe
    // ignorarla o la página se desplazaría mientras se selecciona la zona.
    // [contenteditable] / .office-grid-wrap: el documento Word y la cuadrícula de
    // Excel gestionan su propio arrastre (selección de texto / de celdas); si el
    // paneo los interceptara, la página se movería y bloquearía la edición.
    if (e.target.closest("input,textarea,button,select,[contenteditable],.code-view,.office-grid-wrap,canvas,svg,path,rect,line,circle,text,br,.pdf-anno-layer,.gif-anno-layer")) return;
    dragging = true;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    startSL = viewer.scrollLeft;
    startST = viewer.scrollTop;
    viewer.classList.add("panning");
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
    viewer.scrollLeft = startSL - dx;
    viewer.scrollTop = startST - dy;
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    viewer.classList.remove("panning");
    if (moved) {
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      viewer.addEventListener("click", swallow, { capture: true, once: true });
    }
  });

  const updateCursor = () => {
    if (viewer.scrollWidth > viewer.clientWidth || viewer.scrollHeight > viewer.clientHeight) {
      viewer.style.cursor = "grab";
    } else {
      viewer.style.cursor = "";
    }
  };
  new MutationObserver(updateCursor).observe(viewer, { childList: true, subtree: true });
  window.addEventListener("resize", updateCursor);
  setInterval(updateCursor, 250);
})();

$("#zoomIn").addEventListener("click", zoomIn);
$("#zoomOut").addEventListener("click", zoomOut);
$("#zoomLevel").addEventListener("click", () => setZoom(1));

/* ================= Documentos múltiples (Datos y Markdown) ================= */
/* Cada documento es una tarjeta con su propio textarea. En modo Datos se
   apilan los documentos de dataDocs; en modo Markdown, los de mdDocs.
   El visor muestra todos los documentos apilados. */
let dataDocs = [];  // { id, name, ta, fileName }
let mdDocs = [];    // { id, name, ta, fileName }
let docSeq = 0;
let lastFocusedTa = null;

function setActiveTa(ta) {
  lastFocusedTa = ta;
  inputEl = ta;
}

function docsList(mode) { return mode === "md" ? mdDocs : dataDocs; }
function docsBox(mode) { return mode === "md" ? $("#mdDocsBox") : $("#dataDocsBox"); }

function activeTa() {
  const list = docsList(appMode);
  // Solo devuelve un textarea del modo actual (evita editar un documento oculto)
  if (lastFocusedTa && lastFocusedTa.isConnected && list.some(d => d.ta === lastFocusedTa)) {
    return lastFocusedTa;
  }
  return list.length ? list[list.length - 1].ta : inputEl;
}

function refreshDocTitles(list) {
  list.forEach((d, i) => {
    d.name = d.fileName ? d.fileName : "Documento " + (i + 1);
    const card = d.ta.closest(".doc-card");
    if (card) {
      const t = card.querySelector(".doc-title");
      if (t) t.textContent = d.name;
    }
  });
}

/* ---- Contador de líneas (contexto en Datos) ---- */
function docLineCount(ta) {
  if (!ta) return 0;
  return ta.value === "" ? 0 : ta.value.split("\n").length;
}
function lineLabel(n) {
  return n + (n === 1 ? " línea" : " líneas");
}
function docViewTitleText(doc) {
  const fmt = (doc.fmt || "AUTO").toUpperCase();
  return doc.name + " · " + fmt + " · " + lineLabel(docLineCount(doc.ta));
}
function refreshDocLineCount(doc) {
  if (!doc || !doc.ta) return;
  const n = docLineCount(doc.ta);
  // etiqueta en la tarjeta de entrada
  const card = doc.ta.closest(".doc-card");
  const badge = card && card.querySelector(".doc-lines");
  if (badge) badge.textContent = lineLabel(n);
  // título de la sección apilada en el visor
  if (typeof viewer !== "undefined" && doc.fmt) {
    const title = viewer.querySelector('.doc-view-title[data-doc="' + doc.id + '"]');
    if (title) title.textContent = docViewTitleText(doc);
  }
}

/* ---- Gutter de números de línea (como un editor de código) ---- */
function setGutterLines(gutter, count) {
  count = Math.max(1, count);
  const nums = [];
  for (let i = 1; i <= count; i++) nums.push(i);
  gutter.textContent = nums.join("\n");
}

function syncDocGutter(doc) {
  if (!doc || !doc.ta) return;
  const editor = doc.ta.closest(".doc-editor");
  if (!editor) return;
  const gutter = editor.querySelector(".doc-gutter");
  if (!gutter) return;
  setGutterLines(gutter, docLineCount(doc.ta));
  gutter.scrollTop = doc.ta.scrollTop;
}

function buildDocCard(doc, mode) {
  const card = document.createElement("div");
  card.className = "doc-card";
  const head = document.createElement("div");
  head.className = "doc-head";
  const title = document.createElement("span");
  title.className = "doc-title";
  title.textContent = doc.name;
  head.appendChild(title);
  const fmt = document.createElement("span");
  fmt.className = "doc-format";
  fmt.textContent = mode === "md" ? "MD" : (doc.format || "AUTO");
  head.appendChild(fmt);
  // número de líneas (contexto) solo en la entrada de Datos
  if (mode === "data") {
    const lines = document.createElement("span");
    lines.className = "doc-lines";
    lines.textContent = lineLabel(docLineCount(doc.ta));
    head.appendChild(lines);
  }
  const del = document.createElement("button");
  del.className = "doc-del";
  del.title = "Eliminar documento";
  del.innerHTML = "✕";
  del.addEventListener("click", () => removeDoc(doc, mode));
  head.appendChild(del);
  card.appendChild(head);
  if (mode === "data") {
    // editor con gutter de números de línea (como un editor de código)
    const editor = document.createElement("div");
    editor.className = "doc-editor";
    const gutter = document.createElement("div");
    gutter.className = "doc-gutter";
    gutter.setAttribute("aria-hidden", "true");
    editor.appendChild(gutter);
    editor.appendChild(doc.ta);
    card.appendChild(editor);
  } else {
    card.appendChild(doc.ta);
  }
  return card;
}

function newDocTa(mode) {
  const ta = document.createElement("textarea");
  ta.className = "doc-ta";
  ta.spellcheck = false;
  if (mode === "md") {
    ta.placeholder = "Escribe aquí tu Markdown...\n\n# Título\nTexto con **negrita** y *cursiva*.\n\n- Elemento de lista\n\nUsa la barra de botones de arriba si no conoces la sintaxis.";
  } else {
    ta.placeholder = 'Pega aquí tu JSON o CSV...';
  }
  return ta;
}

function attachTaListeners(doc, mode) {
  const ta = doc.ta;
  ta.addEventListener("focus", () => setActiveTa(ta));
  ta.addEventListener("input", () => {
    if (mode === "md" && appMode === "md") renderMarkdownPreview();
    if (mode === "data") { refreshDocLineCount(doc); syncDocGutter(doc); }
  });
  if (mode === "data") ta.addEventListener("scroll", () => syncDocGutter(doc));
  ta.addEventListener("keydown", (e) => {
    if (mode === "data" && (e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      $("#formatBtn").click();
    } else if (mode === "md" && (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      try { document.execCommand("redo"); } catch (err) { }
      renderMarkdownPreview();
    }
  });
}

function updateFormatBadges() {
  const global = $("#formatSelect").value;
  dataDocs.forEach((d) => {
    const card = d.ta.closest(".doc-card");
    const badge = card && card.querySelector(".doc-format");
    if (badge) {
      badge.textContent = d.fmt ? d.fmt.toUpperCase()
        : (global === "auto" ? "AUTO" : global.toUpperCase());
    }
  });
}

function addDoc(mode, text) {
  const list = docsList(mode);
  const box = docsBox(mode);
  const ta = newDocTa(mode);
  // el primer textarea de Datos conserva el id histórico "#input"
  if (mode === "data" && list.length === 0) ta.id = "input";
  if (!inputEl) inputEl = ta;
  const doc = { id: ++docSeq, name: "Documento " + (list.length + 1), ta };
  ta.value = text || "";
  attachTaListeners(doc, mode);
  box.appendChild(buildDocCard(doc, mode));
  list.push(doc);
  refreshDocTitles(list);
  if (mode === "data") { refreshDocLineCount(doc); syncDocGutter(doc); }
  setActiveTa(ta);
  return doc;
}

function removeDoc(doc, mode) {
  const list = docsList(mode);
  const idx = list.indexOf(doc);
  if (idx === -1) return;
  list.splice(idx, 1);
  const card = doc.ta.closest(".doc-card");
  if (card) card.remove();
  if (list.length) {
    refreshDocTitles(list);
    if (lastFocusedTa === doc.ta) {
      const next = list[Math.min(idx, list.length - 1)];
      setActiveTa(next.ta);
      next.ta.focus();
    }
  } else {
    // se eliminó el último documento: limpiar la referencia activa
    lastFocusedTa = null;
    inputEl = null;
  }
  if (appMode === "md") renderMarkdownPreview();
  else if (appMode === "data") renderDataAll();
  toast("Documento eliminado");
}

function loadIntoDoc(mode, text, fileName) {
  const list = docsList(mode);
  let target = list.find(d => !d.ta.value.trim());
  if (!target) target = addDoc(mode, "");
  target.ta.value = text;
  target.fileName = fileName;
  refreshDocTitles(list);
  if (mode === "data") { refreshDocLineCount(target); syncDocGutter(target); }
  setActiveTa(target.ta);
  return target;
}

/* ================= Impresión (todos los modos) ================= */
/* Imprime lo que se ve en el visor: clona el contenido, copia los estilos de la
   app, convierte los canvas a <img> (no se imprimen bien) y llama a print(). */
function printViewer() {
  if (!viewer.innerHTML.trim()) { toast("No hay nada que imprimir"); return; }

  const printWindow = window.open("", "_blank", "width=900,height=700");
  if (!printWindow) { toast("Permite las ventanas emergentes para imprimir"); return; }

  // Estilos de la aplicación (hoja principal + tema actual)
  const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
    .map(el => el.outerHTML).join("\n");

  // Clonar el visor; los canvas se convierten en <img> con su dibujo actual
  const clone = viewer.cloneNode(true);
  clone.querySelectorAll("canvas").forEach(canvas => {
    try {
      const img = document.createElement("img");
      img.src = canvas.toDataURL("image/png");
      img.style.maxWidth = "100%";
      if (canvas.style.width) img.style.width = canvas.style.width;
      canvas.replaceWith(img);
    } catch (err) { /* canvas no exportable: se deja tal cual */ }
  });
  // Quitar elementos que no tienen sentido en papel
  clone.querySelectorAll(".office-cell-editor, .office-sel-overlay, .office-search-bar, .pdf-anno-layer, .gif-anno-layer")
    .forEach(el => el.remove());
  // Quitar resaltados de selección de celdas (solo estética interactiva)
  clone.querySelectorAll(".office-grid td.sel, .office-grid td.active").forEach(td => {
    td.style.background = "";
    td.style.outline = "";
  });

  printWindow.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Updata — Impresión</title>
${styles}
<style>
  body { margin: 0; padding: 12px; background: #fff; color: #111; }
  #viewer { overflow: visible !important; height: auto !important; }
  #viewerContent { zoom: 1 !important; }
  .office-grid-wrap { overflow: visible !important; height: auto !important; max-height: none !important; }
  .office-grid { border-collapse: collapse; }
  .office-grid td, .office-grid th { border: 1px solid #999; }
  .office-sheet-tabs { display: flex; gap: .3rem; margin-bottom: .5rem; }
  .office-sheet-tab { border: 1px solid #999; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
  .office-sheet-tab.active { background: #BFD732; }
  img, canvas { max-width: 100%; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>`);
  printWindow.document.write(clone.outerHTML);
  printWindow.document.write("</body></html>");
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => { printWindow.print(); }, 400);
}
