/* ================= Cambio de modo ================= */
function onModeChange(mode) {
  if (mode === "md") enterMdMode();
  else if (mode === "pdf") enterPdfMode();
  else if (mode === "office") enterOfficeMode();
  else if (mode === "gif") enterGifMode();
  if (mode === "data") {
    const hasContent = dataDocs.some(d => d.ta.value.trim());
    if (hasContent) renderDataAll();
    else showManualInViewer();
  }
  if (mode !== "pdf") {
    $("#pdfExportBtn").hidden = true;
    $("#pdfExportMdBtn").hidden = true;
  }
  if (mode !== "office") {
    $("#officeCopyBtn").hidden = true;
    $("#officeExportCsvBtn").hidden = true;
    $("#officeExportXlsxBtn").hidden = true;
    $("#officeExportMdBtn").hidden = true;
    $("#officeExportHtmlBtn").hidden = true;
    const ot = $("#officeTools");
    if (ot) ot.hidden = true;
  }
  if (mode !== "gif") {
    if (typeof stopGifPlayback === "function") stopGifPlayback();
    $("#gifExportPngBtn").hidden = true;
    $("#gifExportGifBtn").hidden = true;
  }
}

$("#mdModeBtn").addEventListener("click", () => {
  if (appMode === "md") return;
  setMode("md");
});
$("#pdfModeBtn").addEventListener("click", () => {
  if (appMode === "pdf") return;
  if (appMode === "md") leaveMdMode();
  setMode("pdf");
});
$("#officeModeBtn").addEventListener("click", () => {
  if (appMode === "office") return;
  if (appMode === "md") leaveMdMode();
  setMode("office");
});
$("#gifModeBtn").addEventListener("click", () => {
  if (appMode === "gif") return;
  if (appMode === "md") leaveMdMode();
  setMode("gif");
});
$("#formatSelect").addEventListener("change", () => {
  if (appMode !== "data") {
    if (appMode === "md") leaveMdMode();
    setMode("data");
  } else {
    updateFormatBadges();
    renderDataAll();
  }
});
$("#formatSelect").addEventListener("click", () => {
  if (appMode !== "data") {
    if (appMode === "md") leaveMdMode();
    setMode("data");
  }
});
// modo inicial: crea el primer documento de Datos vacío
addDoc("data", "");
setMode("data");

/* ================= Manual de bienvenida en el visor ================= */
function showManualInViewer() {
  viewer.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.id = "viewerContent";
  wrap.style.zoom = (typeof appZoom !== "undefined" ? appZoom : 1);
  const box = document.createElement("div");
  box.id = "mdPreview";
  box.className = "manual-view";
  box.innerHTML = renderMarkdown(typeof MANUAL_MD !== "undefined" ? MANUAL_MD : "# Updata\nPega un texto a la izquierda y pulsa Formatear.");
  wrap.appendChild(box);
  viewer.appendChild(wrap);
  statusEl.textContent = "MANUAL · carga un archivo o pega texto para empezar";
}
showManualInViewer();

/* ================= Controles globales ================= */
$("#formatBtn").addEventListener("click", () => {
  const hasText = dataDocs.some(d => d.ta.value.trim());
  if (!hasText) { toast("Pega primero algún texto"); return; }
  renderDataAll();
  toast("Documentos formateados");
});

$("#clearBtn").addEventListener("click", () => {
  const mode = appMode === "md" ? "md" : "data";
  const list = docsList(mode);
  // borrar todos los documentos (tarjetas) y limpiar la referencia activa
  list.forEach(d => { const c = d.ta.closest(".doc-card"); if (c) c.remove(); });
  list.length = 0;
  lastFocusedTa = null;
  inputEl = null;
  if (mode === "md") renderMarkdownPreview();
  else showManualInViewer();
  toast("Entrada limpiada");
});

/* ================= Añadir documento (Datos / Markdown) ================= */
$("#addDocBtn").addEventListener("click", () => {
  const mode = appMode === "md" ? "md" : "data";
  const doc = addDoc(mode, "");
  doc.ta.focus();
  if (appMode === "md") renderMarkdownPreview();
  else renderDataAll();
  toast("Documento añadido");
});

/* ================= Abrir archivo (.json, .csv, .md, .pdf, .gif, .java, .html, .py) ================= */
$("#openFileBtn").addEventListener("click", () => $("#openFileInput").click());
$("#openFileInput").addEventListener("change", () => {
  const f = $("#openFileInput").files[0];
  $("#openFileInput").value = "";
  if (f) openFiles([f]);
});

/* ---------- Carga genérica de archivos (usada por Abrir y por arrastrar y soltar) ---------- */
function isSupportedTextExt(ext) {
  return ["json", "csv", "md", "markdown", "txt", "java", "html", "htm", "py"].includes(ext);
}

function readTextFile(file, ext) {
  const reader = new FileReader();
  reader.onload = () => {
    // cambiar al modo correcto según la extensión y cargar en un documento
    if (ext === "md" || ext === "markdown") {
      if (appMode !== "md") setMode("md");
      loadIntoDoc("md", reader.result, file.name);
      renderMarkdownPreview();
    } else {
      if (appMode !== "data") {
        if (appMode === "md") leaveMdMode();
        setMode("data");
      }
      loadIntoDoc("data", reader.result, file.name);
      if (ext === "json") $("#formatSelect").value = "json";
      else if (ext === "csv") $("#formatSelect").value = "csv";
      else if (ext === "java") $("#formatSelect").value = "java";
      else if (ext === "html" || ext === "htm") $("#formatSelect").value = "html";
      else if (ext === "py") $("#formatSelect").value = "python";
      else $("#formatSelect").value = "auto";
      renderDataAll();
    }
    toast("Archivo abierto: " + file.name);
  };
  reader.onerror = () => toast("No se pudo leer el archivo");
  reader.readAsText(file, "utf-8");
}

function openFiles(fileArr) {
  Array.from(fileArr).forEach((f, i) => {
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    if (ext === "pdf") {
      if (appMode === "md") leaveMdMode();
      setMode("pdf");
      loadPdfFile(f, i > 0); // si ya hay páginas cargadas, se añaden al final
    } else if (ext === "docx" || ["xlsx", "xls", "xlsm", "xlsb"].includes(ext)) {
      if (appMode === "md") leaveMdMode();
      setMode("office");
      loadOfficeFile(f);
    } else if (ext === "gif") {
      if (appMode === "md") leaveMdMode();
      setMode("gif");
      loadGifFile(f);
    } else if (isSupportedTextExt(ext)) {
      readTextFile(f, ext);
    } else {
      toast("Formato no soportado: ." + ext);
    }
  });
}

/* ---------- Arrastrar y soltar un archivo en cualquier parte de la pantalla ---------- */
const globalDropOverlay = $("#globalDropOverlay");
const dropHasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");

document.addEventListener("dragenter", e => {
  if (!dropHasFiles(e)) return;
  e.preventDefault();
  globalDropOverlay.hidden = false;
});
document.addEventListener("dragover", e => {
  if (!dropHasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
});
document.addEventListener("dragleave", e => {
  // salió de la ventana → ocultar el aviso
  if (e.relatedTarget === null) globalDropOverlay.hidden = true;
});
document.addEventListener("drop", e => {
  if (!dropHasFiles(e)) return;
  e.preventDefault();
  globalDropOverlay.hidden = true;
  const files = e.dataTransfer.files;
  if (!files || !files.length) return;
  // Las zonas específicas de PDF/Office/GIF ya gestionan su propio drop
  if (e.target.closest && e.target.closest("#pdfDrop, #officeDrop, #gifDrop")) return;
  openFiles(files);
});

/* ================= Redimensionar paneles (arrastrar divisor, límite 30%–70%) ================= */
(function () {
  const splitter = $("#splitter");
  const mainEl = document.querySelector("main");
  let dragging = false;

  const clampPct = (e) => {
    const rect = mainEl.getBoundingClientRect();
    const cs = getComputedStyle(mainEl);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const start = rect.left + padL;
    const width = rect.width - padL - padR;
    const pct = (e.clientX - start) / width * 100;
    return Math.min(70, Math.max(30, pct));
  };

  splitter.addEventListener("mousedown", e => {
    e.preventDefault();
    dragging = true;
    document.body.classList.add("splitter-dragging");
  });
  window.addEventListener("mousemove", e => {
    if (!dragging) return;
    mainEl.style.setProperty("--input-w", clampPct(e) + "%");
  });
  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("splitter-dragging");
  });
  window.addEventListener("blur", () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("splitter-dragging");
  });
})();

$("#expandAll").addEventListener("click", () => {
  const tables = viewer.querySelectorAll("table.csv-table");
  if (tables.length) {
    tables.forEach(table => {
      // expandir todas las filas y restaurar columnas contraídas
      table.querySelectorAll("tbody tr").forEach(tr => tr.classList.add("r-expanded"));
      table.querySelectorAll(".c-collapsed").forEach(el => el.classList.remove("c-collapsed"));
      table.querySelectorAll(".tbtn-collapse.active").forEach(b => b.classList.remove("active"));
      table.querySelectorAll(".rbtn").forEach(b => { if (b.textContent === "⤢") b.textContent = "⤡"; });
    });
    return;
  }
  viewer.querySelectorAll(".node.collapsed").forEach(n => {
    n.querySelector(":scope > .row > .toggle").click();
  });
});
$("#collapseAll").addEventListener("click", () => {
  const tables = viewer.querySelectorAll("table.csv-table");
  if (tables.length) {
    tables.forEach(table => {
      // volver todo a la vista compacta
      table.querySelectorAll("tbody tr.r-expanded").forEach(tr => tr.classList.remove("r-expanded"));
      table.querySelectorAll(".c-expanded").forEach(el => el.classList.remove("c-expanded"));
      table.querySelectorAll("thead .tbtn.active").forEach(b => b.classList.remove("active"));
      table.querySelectorAll(".rbtn").forEach(b => { if (b.textContent === "⤡") b.textContent = "⤢"; });
    });
    return;
  }
  // colapsa de adentro hacia afuera, dejando la raíz abierta
  const nodes = [...viewer.querySelectorAll(".node")].reverse();
  nodes.forEach(n => {
    if (n.parentElement === viewer) return; // raíz visible
    const hasChildren = n.querySelector(":scope > .children");
    if (hasChildren && !n.classList.contains("collapsed")) {
      n.querySelector(":scope > .row > .toggle").click();
    }
  });
});
$("#unmaskAll").addEventListener("click", () => {
  maskAllIn(viewer, false);
  toast("Máscaras eliminadas");
});
$("#copyAll").addEventListener("click", () => {
  const out = serializeAll();
  if (!out) { toast("No hay nada que copiar"); return; }
  copyText(out);
});

// Imprimir lo que se ve en el visor (todos los modos)
$("#printBtn").addEventListener("click", printViewer);

// El atajo Ctrl+Enter para formatear se enlaza a cada textarea en attachTaListeners()
