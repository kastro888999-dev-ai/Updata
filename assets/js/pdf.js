/* ================= Modo PDF (lector + edición, 100% offline) ================= */
/* pdf.js (render + texto seleccionable) · pdf-lib (exportación con cambios) */

(function () {
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "assets/vendor/pdf.worker.min.js";
  }
})();

let pdfPageUid = 0;

const pdfState = {
  fileName: "documento.pdf",
  // documentos fuente cargados (el original + los anexados)
  // { bytes: Uint8Array, doc: pdf.js document }
  sources: [],
  // páginas en el orden actual del editor:
  // { id, srcDoc: índice en sources, srcIndex: página 0-based en su fuente,
  //   rotation: grados extra, deleted: bool,
  //   annos: [ { type, x,y,w,h (fracciones 0-1 de la página), color, text?, fontSize?, imgData? } ] }
  pages: [],
  tool: "select",
  color: "#ffe066",
  shape: "rect", // forma de "Quitar": rect | round | ellipse | free
  pendingImage: null // dataURL de imagen elegida para la herramienta imagen
};

function isPdfMode() { return appMode === "pdf"; }

function updatePdfExportButtons() {
  const show = isPdfMode() && pdfState.pages.length > 0;
  $("#pdfExportBtn").hidden = !show;
  $("#pdfExportMdBtn").hidden = !show;
}

function enterPdfMode() {
  $("#pdfTools").hidden = !pdfState.pages.length;
  updatePdfExportButtons();
  if (pdfState.pages.length) {
    renderPdfViewer();
  } else {
    viewer.innerHTML = '<div class="hint">Carga un PDF a la izquierda para verlo aquí.<br><br>' +
      '• Selecciona texto con el cursor y cópialo (Ctrl+C).<br>' +
      '• Herramientas: resaltar, subrayar, quitar zonas, escribir texto, insertar imágenes y copiar una zona como imagen.<br>' +
      '• Arrastra las miniaturas para <b>reordenar páginas</b>; ⟳ rota, ✕ elimina; ➕ añade otro PDF.<br>' +
      '• Exporta como <b>PDF</b> o <b>.md</b> tal como se ve en el visor.<br>' +
      '• Todo ocurre en tu equipo, sin conexión.</div>';
    statusEl.textContent = "PDF";
  }
}

/* ---------- Carga de archivos ---------- */
const pdfFileInput = $("#pdfFile");
const pdfDrop = $("#pdfDrop");

$("#pdfPickBtn").addEventListener("click", () => pdfFileInput.click());
pdfFileInput.addEventListener("change", () => {
  if (pdfFileInput.files[0]) loadPdfFile(pdfFileInput.files[0], false);
});

["dragover", "dragenter"].forEach(ev => pdfDrop.addEventListener(ev, e => {
  e.preventDefault();
  pdfDrop.classList.add("dragover");
}));
["dragleave", "drop"].forEach(ev => pdfDrop.addEventListener(ev, e => {
  e.preventDefault();
  pdfDrop.classList.remove("dragover");
}));
pdfDrop.addEventListener("drop", e => {
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f && f.type === "application/pdf") loadPdfFile(f, pdfState.pages.length > 0);
  else toast("Suelta un archivo .pdf");
});

$("#pdfAppendBtn").addEventListener("click", () => $("#pdfAppendFile").click());
$("#pdfAppendFile").addEventListener("change", () => {
  const f = $("#pdfAppendFile").files[0];
  if (f) loadPdfFile(f, true);
  $("#pdfAppendFile").value = "";
});

async function openPdfDocument(bytes, fileName) {
  // intenta abrir; si está protegido, pide la contraseña (hasta 3 intentos)
  let password;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const doc = await pdfjsLib.getDocument({ data: bytes.slice(), password }).promise;
      return { doc, password: password || null };
    } catch (err) {
      const isPwd = err && (err.name === "PasswordException" ||
        /password/i.test(err.message || ""));
      if (!isPwd) throw err;
      password = prompt(
        (attempt === 0
          ? '"' + fileName + '" está protegido con contraseña.\nIntroduce la contraseña para abrirlo:'
          : "Contraseña incorrecta. Inténtalo de nuevo:"));
      if (password === null) throw new Error("Apertura cancelada por el usuario");
    }
  }
  throw new Error("Contraseña incorrecta (3 intentos)");
}

async function loadPdfFile(file, append) {
  try {
    statusEl.textContent = "PDF · cargando…";
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const { doc, password } = await openPdfDocument(bytes, file.name);

    if (!append) {
      pdfState.sources = [];
      pdfState.pages = [];
      pdfState.fileName = file.name;
    }
    const srcDoc = pdfState.sources.length;
    pdfState.sources.push({ bytes, doc, password });
    if (password) toast("PDF protegido abierto: al exportar podrás quitar la contraseña");
    for (let i = 0; i < doc.numPages; i++) {
      pdfState.pages.push({ id: ++pdfPageUid, srcDoc, srcIndex: i, rotation: 0, deleted: false, annos: [] });
    }
    $("#pdfPagesBox").hidden = false;
    $("#pdfTools").hidden = false;
    updatePdfExportButtons();
    updatePdfInfo();
    await renderPdfThumbs();
    await renderPdfViewer();
    toast(append ? "PDF añadido: " + file.name : "PDF cargado: " + file.name);
  } catch (err) {
    toast("No se pudo leer el PDF");
    statusEl.textContent = "PDF · error";
    console.error(err);
  }
}

function updatePdfInfo() {
  const total = pdfState.pages.length;
  const active = pdfState.pages.filter(p => !p.deleted).length;
  $("#pdfInfo").textContent = pdfState.fileName + " · " + active + "/" + total + " páginas" +
    (pdfState.sources.length > 1 ? " · " + pdfState.sources.length + " archivos" : "");
}

function getPdfPage(pageInfo) {
  return pdfState.sources[pageInfo.srcDoc].doc.getPage(pageInfo.srcIndex + 1);
}

/* ---------- Miniaturas + reordenar / rotar / eliminar ---------- */
async function renderPdfThumbs() {
  const box = $("#pdfPages");
  box.innerHTML = "";
  for (let pos = 0; pos < pdfState.pages.length; pos++) {
    const pageInfo = pdfState.pages[pos];
    const item = document.createElement("div");
    item.className = "pdf-thumb" + (pageInfo.deleted ? " deleted" : "");
    item.draggable = true;
    item.dataset.pos = pos;

    const canvas = document.createElement("canvas");
    const page = await getPdfPage(pageInfo);
    const rotation = (page.rotate + pageInfo.rotation) % 360;
    const vp = page.getViewport({ scale: 1, rotation });
    const scale = 72 / vp.width;
    const v2 = page.getViewport({ scale, rotation });
    canvas.width = v2.width; canvas.height = v2.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: v2 }).promise;

    const meta = document.createElement("div");
    meta.className = "pt-meta";
    meta.innerHTML = '<div class="pt-num">Página ' + (pos + 1) + "</div>" +
      "<div>" + (pdfState.sources.length > 1 ? "doc " + (pageInfo.srcDoc + 1) + " · " : "") +
      "#" + (pageInfo.srcIndex + 1) +
      (pageInfo.rotation ? " · ⟳" + pageInfo.rotation + "°" : "") +
      (pageInfo.annos.length ? " · ✎" + pageInfo.annos.length : "") + "</div>";

    const actions = document.createElement("div");
    actions.className = "pt-actions";
    const dupBtn = document.createElement("button");
    dupBtn.className = "mini";
    dupBtn.textContent = "⧉";
    dupBtn.title = "Duplicar página (copia debajo)";
    dupBtn.addEventListener("click", async e => {
      e.stopPropagation();
      const copy = {
        id: ++pdfPageUid,
        srcDoc: pageInfo.srcDoc,
        srcIndex: pageInfo.srcIndex,
        rotation: pageInfo.rotation,
        deleted: false,
        annos: pageInfo.annos.map(a => Object.assign({}, a, { seq: ++annoSeq }))
      };
      pdfState.pages.splice(pos + 1, 0, copy);
      updatePdfInfo();
      await renderPdfThumbs();
      await renderPdfViewer();
      toast("Página duplicada");
    });
    const rotBtn = document.createElement("button");
    rotBtn.className = "mini";
    rotBtn.textContent = "⟳";
    rotBtn.title = "Rotar 90°";
    rotBtn.addEventListener("click", async e => {
      e.stopPropagation();
      pageInfo.rotation = (pageInfo.rotation + 90) % 360;
      await renderPdfThumbs();
      await renderPdfViewer();
    });
    const delBtn = document.createElement("button");
    delBtn.className = "mini";
    delBtn.textContent = pageInfo.deleted ? "↩" : "✕";
    delBtn.title = pageInfo.deleted ? "Restaurar página" : "Eliminar página (doble clic: quitar de la lista)";
    delBtn.addEventListener("click", async e => {
      e.stopPropagation();
      pageInfo.deleted = !pageInfo.deleted;
      updatePdfInfo();
      await renderPdfThumbs();
      await renderPdfViewer();
    });
    // quitar definitivamente de la lista con doble clic
    delBtn.addEventListener("dblclick", async e => {
      e.stopPropagation();
      pdfState.pages.splice(pos, 1);
      updatePdfInfo();
      await renderPdfThumbs();
      await renderPdfViewer();
      toast("Página quitada de la lista");
    });
    actions.appendChild(dupBtn);
    actions.appendChild(rotBtn);
    actions.appendChild(delBtn);

    item.appendChild(canvas);
    item.appendChild(meta);
    item.appendChild(actions);

    // clic en la miniatura → ir a esa página en el visor
    item.addEventListener("click", () => {
      if (pageInfo.deleted) { toast("La página está eliminada: restáurala con ↩"); return; }
      const target = viewer.querySelector('.pdf-page-wrap[data-page-id="' + pageInfo.id + '"]');
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        target.classList.add("page-flash");
        setTimeout(() => target.classList.remove("page-flash"), 1200);
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
    item.addEventListener("drop", async e => {
      e.preventDefault();
      e.stopPropagation();
      item.classList.remove("dragover-thumb");
      const from = parseInt(e.dataTransfer.getData("text/plain"), 10);
      const to = parseInt(item.dataset.pos, 10);
      if (isNaN(from) || from === to) return;
      const [moved] = pdfState.pages.splice(from, 1);
      pdfState.pages.splice(to, 0, moved);
      await renderPdfThumbs();
      await renderPdfViewer();
    });

    box.appendChild(item);
  }
}

/* ---------- Herramientas ---------- */
document.querySelectorAll("#pdfTools .pdftool").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#pdfTools .pdftool").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    pdfState.tool = btn.dataset.tool;
    document.querySelectorAll(".pdf-page-wrap").forEach(w => w.dataset.tool = pdfState.tool);
    if (pdfState.tool === "image") {
      $("#pdfImgFile").click();
    }
  });
});

/* ---------- Color: paleta nativa + hex + gotero ---------- */
function setPdfColor(hex) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
  pdfState.color = hex;
  $("#pdfColor").value = hex;
  $("#pdfColorHex").value = hex;
  $("#pdfColorDot").style.background = hex;
}

$("#pdfColor").addEventListener("input", () => setPdfColor($("#pdfColor").value));
$("#pdfColorHex").addEventListener("change", () => {
  let v = $("#pdfColorHex").value.trim();
  if (!v.startsWith("#")) v = "#" + v;
  if (/^#[0-9a-fA-F]{3}$/.test(v)) v = "#" + [...v.slice(1)].map(c => c + c).join("");
  if (/^#[0-9a-fA-F]{6}$/.test(v)) setPdfColor(v.toLowerCase());
  else { toast("Hex inválido, usa #RRGGBB"); $("#pdfColorHex").value = pdfState.color; }
});

$("#pdfShape").addEventListener("change", () => { pdfState.shape = $("#pdfShape").value; });

$("#pdfImgFile").addEventListener("change", () => {
  const f = $("#pdfImgFile").files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    pdfState.pendingImage = reader.result;
    toast("Imagen lista: arrastra en la página dónde colocarla");
  };
  reader.readAsDataURL(f);
  $("#pdfImgFile").value = "";
});

/* ---------- Historial de acciones (deshacer/rehacer) ----------
   Cada acción: { type: "add"|"delete"|"edit", page, anno, index?, before?, after? } */
const pdfHistory = [];
const pdfRedoStack = [];

function snapshotAnno(a) { return JSON.parse(JSON.stringify(a)); }

function applySnapshot(anno, snap) {
  Object.keys(anno).forEach(k => delete anno[k]);
  Object.assign(anno, JSON.parse(JSON.stringify(snap)));
}

function recordAction(action) {
  pdfHistory.push(action);
  pdfRedoStack.length = 0; // una acción nueva invalida los rehacer
}

async function refreshPdfViews() {
  await renderPdfViewer();
  await renderPdfThumbs();
}

async function undoLastPdfAnnotation() {
  const act = pdfHistory.pop();
  if (!act || !pdfState.pages.includes(act.page)) { toast("No hay nada que deshacer"); return; }
  if (act.type === "add") {
    const i = act.page.annos.indexOf(act.anno);
    if (i >= 0) act.page.annos.splice(i, 1);
  } else if (act.type === "delete") {
    act.page.annos.splice(Math.min(act.index, act.page.annos.length), 0, act.anno);
  } else if (act.type === "edit") {
    applySnapshot(act.anno, act.before);
  }
  pdfRedoStack.push(act);
  await refreshPdfViews();
  toast("Deshecho");
}

async function redoLastPdfAnnotation() {
  const act = pdfRedoStack.pop();
  if (!act || !pdfState.pages.includes(act.page)) { toast("No hay nada que rehacer"); return; }
  if (act.type === "add") {
    act.page.annos.push(act.anno);
  } else if (act.type === "delete") {
    const i = act.page.annos.indexOf(act.anno);
    if (i >= 0) act.page.annos.splice(i, 1);
  } else if (act.type === "edit") {
    applySnapshot(act.anno, act.after);
  }
  pdfHistory.push(act);
  await refreshPdfViews();
  toast("Rehecho");
}

$("#pdfUndoBtn").addEventListener("click", undoLastPdfAnnotation);

// Ctrl+Z / Ctrl+Shift+Z global en modo PDF (fuera de campos de texto)
document.addEventListener("keydown", e => {
  if (!isPdfMode()) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    const tag = (document.activeElement && document.activeElement.tagName) || "";
    if (tag === "TEXTAREA" || tag === "INPUT") return; // dejar el undo nativo del campo
    e.preventDefault();
    if (e.shiftKey) redoLastPdfAnnotation();
    else undoLastPdfAnnotation();
  }
});

let annoSeq = 0;

// re-render de las páginas al redimensionar la ventana (responsive)
let pdfResizeTimer = null;
window.addEventListener("resize", () => {
  if (!isPdfMode() || !pdfState.pages.length) return;
  clearTimeout(pdfResizeTimer);
  pdfResizeTimer = setTimeout(() => renderPdfViewer(), 350);
});

/* ---------- Visor: canvas + textLayer + overlay ---------- */
async function renderPdfViewer() {
  viewer.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.id = "viewerContent";
  wrap.style.zoom = "1";
  const box = document.createElement("div");
  box.id = "pdfViewerPages";
  wrap.appendChild(box);
  viewer.appendChild(wrap);

  const visible = pdfState.pages.filter(p => !p.deleted);
  statusEl.textContent = "PDF · " + visible.length + " páginas";
  let shown = 0;
  for (const pageInfo of pdfState.pages) {
    if (pageInfo.deleted) continue;
    shown++;
    const label = document.createElement("div");
    label.className = "pdf-page-label";
    label.textContent = "Página " + shown + " de " + visible.length;
    box.appendChild(label);
    box.appendChild(await buildPdfPageView(pageInfo));
  }
  if (!shown) {
    box.innerHTML = '<div class="hint">Todas las páginas están eliminadas. Restaura alguna con ↩.</div>';
  }
}

async function buildPdfPageView(pageInfo) {
  const wrap = document.createElement("div");
  wrap.className = "pdf-page-wrap";
  wrap.dataset.tool = pdfState.tool;
  wrap.dataset.pageId = pageInfo.id;

  const page = await getPdfPage(pageInfo);
  const rotation = (page.rotate + pageInfo.rotation) % 360;
  const base = page.getViewport({ scale: 1, rotation });
  // ancho base adaptado al panel (mínimo razonable para legibilidad, máx. 1000)
  // y luego el zoom del visor multiplica sin tope (como en el modo GIF)
  const baseW = Math.max(Math.min((viewer.clientWidth || 800) - 40, 1000), 280);
  const maxW = baseW * appZoom;
  const scale = maxW / base.width;
  const vp = page.getViewport({ scale, rotation });

  const canvas = document.createElement("canvas");
  canvas.className = "pdf-render";
  canvas.width = vp.width;
  canvas.height = vp.height;
  wrap.style.width = vp.width + "px";
  wrap.style.height = vp.height + "px";
  wrap.appendChild(canvas);
  await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;

  // ---- capa de texto seleccionable ----
  const textLayer = document.createElement("div");
  textLayer.className = "pdf-text-layer";
  wrap.appendChild(textLayer);
  try {
    const tc = await page.getTextContent();
    for (const item of tc.items) {
      if (!item.str) continue;
      const tx = pdfjsLib.Util.transform(vp.transform, item.transform);
      const fontH = Math.hypot(tx[2], tx[3]);
      const span = document.createElement("span");
      span.textContent = item.str;
      const angle = Math.atan2(tx[1], tx[0]);
      span.style.left = tx[4] + "px";
      span.style.top = (tx[5] - fontH) + "px";
      span.style.fontSize = fontH + "px";
      span.style.fontFamily = "sans-serif";
      if (angle) span.style.transform = "rotate(" + angle + "rad)";
      // ajustar ancho horizontal aprox.
      if (item.width) span.style.letterSpacing = "0px";
      textLayer.appendChild(span);
    }
  } catch (e) { /* página sin texto */ }

  // ---- overlay de anotaciones ----
  const annoLayer = document.createElement("div");
  annoLayer.className = "pdf-anno-layer";
  wrap.appendChild(annoLayer);
  drawAnnos(annoLayer, pageInfo, vp.width, vp.height);
  attachAnnoEvents(annoLayer, wrap, pageInfo);

  return wrap;
}

function drawAnnos(layer, pageInfo, W, H) {
  layer.querySelectorAll(".anno").forEach(a => a.remove());
  for (const a of pageInfo.annos) {
    const el = document.createElement("div");
    el.className = "anno anno-" + a.type;
    el.style.left = (a.x * W) + "px";
    el.style.top = (a.y * H) + "px";
    el.style.width = (a.w * W) + "px";
    el.style.height = (a.h * H) + "px";
    if (a.type === "underline") el.style.borderBottomColor = a.color;
    if (a.type === "highlight" || a.type === "redact") {
      el.style.background = a.color;
      if (a.shape === "round") el.style.borderRadius = "12px";
      if (a.shape === "ellipse") el.style.borderRadius = "50%";
    }
    if (a.type === "free") {
      // trazo de mano alzada como SVG a página completa
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
      if (a.translucent) path.setAttribute("stroke-opacity", "0.45");
      path.setAttribute("d", "M " + a.points.map(p => (p.x * W) + " " + (p.y * H)).join(" L "));
      svg.appendChild(path);
      layer.appendChild(svg);
      continue;
    }
    if (a.type === "text") {
      el.textContent = a.text;
      el.style.color = a.color;
      el.style.fontSize = (a.fontSize * H) + "px";
      el.style.height = "auto";
      el.style.fontFamily = pdfFontCss(a.font || "arial");
      const needsBox = (a.align && a.align !== "left") || (a.columns && a.columns > 1);
      if (needsBox) {
        el.style.width = ((a.w || (1 - a.x)) * W) + "px";
        el.style.textAlign = a.align || "left";
      } else {
        el.style.width = "auto";
        el.style.maxWidth = ((1 - a.x) * W) + "px";
      }
      if (a.columns && a.columns > 1) {
        el.style.columnCount = a.columns;
        el.style.columnGap = "1em";
      }
      if (a.bold) el.style.fontWeight = "700";
      if (a.italic) el.style.fontStyle = "italic";
      if (a.underline) el.style.textDecoration = "underline";
      makeTextEditable(el, a, layer, pageInfo, W, H);
    }
    if (a.type === "image") {
      const img = document.createElement("img");
      img.src = a.imgData;
      el.appendChild(img);
      makeImageEditable(el, a, layer, pageInfo, W, H);
    }
    layer.appendChild(el);
  }
}

/* ---------- Texto: mover, editar (doble clic o ✎), eliminar ---------- */
function makeTextEditable(el, anno, layer, pageInfo, W, H) {
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
    const wrap = layer.closest(".pdf-page-wrap");
    el.style.display = "none"; // ocultar mientras se edita
    openTextInput(layer, wrap, pageInfo, anno.x * W, anno.y * H, anno);
  };

  editHandle.addEventListener("mousedown", e => { e.preventDefault(); e.stopPropagation(); });
  editHandle.addEventListener("click", e => {
    e.stopPropagation();
    openEditor();
  });

  el.classList.add("anno-text-interactive");

  const deselectAll = () => {
    layer.querySelectorAll(".selected").forEach(i => i.classList.remove("selected"));
  };

  // mover con arrastre (herramienta Seleccionar o cualquier otra)
  el.addEventListener("mousedown", e => {
    if (e.target === delHandle || e.target === editHandle) return;
    e.preventDefault();
    e.stopPropagation();
    deselectAll();
    el.classList.add("selected");
    const startMX = e.clientX, startMY = e.clientY;
    const origX = anno.x, origY = anno.y;
    const before = snapshotAnno(anno);
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
      if (moved) {
        recordAction({ type: "edit", page: pageInfo, anno, before, after: snapshotAnno(anno) });
        renderPdfThumbs();
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  // doble clic → reabrir el editor con este texto
  el.addEventListener("dblclick", e => {
    e.preventDefault();
    e.stopPropagation();
    openEditor();
  });

  delHandle.addEventListener("click", e => {
    e.stopPropagation();
    const idx = pageInfo.annos.indexOf(anno);
    if (idx >= 0) {
      pageInfo.annos.splice(idx, 1);
      recordAction({ type: "delete", page: pageInfo, anno, index: idx });
    }
    drawAnnos(layer, pageInfo, W, H);
    renderPdfThumbs();
    toast("Texto eliminado");
  });
}

/* ---------- Imagen: mover, redimensionar, eliminar ---------- */
function makeImageEditable(el, anno, layer, pageInfo, W, H) {
  // tirador de redimensión
  const handle = document.createElement("div");
  handle.className = "resize-handle";
  el.appendChild(handle);
  // botón de eliminar
  const delHandle = document.createElement("div");
  delHandle.className = "delete-handle";
  delHandle.textContent = "✕";
  delHandle.title = "Eliminar imagen";
  el.appendChild(delHandle);

  const deselectAll = () => {
    layer.querySelectorAll(".anno-image.selected").forEach(i => i.classList.remove("selected"));
  };

  el.addEventListener("mousedown", e => {
    if (e.target === handle || e.target === delHandle) return;
    e.preventDefault();
    e.stopPropagation();
    deselectAll();
    el.classList.add("selected");
    // mover
    const startMX = e.clientX, startMY = e.clientY;
    const origX = anno.x, origY = anno.y;
    const before = snapshotAnno(anno);
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
      if (moved) recordAction({ type: "edit", page: pageInfo, anno, before, after: snapshotAnno(anno) });
      renderPdfThumbs();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  handle.addEventListener("mousedown", e => {
    e.preventDefault();
    e.stopPropagation();
    const startMX = e.clientX, startMY = e.clientY;
    const origW = anno.w, origH = anno.h;
    const before = snapshotAnno(anno);
    let resized = false;
    const ratio = origW / origH; // proporción en fracciones de página
    const onMove = ev => {
      resized = true;
      let newW = Math.max(origW + (ev.clientX - startMX) / W, 0.02);
      let newH = Math.max(origH + (ev.clientY - startMY) / H, 0.02);
      // redimensión libre (dinámica); con Shift mantiene la proporción original
      if (ev.shiftKey) newH = newW / ratio;
      anno.w = Math.min(newW, 1 - anno.x);
      anno.h = Math.min(newH, 1 - anno.y);
      el.style.width = (anno.w * W) + "px";
      el.style.height = (anno.h * H) + "px";
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (resized) recordAction({ type: "edit", page: pageInfo, anno, before, after: snapshotAnno(anno) });
      renderPdfThumbs();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  delHandle.addEventListener("click", e => {
    e.stopPropagation();
    const idx = pageInfo.annos.indexOf(anno);
    if (idx >= 0) {
      pageInfo.annos.splice(idx, 1);
      recordAction({ type: "delete", page: pageInfo, anno, index: idx });
    }
    drawAnnos(layer, pageInfo, W, H);
    renderPdfThumbs();
    toast("Imagen eliminada");
  });
}

function attachAnnoEvents(layer, wrap, pageInfo) {
  let startX = 0, startY = 0, rubber = null, dragging = false;

  let freePath = null; // puntos de mano alzada [{x,y}...] en px

  layer.addEventListener("mousedown", e => {
    const rect = layer.getBoundingClientRect();
    // clic fuera de una imagen: deseleccionar
    if (!e.target.closest(".anno-image")) {
      layer.querySelectorAll(".anno-image.selected").forEach(i => i.classList.remove("selected"));
    }
    const tool = pdfState.tool;
    if (tool === "select") return;
    if (e.target.closest(".anno-image")) return; // dejar mover la imagen
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;

    if (tool === "text") {
      openTextInput(layer, wrap, pageInfo, startX, startY);
      return;
    }
    dragging = true;
    const usesShapes = tool === "redact" || tool === "highlight";
    if (usesShapes && pdfState.shape === "free") {
      // mano alzada: trazo SVG en vivo
      freePath = [{ x: startX, y: startY }];
      rubber = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      rubber.setAttribute("class", "anno free-rubber");
      rubber.style.position = "absolute";
      rubber.style.inset = "0";
      rubber.style.width = "100%";
      rubber.style.height = "100%";
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", pdfState.color);
      path.setAttribute("stroke-width", "14");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      if (tool === "highlight") path.setAttribute("stroke-opacity", "0.45");
      rubber.appendChild(path);
      layer.appendChild(rubber);
    } else {
      rubber = document.createElement("div");
      rubber.className = "anno anno-rubber";
      if (usesShapes) {
        if (pdfState.shape === "round") rubber.style.borderRadius = "12px";
        if (pdfState.shape === "ellipse") rubber.style.borderRadius = "50%";
      }
      rubber.style.left = startX + "px";
      rubber.style.top = startY + "px";
      layer.appendChild(rubber);
    }
    e.preventDefault();
  });

  layer.addEventListener("mousemove", e => {
    if (!dragging || !rubber) return;
    const rect = layer.getBoundingClientRect();
    const curX = e.clientX - rect.left;
    const curY = e.clientY - rect.top;
    if (freePath) {
      freePath.push({ x: curX, y: curY });
      rubber.querySelector("path").setAttribute("d",
        "M " + freePath.map(p => p.x + " " + p.y).join(" L "));
      return;
    }
    rubber.style.left = Math.min(startX, curX) + "px";
    rubber.style.top = Math.min(startY, curY) + "px";
    rubber.style.width = Math.abs(curX - startX) + "px";
    rubber.style.height = Math.abs(curY - startY) + "px";
  });

  layer.addEventListener("mouseup", async e => {
    if (!dragging || !rubber) return;
    dragging = false;
    const rect = layer.getBoundingClientRect();
    const curX = e.clientX - rect.left;
    const curY = e.clientY - rect.top;
    rubber.remove();
    rubber = null;
    const W = rect.width, H = rect.height;
    const tool = pdfState.tool;

    const addAnno = anno => {
      pageInfo.annos.push(anno);
      recordAction({ type: "add", page: pageInfo, anno });
    };

    // mano alzada: guardar el trazo completo (pintar u resaltar)
    if (freePath) {
      const pts = freePath;
      freePath = null;
      if (pts.length > 2) {
        addAnno({
          seq: ++annoSeq, type: "free",
          points: pts.map(p => ({ x: p.x / W, y: p.y / H })),
          strokeWidth: 14 / W,
          color: pdfState.color,
          translucent: tool === "highlight",
          x: 0, y: 0, w: 0, h: 0
        });
        drawAnnos(layer, pageInfo, W, H);
        renderPdfThumbs();
      }
      return;
    }

    const x = Math.min(startX, curX), y = Math.min(startY, curY);
    const w = Math.abs(curX - startX), h = Math.abs(curY - startY);
    if (w < 4 || h < 4) return;

    if (tool === "snapshot") {
      copyZoneAsImage(wrap, x, y, w, h);
      return;
    }
    if (tool === "image") {
      if (!pdfState.pendingImage) { toast("Primero elige una imagen (botón 🖼 Imagen)"); return; }
      addAnno({ seq: ++annoSeq, type: "image", x: x / W, y: y / H, w: w / W, h: h / H, imgData: pdfState.pendingImage });
    } else if (tool === "redact" || tool === "highlight") {
      addAnno({
        seq: ++annoSeq, type: tool, x: x / W, y: y / H, w: w / W, h: h / H,
        color: pdfState.color, shape: pdfState.shape
      });
    } else if (tool === "underline") {
      addAnno({ seq: ++annoSeq, type: "underline", x: x / W, y: (y + h) / H - 0.004, w: w / W, h: 0.004, color: pdfState.color });
    }
    drawAnnos(layer, pageInfo, W, H);
    renderPdfThumbs();
  });
}

/* estado de formato de texto para la herramienta 🅣 */
const pdfTextFormat = { bold: false, italic: false, underline: false, size: 16, align: "left", font: "arial", columns: 1, color: null };

/* css: cómo se ve en pantalla · pdf: familia estándar al exportar (sans|serif|mono) */
const PDF_TEXT_FONTS = {
  arial: { label: "Arial", css: "Arial, Helvetica, sans-serif", pdf: "sans" },
  verdana: { label: "Verdana", css: "Verdana, Geneva, sans-serif", pdf: "sans" },
  trebuchet: { label: "Trebuchet", css: "'Trebuchet MS', sans-serif", pdf: "sans" },
  segoe: { label: "Segoe UI", css: "'Segoe UI', system-ui, sans-serif", pdf: "sans" },
  tahoma: { label: "Tahoma", css: "Tahoma, Geneva, sans-serif", pdf: "sans" },
  georgia: { label: "Georgia", css: "Georgia, serif", pdf: "serif" },
  times: { label: "Times New Roman", css: "'Times New Roman', Times, serif", pdf: "serif" },
  garamond: { label: "Garamond", css: "Garamond, 'EB Garamond', serif", pdf: "serif" },
  palatino: { label: "Palatino", css: "'Palatino Linotype', Palatino, serif", pdf: "serif" },
  courier: { label: "Courier New", css: "'Courier New', Courier, monospace", pdf: "mono" },
  consolas: { label: "Consolas", css: "Consolas, Monaco, monospace", pdf: "mono" },
  comic: { label: "Comic Sans", css: "'Comic Sans MS', cursive", pdf: "sans" },
  impact: { label: "Impact", css: "Impact, 'Arial Black', sans-serif", pdf: "sans" },
  // compatibilidad con anotaciones antiguas
  sans: { label: "Sans", css: "Arial, Helvetica, sans-serif", pdf: "sans" },
  serif: { label: "Serif", css: "Georgia, 'Times New Roman', serif", pdf: "serif" },
  mono: { label: "Mono", css: "Consolas, 'Courier New', monospace", pdf: "mono" }
};

function pdfFontCss(key) {
  return (PDF_TEXT_FONTS[key] || PDF_TEXT_FONTS.arial).css;
}

/* editAnno: si se pasa, se edita esa anotación existente en lugar de crear una nueva */
function openTextInput(layer, wrap, pageInfo, x, y, editAnno) {
  const existing = wrap.querySelector(".anno-text-input");
  if (existing) { existing.blur(); return; }
  const rect = layer.getBoundingClientRect();

  // si editamos, precargar el formato de la anotación
  if (editAnno) {
    pdfTextFormat.bold = !!editAnno.bold;
    pdfTextFormat.italic = !!editAnno.italic;
    pdfTextFormat.underline = !!editAnno.underline;
    pdfTextFormat.align = editAnno.align || "left";
    pdfTextFormat.size = Math.round(editAnno.fontSize * rect.height) || 16;
    pdfTextFormat.font = editAnno.font || "arial";
    pdfTextFormat.columns = editAnno.columns || 1;
    pdfTextFormat.color = editAnno.color || null;
  }

  // contenedor del editor + barra de formato
  const holder = document.createElement("div");
  holder.className = "anno-text-holder";
  holder.style.left = x + "px";
  holder.style.top = y + "px";

  // ---- barra de formato ----
  const bar = document.createElement("div");
  bar.className = "text-format-bar";
  const mkToggle = (label, key, css) => {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = label;
    b.className = "tfb" + (pdfTextFormat[key] ? " active" : "");
    b.title = key;
    b.addEventListener("mousedown", e => e.preventDefault()); // no robar el foco
    b.addEventListener("click", () => {
      pdfTextFormat[key] = !pdfTextFormat[key];
      b.classList.toggle("active", pdfTextFormat[key]);
      applyStyle();
      input.focus();
    });
    return b;
  };
  const boldBtn = mkToggle("<b>B</b>", "bold");
  const italicBtn = mkToggle("<i>I</i>", "italic");
  const underBtn = mkToggle("<u>U</u>", "underline");

  const sizeSel = document.createElement("select");
  sizeSel.className = "tfb-size";
  [10, 12, 14, 16, 18, 22, 26, 32, 40, 52].forEach(s => {
    const o = document.createElement("option");
    o.value = s; o.textContent = s + "px";
    if (s === pdfTextFormat.size) o.selected = true;
    sizeSel.appendChild(o);
  });
  sizeSel.addEventListener("mousedown", e => e.stopPropagation());
  sizeSel.addEventListener("change", () => {
    pdfTextFormat.size = parseInt(sizeSel.value, 10);
    applyStyle();
    input.focus();
  });

  const alignSel = document.createElement("select");
  alignSel.className = "tfb-size";
  [["left", "⇤ Izquierda"], ["center", "↔ Centrado"], ["right", "⇥ Derecha"], ["justify", "☰ Justificado"]].forEach(([v, t]) => {
    const o = document.createElement("option");
    o.value = v; o.textContent = t;
    if (v === pdfTextFormat.align) o.selected = true;
    alignSel.appendChild(o);
  });
  alignSel.addEventListener("mousedown", e => e.stopPropagation());
  alignSel.addEventListener("change", () => {
    pdfTextFormat.align = alignSel.value;
    applyStyle();
    input.focus();
  });

  const fontSel = document.createElement("select");
  fontSel.className = "tfb-size";
  Object.entries(PDF_TEXT_FONTS).forEach(([key, def]) => {
    if (key === "sans" || key === "serif" || key === "mono") return; // alias internos
    const o = document.createElement("option");
    o.value = key; o.textContent = def.label;
    o.style.fontFamily = def.css;
    if (key === pdfTextFormat.font) o.selected = true;
    fontSel.appendChild(o);
  });
  fontSel.title = "Fuente del texto";
  fontSel.addEventListener("mousedown", e => e.stopPropagation());
  fontSel.addEventListener("change", () => {
    pdfTextFormat.font = fontSel.value;
    applyStyle();
    input.focus();
  });

  // color del texto (independiente del color de las herramientas de dibujo)
  const colorInp = document.createElement("input");
  colorInp.type = "color";
  colorInp.className = "tfb-color";
  colorInp.title = "Color del texto";
  colorInp.value = pdfTextFormat.color ||
    (pdfState.color === "#ffe066" ? "#000000" : pdfState.color);
  colorInp.addEventListener("mousedown", e => e.stopPropagation());
  colorInp.addEventListener("input", () => {
    pdfTextFormat.color = colorInp.value;
    applyStyle();
  });
  colorInp.addEventListener("change", () => input.focus());

  const colSel = document.createElement("select");
  colSel.className = "tfb-size";
  [[1, "1 col"], [2, "2 col"], [3, "3 col"]].forEach(([v, t]) => {
    const o = document.createElement("option");
    o.value = v; o.textContent = t;
    if (v === pdfTextFormat.columns) o.selected = true;
    colSel.appendChild(o);
  });
  colSel.title = "Columnas del texto";
  colSel.addEventListener("mousedown", e => e.stopPropagation());
  colSel.addEventListener("change", () => {
    pdfTextFormat.columns = parseInt(colSel.value, 10);
    applyStyle();
    input.focus();
  });

  const listBtn = document.createElement("button");
  listBtn.type = "button";
  listBtn.className = "tfb";
  listBtn.textContent = "• Lista";
  listBtn.title = "Convertir líneas en lista con viñetas";
  listBtn.addEventListener("mousedown", e => e.preventDefault());
  listBtn.addEventListener("click", () => {
    input.value = input.value.split("\n").map(l =>
      l.trim().startsWith("•") ? l.replace(/^(\s*)•\s?/, "$1") : (l.trim() ? "• " + l : l)
    ).join("\n");
    input.focus();
  });

  const okBtn = document.createElement("button");
  okBtn.type = "button";
  okBtn.className = "tfb tfb-ok";
  okBtn.textContent = "✔";
  okBtn.title = "Confirmar (Ctrl+Enter)";
  okBtn.addEventListener("mousedown", e => e.preventDefault());
  okBtn.addEventListener("click", () => input.blur());

  bar.appendChild(boldBtn); bar.appendChild(italicBtn); bar.appendChild(underBtn);
  bar.appendChild(sizeSel); bar.appendChild(alignSel); bar.appendChild(fontSel);
  bar.appendChild(colorInp); bar.appendChild(colSel); bar.appendChild(listBtn); bar.appendChild(okBtn);

  // ---- textarea ----
  const input = document.createElement("textarea");
  input.className = "anno-text-input";
  input.rows = 2;
  input.placeholder = "Escribe aquí…";
  if (editAnno) input.value = editAnno.text;

  const applyStyle = () => {
    input.style.fontSize = pdfTextFormat.size + "px";
    input.style.fontWeight = pdfTextFormat.bold ? "700" : "400";
    input.style.fontStyle = pdfTextFormat.italic ? "italic" : "normal";
    input.style.textDecoration = pdfTextFormat.underline ? "underline" : "none";
    input.style.textAlign = pdfTextFormat.align;
    input.style.fontFamily = pdfFontCss(pdfTextFormat.font);
    input.style.color = pdfTextFormat.color ||
      (pdfState.color === "#ffe066" ? "#000000" : pdfState.color);
  };
  applyStyle();

  holder.appendChild(bar);
  holder.appendChild(input);
  wrap.appendChild(holder);
  setTimeout(() => input.focus(), 0);

  const commit = () => {
    const text = input.value.replace(/\s+$/, "");
    const W = rect.width, H = rect.height;
    const annoLayer = wrap.querySelector(".pdf-anno-layer");
    if (text.trim()) {
      const props = {
        text,
        fontSize: pdfTextFormat.size / H,
        bold: pdfTextFormat.bold,
        italic: pdfTextFormat.italic,
        underline: pdfTextFormat.underline,
        align: pdfTextFormat.align,
        font: pdfTextFormat.font,
        columns: pdfTextFormat.columns,
        color: pdfTextFormat.color ||
          (pdfState.color === "#ffe066" ? "#000000" : pdfState.color)
      };
      if (editAnno) {
        const before = snapshotAnno(editAnno);
        Object.assign(editAnno, props);
        recordAction({ type: "edit", page: pageInfo, anno: editAnno, before, after: snapshotAnno(editAnno) });
      } else {
        const anno = Object.assign({
          seq: ++annoSeq, type: "text",
          x: x / W, y: y / H, w: Math.min(0.9, 1 - x / W), h: 0,
          color: pdfState.color === "#ffe066" ? "#000000" : pdfState.color
        }, props);
        pageInfo.annos.push(anno);
        recordAction({ type: "add", page: pageInfo, anno });
      }
      drawAnnos(annoLayer, pageInfo, W, H);
      renderPdfThumbs();
    } else if (editAnno) {
      // texto vacío al editar = eliminar la anotación
      const idx = pageInfo.annos.indexOf(editAnno);
      if (idx >= 0) {
        pageInfo.annos.splice(idx, 1);
        recordAction({ type: "delete", page: pageInfo, anno: editAnno, index: idx });
      }
      drawAnnos(annoLayer, pageInfo, W, H);
      renderPdfThumbs();
    }
    holder.remove();
  };
  input.addEventListener("blur", () => {
    // pequeña espera: si el foco pasó a la barra de formato, no confirmar aún
    setTimeout(() => {
      if (!holder.contains(document.activeElement)) commit();
    }, 120);
  });
  input.addEventListener("keydown", e => {
    if (e.key === "Escape") { input.value = ""; holder.remove(); }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) input.blur();
  });
}

/* ---------- Copiar zona como imagen ---------- */
function copyZoneAsImage(wrap, x, y, w, h) {
  const src = wrap.querySelector("canvas.pdf-render");
  const scaleX = src.width / wrap.clientWidth;
  const scaleY = src.height / wrap.clientHeight;
  const out = document.createElement("canvas");
  out.width = Math.round(w * scaleX);
  out.height = Math.round(h * scaleY);
  out.getContext("2d").drawImage(src,
    Math.round(x * scaleX), Math.round(y * scaleY), out.width, out.height,
    0, 0, out.width, out.height);
  out.toBlob(async blob => {
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        toast("Zona copiada como imagen ✔");
        return;
      }
      throw new Error("no clipboard");
    } catch (e) {
      // fallback: descargar el PNG
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "zona.png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast("El navegador no permite copiar imágenes: se descargó zona.png");
    }
  }, "image/png");
}

/* ---------- Exportar PDF (con anotaciones tal como se ven) ---------- */
function hexToRgb01(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

$("#pdfExportBtn").addEventListener("click", async () => {
  const keep = pdfState.pages.filter(p => !p.deleted);
  if (!keep.length) { toast("No quedan páginas para exportar"); return; }
  // si hay fuentes protegidas, ofrecer exportar sin contraseña
  const hasProtected = pdfState.sources.some(s => s.password);
  let stripPassword = false;
  if (hasProtected) {
    stripPassword = confirm(
      "El PDF original está protegido con contraseña.\n\n" +
      "Aceptar: exportar SIN contraseña (documento libre).\n" +
      "Cancelar: intentar mantener el archivo tal cual.");
  }

  try {
    statusEl.textContent = "PDF · exportando…";
    // cargar cada documento fuente en pdf-lib (una sola vez)
    const libDocs = [];
    for (const s of pdfState.sources) {
      try {
        libDocs.push(await PDFLib.PDFDocument.load(s.bytes, { ignoreEncryption: true }));
      } catch (e) {
        libDocs.push(null); // se rasterizará
      }
    }

    const outDoc = await PDFLib.PDFDocument.create();
    // mapear la fuente de contenido elegida a una familia estándar de PDF (con variantes)
    const contentFont = (getComputedStyle(document.documentElement).getPropertyValue("--content-font") || "").toLowerCase();
    const SF = PDFLib.StandardFonts;
    // familias disponibles por anotación (sans/serif/mono) con variantes
    const famDefs = {
      sans: [SF.Helvetica, SF.HelveticaBold, SF.HelveticaOblique, SF.HelveticaBoldOblique],
      serif: [SF.TimesRoman, SF.TimesRomanBold, SF.TimesRomanItalic, SF.TimesRomanBoldItalic],
      mono: [SF.Courier, SF.CourierBold, SF.CourierOblique, SF.CourierBoldOblique]
    };
    const fontCache = {};
    const getFont = async (fam, variant) => {
      const key = fam + ":" + variant;
      if (!fontCache[key]) fontCache[key] = await outDoc.embedFont(famDefs[fam][variant]);
      return fontCache[key];
    };
    // fuente por defecto según la fuente de contenido global
    let defaultFam = "sans";
    if (/courier|consolas|mono/.test(contentFont)) defaultFam = "mono";
    else if (/times|georgia|garamond|serif/.test(contentFont) && !/sans-serif/.test(contentFont.split(",")[0])) defaultFam = "serif";
    const pickFont = async a => {
      // resolver la fuente de la anotación a su familia PDF estándar (sans/serif/mono)
      let fam = defaultFam;
      if (a.font) {
        fam = (PDF_TEXT_FONTS[a.font] && PDF_TEXT_FONTS[a.font].pdf) || "sans";
      }
      const variant = a.bold && a.italic ? 3 : a.bold ? 1 : a.italic ? 2 : 0;
      return getFont(fam in famDefs ? fam : "sans", variant);
    };

    // rasterizar una página (fallback para cifrados que pdf-lib no puede copiar)
    const rasterizePage = async (pageInfo) => {
      const page = await getPdfPage(pageInfo);
      const rotation = (page.rotate + pageInfo.rotation) % 360;
      const vp = page.getViewport({ scale: 2, rotation });
      const c = document.createElement("canvas");
      c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      const png = await outDoc.embedPng(c.toDataURL("image/png"));
      const newPage = outDoc.addPage([vp.width / 2, vp.height / 2]);
      newPage.drawImage(png, { x: 0, y: 0, width: vp.width / 2, height: vp.height / 2 });
      return newPage;
    };

    for (const pageInfo of keep) {
      let copied = null;
      const lib = libDocs[pageInfo.srcDoc];
      const isProtected = !!pdfState.sources[pageInfo.srcDoc].password;
      if (lib && (!isProtected || stripPassword || !hasProtected)) {
        try {
          [copied] = await outDoc.copyPages(lib, [pageInfo.srcIndex]);
        } catch (e) {
          copied = null; // contenido cifrado no copiable → rasterizar
        }
      }
      if (copied) {
        if (pageInfo.rotation) {
          const current = copied.getRotation().angle || 0;
          copied.setRotation(PDFLib.degrees((current + pageInfo.rotation) % 360));
        }
        outDoc.addPage(copied);
      } else {
        // fallback: página como imagen de alta resolución (ya descifrada por el visor)
        copied = await rasterizePage(pageInfo);
        // la rotación ya viene aplicada en el raster; no rotar de nuevo
        pageInfo._rasterized = true;
      }

      // dibujar anotaciones (coordenadas relativas al viewport ya rotado, como en el visor)
      if (!pageInfo.annos.length) continue;
      const rotation = (copied.getRotation().angle || 0) % 360;
      const pw = copied.getWidth(), ph = copied.getHeight();
      // dimensiones "visuales" (como se ve en el visor)
      const visW = rotation % 180 === 0 ? pw : ph;
      const visH = rotation % 180 === 0 ? ph : pw;

      // convierte un punto visual (fracción, origen arriba-izquierda) a coords PDF (origen abajo-izquierda, sin rotar)
      const toPdf = (fx, fy) => {
        const vx = fx * visW, vy = fy * visH;
        switch (rotation) {
          case 90: return { x: vy, y: vx };
          case 180: return { x: pw - vx, y: vy };
          case 270: return { x: pw - vy, y: ph - vx };
          default: return { x: vx, y: ph - vy };
        }
      };

      for (const a of pageInfo.annos) {
        const color = a.color ? hexToRgb01(a.color) : { r: 0, g: 0, b: 0 };
        if (a.type === "free") {
          // trazo de mano alzada: línea segmento a segmento
          const sw = a.strokeWidth * visW;
          const op = a.translucent ? 0.45 : 1;
          for (let i = 1; i < a.points.length; i++) {
            const s = toPdf(a.points[i - 1].x, a.points[i - 1].y);
            const t = toPdf(a.points[i].x, a.points[i].y);
            copied.drawLine({
              start: { x: s.x, y: s.y }, end: { x: t.x, y: t.y },
              thickness: sw, color: PDFLib.rgb(color.r, color.g, color.b),
              opacity: op,
              lineCap: PDFLib.LineCapStyle.Round
            });
          }
        } else if ((a.type === "redact" || a.type === "highlight") && a.shape === "ellipse") {
          const p1 = toPdf(a.x, a.y), p2 = toPdf(a.x + a.w, a.y + a.h);
          copied.drawEllipse({
            x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2,
            xScale: Math.abs(p2.x - p1.x) / 2, yScale: Math.abs(p2.y - p1.y) / 2,
            color: PDFLib.rgb(color.r, color.g, color.b),
            opacity: a.type === "highlight" ? 0.45 : 1
          });
        } else if (a.type === "highlight" || a.type === "redact" || a.type === "underline") {
          // rectángulo definido por dos esquinas visuales
          const p1 = toPdf(a.x, a.y), p2 = toPdf(a.x + a.w, a.y + a.h);
          const rx = Math.min(p1.x, p2.x), ry = Math.min(p1.y, p2.y);
          const rw = Math.abs(p2.x - p1.x) || 1, rh = Math.abs(p2.y - p1.y) || 2;
          const op = a.type === "highlight" ? 0.45 : 1;
          const isRound = a.shape === "round" && a.type !== "underline";
          copied.drawRectangle({
            x: rx, y: ry, width: rw, height: rh,
            color: PDFLib.rgb(color.r, color.g, color.b),
            opacity: op,
            borderWidth: 0
          });
          if (isRound) {
            // simular esquinas redondeadas: elipses en las esquinas
            const rad = Math.min(12, rw / 2, rh / 2);
            [[rx + rad, ry + rad], [rx + rw - rad, ry + rad], [rx + rad, ry + rh - rad], [rx + rw - rad, ry + rh - rad]]
              .forEach(([cx, cy]) => copied.drawEllipse({
                x: cx, y: cy, xScale: rad, yScale: rad,
                color: PDFLib.rgb(color.r, color.g, color.b), opacity: op
              }));
          }
        } else if (a.type === "text") {
          const p = toPdf(a.x, a.y);
          const size = a.fontSize * visH;
          const annoFont = await pickFont(a);
          const boxW = (a.w || (1 - a.x)) * visW;
          const cols = a.columns || 1;
          const colGap = size; // ~1em
          const colW = (boxW - colGap * (cols - 1)) / cols;
          const allLines = a.text.split("\n");
          // repartir líneas en columnas de forma equilibrada (como CSS columns)
          const perCol = Math.ceil(allLines.length / cols);
          for (let c = 0; c < cols; c++) {
            const colLines = allLines.slice(c * perCol, (c + 1) * perCol);
            const colX = p.x + c * (colW + colGap);
            colLines.forEach((line, i) => {
              let lineX = colX;
              const lineW = annoFont.widthOfTextAtSize(line, size);
              if (a.align === "center") lineX = colX + (colW - lineW) / 2;
              else if (a.align === "right") lineX = colX + colW - lineW;
              const lineY = p.y - size * (i + 1) * 1.25 + size * 0.25;
              copied.drawText(line, {
                x: lineX, y: lineY,
                size, font: annoFont,
                color: PDFLib.rgb(color.r, color.g, color.b),
                rotate: PDFLib.degrees(rotation)
              });
              if (a.underline && line.trim()) {
                copied.drawLine({
                  start: { x: lineX, y: lineY - size * 0.12 },
                  end: { x: lineX + lineW, y: lineY - size * 0.12 },
                  thickness: Math.max(0.8, size * 0.06),
                  color: PDFLib.rgb(color.r, color.g, color.b)
                });
              }
            });
          }
        } else if (a.type === "image") {
          try {
            const isPng = a.imgData.startsWith("data:image/png");
            const img = isPng ? await outDoc.embedPng(a.imgData) : await outDoc.embedJpg(a.imgData);
            const p1 = toPdf(a.x, a.y), p2 = toPdf(a.x + a.w, a.y + a.h);
            copied.drawImage(img, {
              x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y),
              width: Math.abs(p2.x - p1.x), height: Math.abs(p2.y - p1.y),
              rotate: PDFLib.degrees(rotation)
            });
          } catch (e) { console.warn("imagen no soportada", e); }
        }
      }
    }

    const outBytes = await outDoc.save();
    const blob = new Blob([outBytes], { type: "application/pdf" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = pdfState.fileName.replace(/\.pdf$/i, "") + "-editado.pdf";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    statusEl.textContent = "PDF · exportado";
    toast(hasProtected && stripPassword ? "PDF exportado sin contraseña ✔" : "PDF exportado ✔");
  } catch (err) {
    toast("Error al exportar el PDF");
    statusEl.textContent = "PDF · error";
    console.error(err);
  }
});

/* ---------- Exportar como Markdown (texto visible, en el orden del visor) ---------- */
$("#pdfExportMdBtn").addEventListener("click", async () => {
  const keep = pdfState.pages.filter(p => !p.deleted);
  if (!keep.length) { toast("No quedan páginas para exportar"); return; }
  try {
    statusEl.textContent = "PDF · extrayendo texto…";
    const mdParts = ["# " + pdfState.fileName.replace(/\.pdf$/i, ""), ""];
    let num = 0;
    for (const pageInfo of keep) {
      num++;
      mdParts.push("## Página " + num, "");
      const page = await getPdfPage(pageInfo);
      const tc = await page.getTextContent();
      // agrupar items por línea (coordenada Y)
      const lines = [];
      let last = null;
      for (const item of tc.items) {
        if (!item.str || !item.str.trim()) continue;
        const y = Math.round(item.transform[5]);
        if (last && Math.abs(last.y - y) < 3) {
          last.text += (last.text.endsWith(" ") || item.str.startsWith(" ") ? "" : " ") + item.str;
        } else {
          last = { y, text: item.str };
          lines.push(last);
        }
      }
      if (lines.length) {
        lines.forEach(l => mdParts.push(l.text.trim()));
      } else {
        mdParts.push("*(página sin texto extraíble)*");
      }
      // texto añadido con la herramienta 🅣
      const added = pageInfo.annos.filter(a => a.type === "text");
      if (added.length) {
        mdParts.push("", "> **Notas añadidas:**");
        added.forEach(a => mdParts.push("> " + a.text.replace(/\n/g, " ")));
      }
      mdParts.push("");
    }
    const md = mdParts.join("\n");
    const blob = new Blob([md], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = pdfState.fileName.replace(/\.pdf$/i, "") + ".md";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    statusEl.textContent = "PDF · .md exportado";
    toast("Markdown exportado ✔");
  } catch (err) {
    toast("Error al exportar Markdown");
    statusEl.textContent = "PDF · error";
    console.error(err);
  }
});
