/* ================= Modo Office (lector + editor Word/Excel, 100% offline) ================= */
/* SheetJS (xlsx) para Excel · mammoth para Word (.docx) */
/* Principio: "se copia lo que se ve" — copiar/exportar refleja el estado actual del visor. */

const officeState = {
  fileName: "",
  kind: null,        // "excel" | "word"
  wb: null,          // workbook de SheetJS (solo excel)
  sheets: [],        // nombres de hojas (solo excel)
  activeSheet: 0,
  wordHtml: "",      // HTML de mammoth (solo word)
  wordText: "",      // texto plano original (solo word)
  // Selección / edición (excel)
  sel: null,         // {r1,c1,r2,c2} normalizada, o null
  selAnchor: null,   // {r,c} ancla para shift+click
  activeCell: null,  // {r,c} celda principal (barra de fórmulas)
  editing: null,     // {r,c,original} celda en edición directa
  filter: "",        // texto de búsqueda/filtro (Excel)
  undoStack: [],     // historial de celdas {key,before,after}
  // Word
  wordBox: null,     // elemento contenteditable del documento
  savedRange: null   // rango de selección guardado para insertar imágenes
};

// Límite de filas renderizadas por hoja para no congelar el navegador con hojas enormes
const OFFICE_MAX_ROWS = 5000;
const OFFICE_UNDO_MAX = 100;

function isOfficeMode() { return appMode === "office"; }

function updateOfficeExportButtons() {
  const show = isOfficeMode() && !!officeState.fileName;
  const isExcel = show && officeState.kind === "excel";
  const isWord = show && officeState.kind === "word";
  $("#officeCopyBtn").hidden = !show;
  $("#officeExportCsvBtn").hidden = !isExcel;
  $("#officeExportXlsxBtn").hidden = !isExcel;
  $("#officeExportMdBtn").hidden = !isWord;
  $("#officeExportHtmlBtn").hidden = !isWord;
  // Barra de herramientas del visor
  const tools = $("#officeTools");
  if (tools) tools.hidden = !show;
  // Partes específicas de Excel / Word dentro de la barra
  ["#officeCellRef", "#officeFormulaInput", "#officeUndoBtn", "#officeBoldBtn", "#officeItalicBtn",
   "#officeUnderlineBtn", "#officeFontSize", "#officeFontColor", "#officeFillColor",
   "#officeAlignH", "#officeAlignV"].forEach(s => {
    const el = $(s); if (el) el.style.display = isExcel ? "" : "none";
  });
  ["#officeWBoldBtn", "#officeWItalicBtn", "#officeWUnderlineBtn", "#officeWFontSize",
   "#officeWFontColor", "#officeWAlignLeft", "#officeWAlignCenter", "#officeWAlignRight",
   "#officeWAlignJustify", "#officeWColumns", "#officeImgBtn"].forEach(s => {
    const el = $(s); if (el) el.style.display = isWord ? "" : "none";
  });
}

function enterOfficeMode() {
  updateOfficeExportButtons();
  if (officeState.fileName) {
    renderOfficeViewer();
  } else {
    viewer.innerHTML =
      '<div class="hint">Carga un <b>Word</b> o <b>Excel</b> a la izquierda para verlo y editarlo aquí.<br><br>' +
      '• <b>Excel</b> (.xlsx, .xls, .xlsm, .xlsb): hojas con pestañas. Haz <b>doble clic</b> en una celda para editarla, ' +
      'escribe <b>=SUMA(A1:A5)</b> para fórmulas, y selecciona un rango (clic + arrastrar o Shift+clic) para copiarlo.<br>' +
      '• <b>Word</b> (.docx): documento editable; escribe sobre el texto e <b>inserta imágenes</b> (botón 🖼 o pegando).<br>' +
      '• Copia lo que se ve o exporta: <b>.xlsx</b> / <b>CSV</b> (Excel) y <b>.md</b> / <b>.html</b> (Word).<br>' +
      '• Todo ocurre en tu equipo, sin conexión.</div>';
    statusEl.textContent = "OFFICE";
  }
}

/* ---------- Carga de archivos ---------- */
const officeFileInput = $("#officeFile");
const officeDrop = $("#officeDrop");

$("#officePickBtn").addEventListener("click", () => officeFileInput.click());
officeFileInput.addEventListener("change", () => {
  if (officeFileInput.files[0]) loadOfficeFile(officeFileInput.files[0]);
  officeFileInput.value = "";
});

["dragover", "dragenter"].forEach(ev => officeDrop.addEventListener(ev, e => {
  e.preventDefault();
  officeDrop.classList.add("dragover");
}));
["dragleave", "drop"].forEach(ev => officeDrop.addEventListener(ev, e => {
  e.preventDefault();
  officeDrop.classList.remove("dragover");
}));
officeDrop.addEventListener("drop", e => {
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) loadOfficeFile(f);
  else toast("Suelta un archivo .docx o .xlsx");
});

/* Detecta el tipo de documento por extensión */
function officeKindFromName(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (ext === "docx") return "word";
  if (["xlsx", "xls", "xlsm", "xlsb"].includes(ext)) return "excel";
  if (ext === "doc") return "doc-legacy";
  return null;
}

async function loadOfficeFile(file) {
  const kind = officeKindFromName(file.name);
  if (!kind) { toast("Formato no soportado: ." + (file.name.split(".").pop() || "")); return; }
  if (kind === "doc-legacy") {
    toast("El .doc antiguo no se soporta: guarda el archivo como .docx y vuelve a intentarlo");
    return;
  }
  try {
    // Archivos grandes: avisar antes del parseo síncrono (bloquea la UI)
    if (file.size > 5 * 1024 * 1024) statusEl.textContent = "OFFICE · procesando archivo grande…";
    else statusEl.textContent = "OFFICE · cargando…";
    const buf = await file.arrayBuffer();

    // Fase 1: parseo. Si falla aquí, el archivo realmente no se pudo leer.
    if (kind === "excel") await loadExcel(buf, file.name);
    else await loadWord(buf, file.name);

    $("#officeInfoBox").hidden = false;
    updateOfficeInfo();
    updateOfficeExportButtons();

    // Fase 2: dibujo de la vista. Si falla, el archivo YA está cargado:
    // no decir "no se pudo leer"; avisar y reintentar el dibujo una vez.
    try {
      renderOfficeViewer();
    } catch (renderErr) {
      console.error(renderErr);
      toast("El archivo se cargó, pero la vista tardó en dibujarse. Reintentando…");
      setTimeout(() => {
        try { renderOfficeViewer(); toast("Vista lista: " + file.name); }
        catch (e2) { console.error(e2); toast("El archivo está cargado; usa el filtro para verlo por partes"); }
      }, 120);
    }
    if (officeState.kind) toast("Archivo cargado: " + file.name);
  } catch (err) {
    console.error(err);
    toast("No se pudo leer el archivo");
    statusEl.textContent = "OFFICE · error";
  }
}

function updateOfficeInfo() {
  if (officeState.kind === "excel") {
    $("#officeInfo").textContent = officeState.fileName + " · " + officeState.sheets.length +
      " hoja" + (officeState.sheets.length === 1 ? "" : "s");
  } else {
    $("#officeInfo").textContent = officeState.fileName + " · " +
      (officeState.wordBox ? officeState.wordBox.innerText.length : officeState.wordText.length) + " caracteres";
  }
}

/* ---------- Excel (SheetJS) ---------- */
async function loadExcel(buf, name) {
  const wb = XLSX.read(new Uint8Array(buf), { type: "array", cellDates: true });
  officeState.wb = wb;
  officeState.sheets = wb.SheetNames.slice();
  officeState.activeSheet = 0;
  officeState.kind = "excel";
  officeState.fileName = name;
  officeState.wordHtml = "";
  officeState.wordText = "";
  officeState.wordBox = null;
  officeState.sel = null;
  officeState.selAnchor = null;
  officeState.activeCell = null;
  officeState.editing = null;
  officeState.undoStack = [];
}

/* ---------- Word (mammoth) ---------- */
async function loadWord(buf, name) {
  const result = await mammoth.convertToHtml({ arrayBuffer: buf });
  officeState.wordHtml = result.value || "";
  const raw = await mammoth.extractRawText({ arrayBuffer: buf });
  officeState.wordText = raw.value || "";
  officeState.kind = "word";
  officeState.fileName = name;
  officeState.wb = null;
  officeState.sheets = [];
  officeState.activeSheet = 0;
  officeState.sel = null;
  officeState.selAnchor = null;
  officeState.activeCell = null;
  officeState.editing = null;
  officeState.undoStack = [];
  officeState.wordBox = null;
  officeState.savedRange = null;
  officeState.wordUndoStack = [];
}

/* ================= Evaluador de fórmulas (offline, sin librerías) ================= */
/* Soporta: =SUMA(A1:A5), =PROMEDIO, =MIN, =MAX, =CONTAR, =PRODUCTO, =SUM, =AVERAGE,
   =COUNT, =PRODUCT, =MIN, =MAX, operadores + - * / ^ % y paréntesis, referencias de
   celda (A1) y rangos (A1:B3). Las referencias se resuelven contra la hoja activa. */

const OFFICE_FUNCS = {
  suma: "sum", sum: "sum",
  promedio: "avg", average: "avg",
  min: "min",
  max: "max",
  contar: "count", count: "count",
  producto: "prod", product: "prod"
};

function officeSheet() {
  return officeState.wb ? officeState.wb.Sheets[officeState.sheets[officeState.activeSheet]] : null;
}

/* Valor numérico de una celda (para cálculos). Devuelve null si no es numérico. */
function officeCellValue(r, c) {
  const sheet = officeSheet();
  if (!sheet) return null;
  const cell = sheet[XLSX.utils.encode_cell({ r, c })];
  if (!cell || cell.v === undefined || cell.v === null) return null;
  if (typeof cell.v === "number") return cell.v;
  if (typeof cell.v === "boolean") return cell.v ? 1 : 0;
  const n = parseFloat(cell.v);
  return isNaN(n) ? null : n;
}

/* Evalúa el contenido de una celda: si es fórmula (=...) la calcula; si no, devuelve su valor. */
function officeCellDisplay(r, c) {
  const sheet = officeSheet();
  if (!sheet) return "";
  const cell = sheet[XLSX.utils.encode_cell({ r, c })];
  if (!cell || cell.v === undefined || cell.v === null) return "";
  if (cell.f) {
    try {
      const v = officeEvalFormula(cell.f);
      return v === null || v === undefined ? "" : String(v);
    } catch (e) {
      return "#ERROR";
    }
  }
  return cell.w !== undefined ? cell.w : String(cell.v);
}

/* Tokeniza y evalúa una fórmula (sin el "=" inicial). */
function officeEvalFormula(formula) {
  let src = String(formula).trim();
  if (src.startsWith("=")) src = src.slice(1);
  const sheet = officeSheet();
  const tokens = officeTokenize(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpr() {
    let left = parseTerm();
    while (peek() && (peek().t === "+" || peek().t === "-")) {
      const op = next().t;
      const right = parseTerm();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }
  function parseTerm() {
    let left = parseFactor();
    while (peek() && (peek().t === "*" || peek().t === "/")) {
      const op = next().t;
      const right = parseFactor();
      left = op === "*" ? left * right : left / right;
    }
    return left;
  }
  function parseFactor() {
    let base = parseUnary();
    if (peek() && peek().t === "^") { next(); base = Math.pow(base, parseFactor()); }
    return base;
  }
  function parseUnary() {
    if (peek() && peek().t === "-") { next(); return -parseUnary(); }
    if (peek() && peek().t === "+") { next(); return parseUnary(); }
    return parsePrimary();
  }
  function parsePrimary() {
    const tk = next();
    if (!tk) throw new Error("fin inesperado");
    if (tk.t === "num") return tk.v;
    if (tk.t === "(") {
      const v = parseExpr();
      if (peek() && peek().t === ")") next();
      return v;
    }
    if (tk.t === "func") {
      if (peek() && peek().t === "(") next();
      const args = [];
      if (!(peek() && peek().t === ")")) {
        args.push(parseArg());
        while (peek() && peek().t === ",") { next(); args.push(parseArg()); }
      }
      if (peek() && peek().t === ")") next();
      return officeApplyFunc(tk.name, args);
    }
    if (tk.t === "cell") return officeCellValue(tk.r, tk.c) || 0;
    if (tk.t === "range") {
      // Un rango fuera de función se suma (comportamiento razonable)
      return officeRangeValues(tk.r1, tk.c1, tk.r2, tk.c2).reduce((a, b) => a + b, 0);
    }
    throw new Error("token inesperado: " + tk.t);
  }
  function parseArg() {
    const tk = peek();
    if (tk && tk.t === "range") { next(); return { range: tk }; }
    return { value: parseExpr() };
  }

  const result = parseExpr();
  if (pos < tokens.length) throw new Error("resto sin evaluar");
  if (typeof result !== "number" || isNaN(result)) return null;
  // Redondeo para evitar 0.30000000000000004
  return Math.round(result * 1e10) / 1e10;
}

function officeApplyFunc(name, args) {
  const nums = [];
  for (const a of args) {
    if (a.range) {
      const vals = officeRangeValues(a.range.r1, a.range.c1, a.range.r2, a.range.c2);
      nums.push(...vals);
    } else if (typeof a.value === "number") {
      nums.push(a.value);
    }
  }
  switch (name) {
    case "sum": return nums.reduce((x, y) => x + y, 0);
    case "avg": return nums.length ? nums.reduce((x, y) => x + y, 0) / nums.length : 0;
    case "min": return nums.length ? Math.min(...nums) : 0;
    case "max": return nums.length ? Math.max(...nums) : 0;
    case "count": return nums.length;
    case "prod": return nums.reduce((x, y) => x * y, 1);
    default: throw new Error("función desconocida: " + name);
  }
}

/* Valores numéricos de un rango (filas r1..r2, columnas c1..c2). */
function officeRangeValues(r1, c1, r2, c2) {
  const out = [];
  for (let r = r1; r <= r2; r++)
    for (let c = c1; c <= c2; c++) {
      const v = officeCellValue(r, c);
      if (v !== null) out.push(v);
    }
  return out;
}

/* Tokenizador: números, funciones, celdas, rangos, operadores y paréntesis. */
function officeTokenize(src) {
  const tokens = [];
  let i = 0;
  const isDigit = ch => ch >= "0" && ch <= "9";
  const isAlpha = ch => (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\t") { i++; continue; }
    if (isDigit(ch) || (ch === "." && isDigit(src[i + 1]))) {
      let j = i; while (j < src.length && (isDigit(src[j]) || src[j] === ".")) j++;
      tokens.push({ t: "num", v: parseFloat(src.slice(i, j)) });
      i = j; continue;
    }
    if (isAlpha(ch)) {
      let j = i; while (j < src.length && isAlpha(src[j])) j++;
      const word = src.slice(i, j).toUpperCase();
      // ¿Función? (seguida de "(")
      let k = j; while (k < src.length && src[k] === " ") k++;
      if (OFFICE_FUNCS[word.toLowerCase()] && src[k] === "(") {
        tokens.push({ t: "func", name: OFFICE_FUNCS[word.toLowerCase()] });
        i = j; continue;
      }
      // ¿Referencia de celda o rango? (letras + dígitos, opcionalmente :letras+dígitos)
      const refMatch = src.slice(i).match(/^([A-Za-z]{1,3})(\d+)(?::([A-Za-z]{1,3})(\d+))?/);
      if (refMatch) {
        const c1 = XLSX.utils.decode_col(refMatch[1].toUpperCase());
        const r1 = parseInt(refMatch[2], 10) - 1;
        if (refMatch[3]) {
          const c2 = XLSX.utils.decode_col(refMatch[3].toUpperCase());
          const r2 = parseInt(refMatch[4], 10) - 1;
          tokens.push({ t: "range", r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) });
        } else {
          tokens.push({ t: "cell", r: r1, c: c1 });
        }
        i = i + refMatch[0].length; continue;
      }
      throw new Error("identificador no reconocido: " + word);
    }
    if ("+-*/^(),%".includes(ch)) { tokens.push({ t: ch }); i++; continue; }
    throw new Error("carácter no reconocido: " + ch);
  }
  return tokens;
}

/* ---------- Render del visor ---------- */
function renderOfficeViewer() {
  // Preservar scroll (vertical y horizontal) del visor y de la cuadrícula:
  // el re-render tras cada edición no debe devolver la vista al inicio.
  const prevScroll = { top: viewer.scrollTop, left: viewer.scrollLeft };
  const prevGrid = viewer.querySelector(".office-grid-wrap");
  const prevGridScroll = prevGrid ? { top: prevGrid.scrollTop, left: prevGrid.scrollLeft } : null;
  viewer.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.id = "viewerContent";
  wrap.style.zoom = (typeof appZoom !== "undefined" ? appZoom : 1);
  viewer.appendChild(wrap);

  if (officeState.kind === "excel") {
    wrap.appendChild(buildOfficeSheetView());
    statusEl.textContent = "EXCEL · " + officeState.sheets[officeState.activeSheet];
  } else if (officeState.kind === "word") {
    wrap.appendChild(buildOfficeWordView());
    statusEl.textContent = "WORD · " + officeState.fileName;
  }
  viewer.scrollTop = prevScroll.top;
  viewer.scrollLeft = prevScroll.left;
  if (prevGridScroll) {
    const grid = viewer.querySelector(".office-grid-wrap");
    if (grid) { grid.scrollTop = prevGridScroll.top; grid.scrollLeft = prevGridScroll.left; }
  }
  updateOfficeFormulaBar();
}

/* Pestañas de hojas + barra de fórmulas + cuadrícula de la hoja activa */
function buildOfficeSheetView() {
  const section = document.createElement("div");
  section.className = "doc-view";

  const tabs = document.createElement("div");
  tabs.className = "office-sheet-tabs";
  officeState.sheets.forEach((name, idx) => {
    const tab = document.createElement("button");
    tab.className = "office-sheet-tab" + (idx === officeState.activeSheet ? " active" : "");
    tab.textContent = name;
    tab.title = "Ver la hoja " + name;
    tab.addEventListener("click", () => {
      officeState.activeSheet = idx;
      officeState.sel = null;
      officeState.selAnchor = null;
      officeState.activeCell = null;
      officeState.editing = null;
      renderOfficeViewer();
    });
    tabs.appendChild(tab);
  });
  section.appendChild(tabs);

  // Barra de búsqueda / filtro
  const search = document.createElement("div");
  search.className = "office-search-bar";
  const searchBox = document.createElement("input");
  searchBox.type = "text";
  searchBox.className = "office-search-input";
  searchBox.placeholder = "🔍 Buscar / filtrar filas…";
  searchBox.value = officeState.filter;
  searchBox.spellcheck = false;
  searchBox.title = "Muestra solo las filas que contienen este texto (en cualquier columna)";
  const searchInfo = document.createElement("span");
  searchInfo.className = "office-search-info";
  const clearBtn = document.createElement("button");
  clearBtn.className = "btn small";
  clearBtn.textContent = "✕";
  clearBtn.title = "Limpiar el filtro";
  clearBtn.hidden = !officeState.filter;
  clearBtn.addEventListener("click", () => {
    officeState.filter = "";
    searchBox.value = "";
    renderOfficeViewer();
  });
  searchBox.addEventListener("input", () => {
    officeState.filter = searchBox.value;
    clearBtn.hidden = !searchBox.value;
    renderOfficeViewer();
  });
  search.appendChild(searchBox);
  search.appendChild(searchInfo);
  search.appendChild(clearBtn);
  section.appendChild(search);

  const sheet = officeState.wb.Sheets[officeState.sheets[officeState.activeSheet]];
  const grid = buildOfficeGrid(sheet);
  section.appendChild(grid);

  // Contador de filas mostradas (con filtro activo)
  if (officeState.filter.trim()) {
    const rows = grid.querySelectorAll("tbody tr").length;
    searchInfo.textContent = rows + " fila" + (rows === 1 ? "" : "s") + " coinciden";
  }
  return section;
}

/* Convierte una hoja de SheetJS en una tabla editable con encabezados de fila/columna */
function buildOfficeGrid(sheet) {
  const wrap = document.createElement("div");
  wrap.className = "office-grid-wrap";

  if (!sheet || !sheet["!ref"]) {
    wrap.innerHTML = '<div class="hint">La hoja está vacía.</div>';
    return wrap;
  }

  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const maxRow = Math.min(range.e.r, OFFICE_MAX_ROWS - 1);
  const maxCol = range.e.c;

  // Filtro: texto de búsqueda (insensible a mayúsculas) en cualquier columna
  const needle = officeState.filter.trim().toLowerCase();
  let shownRows = 0;

  const table = document.createElement("table");
  table.className = "office-grid";

  // Cabecera de columnas (A, B, C…)
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const corner = document.createElement("th");
  corner.className = "office-corner";
  headRow.appendChild(corner);
  for (let c = range.s.c; c <= maxCol; c++) {
    const th = document.createElement("th");
    th.className = "office-colhead";
    th.textContent = XLSX.utils.encode_col(c);
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  // Filas
  const tbody = document.createElement("tbody");
  for (let r = range.s.r; r <= maxRow; r++) {
    // Filtro: la fila se muestra si alguna celda contiene el texto
    if (needle) {
      let match = false;
      for (let c = range.s.c; c <= maxCol; c++) {
        if (officeCellDisplay(r, c).toLowerCase().includes(needle)) { match = true; break; }
      }
      if (!match) continue;
    }
    const tr = document.createElement("tr");
    const rowHead = document.createElement("th");
    rowHead.className = "office-rowhead";
    rowHead.textContent = r + 1;
    tr.appendChild(rowHead);
    for (let c = range.s.c; c <= maxCol; c++) {
      const td = document.createElement("td");
      td.dataset.r = r;
      td.dataset.c = c;
      const display = officeCellDisplay(r, c);
      td.textContent = display;
      if (display) td.title = display;
      officeApplyTdStyle(td, r, c);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);

  // Overlay de selección (se dibuja por encima de la cuadrícula)
  const overlay = document.createElement("div");
  overlay.className = "office-sel-overlay";
  overlay.hidden = true;
  wrap.appendChild(overlay);

  if (range.e.r > OFFICE_MAX_ROWS - 1) {
    const note = document.createElement("div");
    note.className = "office-trunc-note";
    note.textContent = "Mostrando las primeras " + OFFICE_MAX_ROWS + " filas (la hoja tiene " +
      (range.e.r + 1) + ").";
    wrap.appendChild(note);
  }

  attachGridEvents(wrap, table, overlay, range, maxRow, maxCol);
  return wrap;
}

/* ---------- Selección y edición de la cuadrícula ---------- */
function cellAt(wrap, r, c) {
  return wrap.querySelector('td[data-r="' + r + '"][data-c="' + c + '"]');
}

function normalizeSel(a, b) {
  return {
    r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c),
    r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c)
  };
}

/* Estado de arrastre para la selección por mouse (a nivel de módulo: la cuadrícula
   se reconstruye en cada render y un listener de document por instancia filtraría memoria) */
let officeDragging = false;
document.addEventListener("mouseup", () => { officeDragging = false; });

function attachGridEvents(wrap, table, overlay, range, maxRow, maxCol) {
  function cellFromEvent(e) {
    const td = e.target.closest("td[data-r]");
    if (!td) return null;
    return { r: +td.dataset.r, c: +td.dataset.c };
  }

  function paintSelection() {
    // Quitar resaltado previo
    wrap.querySelectorAll("td.sel").forEach(td => td.classList.remove("sel"));
    wrap.querySelectorAll("td.active").forEach(td => td.classList.remove("active"));
    if (!officeState.sel) { overlay.hidden = true; return; }
    const s = officeState.sel;
    for (let r = s.r1; r <= s.r2; r++)
      for (let c = s.c1; c <= s.c2; c++) {
        const td = cellAt(wrap, r, c);
        if (td) td.classList.add("sel");
      }
    if (officeState.activeCell) {
      const td = cellAt(wrap, officeState.activeCell.r, officeState.activeCell.c);
      if (td) td.classList.add("active");
    }
    // Dibujar overlay sobre el rango (relativo al contenido de la cuadrícula:
    // hay que sumar el scroll del contenedor o la sombra queda anclada a la
    // parte visible y "se separa" de las celdas al desplazarse)
    const first = cellAt(wrap, s.r1, s.c1);
    const last = cellAt(wrap, s.r2, s.c2);
    if (first && last) {
      const wr = wrap.getBoundingClientRect();
      const a = first.getBoundingClientRect();
      const b = last.getBoundingClientRect();
      overlay.hidden = false;
      overlay.style.left = (a.left - wr.left + wrap.scrollLeft) + "px";
      overlay.style.top = (a.top - wr.top + wrap.scrollTop) + "px";
      overlay.style.width = (b.right - a.left) + "px";
      overlay.style.height = (b.bottom - a.top) + "px";
    } else {
      overlay.hidden = true;
    }
  }

  function selectCell(rc, extend) {
    if (extend && officeState.selAnchor) {
      officeState.sel = normalizeSel(officeState.selAnchor, rc);
    } else {
      officeState.sel = { r1: rc.r, c1: rc.c, r2: rc.r, c2: rc.c };
      officeState.selAnchor = rc;
    }
    officeState.activeCell = rc;
    paintSelection();
    updateOfficeFormulaBar();
  }

  table.addEventListener("mousedown", e => {
    if (e.button !== 0) return;
    const rc = cellFromEvent(e);
    if (!rc) return;
    e.preventDefault();
    officeDragging = true;
    selectCell(rc, e.shiftKey);
  });

  table.addEventListener("mouseover", e => {
    if (!officeDragging) return;
    const rc = cellFromEvent(e);
    if (!rc) return;
    officeState.sel = normalizeSel(officeState.selAnchor, rc);
    officeState.activeCell = rc;
    paintSelection();
  });

  // La tabla debe poder recibir el foco para la navegación con teclado
  table.tabIndex = 0;
  table.addEventListener("mousedown", () => { table.focus(); });

  table.addEventListener("dblclick", e => {
    const rc = cellFromEvent(e);
    if (!rc) return;
    startCellEdit(wrap, rc);
  });

  // Navegación con teclado dentro de la cuadrícula
  table.addEventListener("keydown", e => {
    if (officeState.editing) return; // la edición directa gestiona sus propias teclas
    const rc = officeState.activeCell;
    if (!rc) return;
    let nr = rc.r, nc = rc.c;
    switch (e.key) {
      case "ArrowUp": nr--; break;
      case "ArrowDown": nr++; break;
      case "ArrowLeft": nc--; break;
      case "ArrowRight": nc++; break;
      case "Enter": nr++; break;
      case "F2": startCellEdit(wrap, rc); e.preventDefault(); return;
      case "Delete":
      case "Backspace":
        officeSetCell(rc.r, rc.c, "");
        renderOfficeViewer();
        e.preventDefault();
        return;
      case "z":
      case "Z":
        // Ctrl+Z / Cmd+Z: deshacer la última edición de celda
        if (e.ctrlKey || e.metaKey) { officeUndo(); e.preventDefault(); return; }
        break;
      case "c":
      case "C":
        // Ctrl+C / Cmd+C: copiar la selección actual (o la celda activa)
        if (e.ctrlKey || e.metaKey) { officeCopy(); e.preventDefault(); return; }
        break;
      default:
        // Cualquier otra tecla (letra/dígito) inicia edición con ese carácter
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          startCellEdit(wrap, rc, e.key);
          e.preventDefault();
          return;
        }
        return;
    }
    e.preventDefault();
    nr = Math.max(range.s.r, Math.min(maxRow, nr));
    nc = Math.max(range.s.c, Math.min(maxCol, nc));
    selectCell({ r: nr, c: nc }, e.shiftKey);
    const td = cellAt(wrap, nr, nc);
    if (td) td.scrollIntoView({ block: "nearest", inline: "nearest" });
  });

  // Repintar la selección existente tras cada reconstrucción de la cuadrícula
  paintSelection();
}

/* ---------- Estilos de celda (Excel) ---------- */
/* Los estilos se guardan en la propia celda de SheetJS como cell.s =
   { bold, italic, underline, fontSize (1-7), color, fill, alignH, alignV }. */

/* Aplica el estilo guardado de una celda al <td> del DOM. */
function officeApplyTdStyle(td, r, c) {
  const sheet = officeSheet();
  if (!sheet) return;
  const cell = sheet[XLSX.utils.encode_cell({ r, c })];
  const s = cell && cell.s;
  if (!s) return;
  if (s.bold) td.style.fontWeight = "bold";
  if (s.italic) td.style.fontStyle = "italic";
  if (s.underline) td.style.textDecoration = "underline";
  if (s.fontSize) td.style.fontSize = ({ 2: "10px", 3: "12px", 4: "14px", 5: "18px", 6: "24px", 7: "32px" })[s.fontSize] || "";
  if (s.color) td.style.color = s.color;
  if (s.fill) td.style.background = s.fill;
  if (s.alignH) td.style.textAlign = s.alignH;
  if (s.alignV) td.style.verticalAlign = s.alignV;
}

/* Aplica un cambio de estilo a todas las celdas de la selección actual
   (o a la celda activa). merge: true = añadir al estilo existente. */
function officeStyleSelection(patch) {
  const range = officeState.sel || (officeState.activeCell &&
    { r1: officeState.activeCell.r, c1: officeState.activeCell.c, r2: officeState.activeCell.r, c2: officeState.activeCell.c });
  if (!range) { toast("Selecciona una celda primero"); return; }
  const sheet = officeSheet();
  if (!sheet) return;
  for (let r = range.r1; r <= range.r2; r++) {
    for (let c = range.c1; c <= range.c2; c++) {
      const key = XLSX.utils.encode_cell({ r, c });
      const before = sheet[key] ? JSON.parse(JSON.stringify(sheet[key])) : null;
      const cell = sheet[key] || (sheet[key] = { t: "s", v: "" });
      const st = Object.assign({}, cell.s || {});
      for (const k in patch) {
        if (patch[k] === null) delete st[k];      // null = quitar la propiedad
        else st[k] = patch[k];
      }
      if (Object.keys(st).length) cell.s = st; else delete cell.s;
      // Celdas vacías creadas solo para el estilo: no ensuciar el rango usado
      if (!cell.f && (cell.v === "" || cell.v === undefined) && !Object.keys(st).length) delete sheet[key];
      const after = sheet[key] ? JSON.parse(JSON.stringify(sheet[key])) : null;
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        // Coalescer: si es la misma celda y la misma propiedad dentro de un
        // instante (p. ej. arrastrar el selector de color), un solo deshacer.
        const sig = Object.keys(patch).sort().join(",");
        const last = officeState.undoStack[officeState.undoStack.length - 1];
        const now = Date.now();
        if (last && last.key === key && last._sig === sig && (now - (last._t || 0)) < 800) {
          last.after = after;
          last._t = now;
        } else {
          officeState.undoStack.push({ key, before, after, _sig: sig, _t: now });
          if (officeState.undoStack.length > OFFICE_UNDO_MAX) officeState.undoStack.shift();
        }
      }
    }
  }
  renderOfficeViewer();
}

/* Inicia edición directa de una celda (input superpuesto). */
function startCellEdit(wrap, rc, initial) {
  // Si hay otra edición en curso, se confirma (re-renderiza) y se vuelve a localizar la celda
  if (officeState.editing) {
    const prev = wrap.querySelector(".office-cell-editor");
    if (prev) prev.blur(); // dispara el commit de la edición anterior
    wrap = $("#viewerContent .office-grid-wrap") || wrap;
  }
  const td = cellAt(wrap, rc.r, rc.c);
  if (!td) return;
  const sheet = officeSheet();
  const cell = sheet[XLSX.utils.encode_cell({ r: rc.r, c: rc.c })];
  const original = cell && cell.f ? "=" + cell.f : (cell && cell.v !== undefined && cell.v !== null ? String(cell.v) : "");
  officeState.editing = { r: rc.r, c: rc.c, original };

  const input = document.createElement("input");
  input.type = "text";
  input.className = "office-cell-editor";
  input.value = initial !== undefined ? initial : original;
  input.spellcheck = false;
  td.textContent = "";
  td.appendChild(input);
  input.focus();
  if (initial !== undefined) input.setSelectionRange(input.value.length, input.value.length);
  else input.select();

  function commit() {
    const val = input.value;
    officeState.editing = null;
    officeSetCell(rc.r, rc.c, val);
    renderOfficeViewer();
  }
  function cancel() {
    officeState.editing = null;
    renderOfficeViewer();
  }
  input.addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.key === "Enter") { commit(); e.preventDefault(); }
    else if (e.key === "Escape") { cancel(); e.preventDefault(); }
    else if (e.key === "Tab") {
      commit();
      e.preventDefault();
      // commit re-renderiza: recupera la cuadrícula nueva antes de mover el cursor
      const freshWrap = $("#viewerContent .office-grid-wrap") || wrap;
      const nc = rc.c + (e.shiftKey ? -1 : 1);
      const range = XLSX.utils.decode_range(officeSheet()["!ref"]);
      const maxRow = Math.min(range.e.r, OFFICE_MAX_ROWS - 1);
      const maxCol = range.e.c;
      const nr = Math.max(range.s.r, Math.min(maxRow, rc.r));
      const ncc = Math.max(range.s.c, Math.min(maxCol, nc));
      officeState.activeCell = { r: nr, c: ncc };
      officeState.sel = { r1: nr, c1: ncc, r2: nr, c2: ncc };
      officeState.selAnchor = { r: nr, c: ncc };
      const td2 = cellAt(freshWrap, nr, ncc);
      if (td2) { td2.scrollIntoView({ block: "nearest", inline: "nearest" }); }
    }
  });
  input.addEventListener("blur", () => { if (officeState.editing) commit(); });
}

/* Barra de fórmulas: muestra el contenido de la celda activa y permite escribir. */
function updateOfficeFormulaBar() {
  const ref = $("#officeCellRef");
  const input = $("#officeFormulaInput");
  if (!ref || !input) return;
  if (officeState.kind !== "excel" || !officeState.activeCell) {
    ref.textContent = "—";
    input.value = "";
    return;
  }
  const { r, c } = officeState.activeCell;
  ref.textContent = XLSX.utils.encode_cell({ r, c });
  const sheet = officeSheet();
  const cell = sheet[XLSX.utils.encode_cell({ r, c })];
  if (cell && cell.f) input.value = "=" + cell.f;
  else if (cell && cell.v !== undefined && cell.v !== null) input.value = String(cell.v);
  else input.value = "";
}

function commitFormulaInput() {
  const input = $("#officeFormulaInput");
  if (!input || !officeState.activeCell) return;
  officeSetCell(officeState.activeCell.r, officeState.activeCell.c, input.value);
  renderOfficeViewer();
  input.focus();
}

function cancelFormulaInput() {
  updateOfficeFormulaBar();
}

/* Escribe un valor (o fórmula) en una celda, con historial para deshacer. */
function officeSetCell(r, c, raw) {
  const sheet = officeSheet();
  if (!sheet) return;
  const key = XLSX.utils.encode_cell({ r, c });
  const before = sheet[key] ? JSON.parse(JSON.stringify(sheet[key])) : null;
  const val = String(raw).trim();

  if (val === "") {
    delete sheet[key];
  } else if (val.startsWith("=")) {
    // Fórmula: se guarda la fórmula y se calcula el valor
    const f = val.slice(1);
    let computed;
    try { computed = officeEvalFormula(f); } catch (e) { computed = null; }
    sheet[key] = { t: "n", f: f, v: computed === null ? 0 : computed };
    if (computed !== null) sheet[key].w = String(computed);
  } else {
    // Valor: número si es posible, texto si no
    const num = Number(val);
    if (val !== "" && !isNaN(num) && /^-?\d*\.?\d+(e-?\d+)?$/i.test(val)) {
      sheet[key] = { t: "n", v: num, w: String(num) };
    } else {
      sheet[key] = { t: "s", v: val, w: val };
    }
  }
  // Ampliar el rango de la hoja si la celda queda fuera
  if (sheet["!ref"]) {
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    if (r > range.e.r) range.e.r = r;
    if (c > range.e.c) range.e.c = c;
    if (r < range.s.r) range.s.r = r;
    if (c < range.s.c) range.s.c = c;
    sheet["!ref"] = XLSX.utils.encode_range(range);
  } else {
    sheet["!ref"] = XLSX.utils.encode_range({ s: { r, c }, e: { r, c } });
  }

  // Historial (solo si cambió)
  const after = sheet[key] ? JSON.parse(JSON.stringify(sheet[key])) : null;
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    officeState.undoStack.push({ key, before, after });
    if (officeState.undoStack.length > OFFICE_UNDO_MAX) officeState.undoStack.shift();
  }
}

function officeUndo() {
  const entry = officeState.undoStack.pop();
  if (!entry) { toast("Nada que deshacer"); return; }
  const sheet = officeSheet();
  if (!sheet) return;
  if (entry.before) sheet[entry.key] = entry.before;
  else delete sheet[entry.key];
  renderOfficeViewer();
  toast("Deshacer ✔");
}

/* ---------- Word: documento editable + imágenes ---------- */
function buildOfficeWordView() {
  const section = document.createElement("div");
  section.className = "doc-view";
  const title = document.createElement("div");
  title.className = "doc-view-title";
  title.textContent = officeState.fileName + " · Word (editable)";
  section.appendChild(title);
  const box = document.createElement("div");
  box.className = "md-preview office-doc";
  box.contentEditable = "true";
  box.spellcheck = false;
  box.innerHTML = officeState.wordHtml || '<p class="hint">El documento no contiene texto. Escribe aquí o inserta una imagen.</p>';
  officeState.wordBox = box;
  // Persistir las ediciones: si el visor se reconstruye (cambio de modo y vuelta),
  // el documento conserva lo editado en lugar de volver al HTML original.
  box.addEventListener("input", () => {
    wordPushHistory();
    officeState.wordHtml = box.innerHTML;
  });
  // Ctrl+Z deshace (historial propio), Ctrl+C copia (nativo o documento completo)
  box.addEventListener("keydown", e => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === "z" || e.key === "Z")) {
      e.preventDefault();
      wordUndo();
    } else if (mod && (e.key === "c" || e.key === "C")) {
      if (wordCopyFallback()) e.preventDefault();
    }
  });
  // Guardar el rango de selección al hacer clic (para insertar imágenes en el cursor)
  box.addEventListener("keyup", saveWordSelection);
  box.addEventListener("mouseup", saveWordSelection);
  // Pegar imágenes desde el portapapeles
  box.addEventListener("paste", e => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.type && it.type.startsWith("image/")) {
        e.preventDefault();
        const file = it.getAsFile();
        if (file) officeInsertImageFile(file);
        return;
      }
    }
  });
  section.appendChild(box);
  return section;
}

function saveWordSelection() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount && officeState.wordBox && officeState.wordBox.contains(sel.anchorNode)) {
    officeState.savedRange = sel.getRangeAt(0).cloneRange();
  }
}

/* ---------- Deshacer en Word (Ctrl+Z) ---------- */
/* Historial propio: snapshots del HTML del documento (limitado). */
const WORD_UNDO_MAX = 50;

function wordPushHistory() {
  const box = officeState.wordBox;
  if (!box) return;
  const html = box.innerHTML;
  const stack = officeState.wordUndoStack || (officeState.wordUndoStack = []);
  if (stack.length && stack[stack.length - 1] === html) return; // sin cambios
  stack.push(html);
  if (stack.length > WORD_UNDO_MAX) stack.shift();
}

function wordUndo() {
  const box = officeState.wordBox;
  const stack = officeState.wordUndoStack || [];
  if (!box || !stack.length) { toast("Nada que deshacer"); return; }
  const html = stack.pop();
  if (html === box.innerHTML && stack.length) {
    // el tope es el estado actual; tomar el anterior
    const prev = stack.pop();
    stack.push(html);
    box.innerHTML = prev;
  } else {
    box.innerHTML = html;
  }
  officeState.wordHtml = box.innerHTML;
  box.focus();
  toast("Deshecho");
}

/* ---------- Copiar en Word (Ctrl+C) ---------- */
/* El navegador copia el texto seleccionado de forma nativa; si no hay selección
   activa, se copia el texto completo del documento. */
function wordCopyFallback() {
  const box = officeState.wordBox;
  if (!box) return false;
  const sel = window.getSelection();
  if (sel && sel.rangeCount && !sel.isCollapsed && box.contains(sel.anchorNode)) return false; // el navegador lo maneja
  copyText(box.innerText);
  return true;
}

/* Inserta una imagen (archivo) en el documento Word, en el cursor o al final. */
function officeInsertImageFile(file) {
  if (!file || !file.type.startsWith("image/")) { toast("El archivo no es una imagen"); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    const sel = window.getSelection();
    let range = null;
    if (sel && sel.rangeCount && officeState.wordBox && officeState.wordBox.contains(sel.anchorNode)) {
      range = sel.getRangeAt(0);
    } else if (officeState.savedRange) {
      range = officeState.savedRange;
    }
    if (!range) {
      // Sin selección: ir al final del documento
      range = document.createRange();
      range.selectNodeContents(officeState.wordBox);
      range.collapse(false);
    }
    range.deleteContents();
    const p = document.createElement("p");
    const img = document.createElement("img");
    img.src = dataUrl;
    img.className = "office-inserted-img";
    p.appendChild(img);
    range.insertNode(p);
    // Mover el cursor tras la imagen
    range.setStartAfter(p);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    officeState.savedRange = range.cloneRange();
    updateOfficeInfo();
    toast("Imagen insertada ✔");
  };
  reader.readAsDataURL(file);
}

/* ---------- Copiar y exportar ---------- */
function officeDownload(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* Rango a copiar: la selección actual si existe, si no el rango usado de la hoja. */
function officeCopyRange() {
  if (officeState.sel) return officeState.sel;
  const sheet = officeSheet();
  if (!sheet || !sheet["!ref"]) return null;
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  return { r1: range.s.r, c1: range.s.c, r2: Math.min(range.e.r, OFFICE_MAX_ROWS - 1), c2: range.e.c };
}

/* Copia lo que se ve: Excel → el rango seleccionado (o usado) como TSV con valores
   evaluados; Word → el texto del documento (con las ediciones). */
function officeCopy() {
  if (officeState.kind === "excel") {
    const range = officeCopyRange();
    if (!range) { toast("La hoja está vacía"); return; }
    const rows = [];
    for (let r = range.r1; r <= range.r2; r++) {
      const cols = [];
      for (let c = range.c1; c <= range.c2; c++) cols.push(officeCellDisplay(r, c));
      rows.push(cols.join("\t"));
    }
    copyText(rows.join("\n"));
  } else if (officeState.kind === "word") {
    const text = officeState.wordBox ? officeState.wordBox.innerText : officeState.wordText;
    copyText(text);
  }
}

/* Exporta la hoja activa como CSV (valores evaluados, todo el rango usado) */
function officeExportCsv() {
  if (officeState.kind !== "excel") return;
  const sheet = officeSheet();
  if (!sheet || !sheet["!ref"]) { toast("La hoja está vacía"); return; }
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const maxRow = Math.min(range.e.r, OFFICE_MAX_ROWS - 1);
  const rows = [];
  for (let r = range.s.r; r <= maxRow; r++) {
    const cols = [];
    for (let c = range.s.c; c <= range.e.c; c++) cols.push(officeCellDisplay(r, c));
    rows.push(cols.map(v => csvEscape(v)).join(","));
  }
  const base = officeState.fileName.replace(/\.[^.]+$/, "");
  const sheetName = officeState.sheets[officeState.activeSheet];
  officeDownload(new Blob(["\uFEFF" + rows.join("\n")], { type: "text/csv;charset=utf-8" }),
    base + "-" + sheetName + ".csv");
  toast("Hoja exportada como CSV ✔");
}

function csvEscape(v) {
  const s = String(v);
  if (/[",\n;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/* Exporta el libro completo como .xlsx (valores + fórmulas) */
function officeExportXlsx() {
  if (officeState.kind !== "excel" || !officeState.wb) return;
  try {
    const out = XLSX.write(officeState.wb, { bookType: "xlsx", type: "array" });
    const base = officeState.fileName.replace(/\.[^.]+$/, "");
    officeDownload(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      base + "-editado.xlsx");
    toast("Libro exportado como .xlsx ✔");
  } catch (e) {
    console.error(e);
    toast("No se pudo exportar el .xlsx");
  }
}

/* Exporta el documento Word como Markdown (texto con las ediciones) */
function officeExportMd() {
  if (officeState.kind !== "word") return;
  const base = officeState.fileName.replace(/\.[^.]+$/, "");
  const text = officeState.wordBox ? officeState.wordBox.innerText : officeState.wordText;
  const md = "# " + base + "\n\n" + text;
  officeDownload(new Blob([md], { type: "text/markdown" }), base + ".md");
  toast("Documento exportado como .md ✔");
}

/* Exporta el documento Word como HTML (conserva formato e imágenes insertadas) */
function officeExportHtml() {
  if (officeState.kind !== "word") return;
  const base = officeState.fileName.replace(/\.[^.]+$/, "");
  const body = officeState.wordBox ? officeState.wordBox.innerHTML : officeState.wordHtml;
  const html = "<!DOCTYPE html>\n<html lang=\"es\">\n<head>\n<meta charset=\"utf-8\">\n" +
    "<title>" + base + "</title>\n<style>\nbody{font-family:system-ui,Segoe UI,Arial,sans-serif;" +
    "max-width:800px;margin:2rem auto;padding:0 1rem;line-height:1.5;color:#111}\n" +
    "img{max-width:100%}\ntable{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}\n</style>\n" +
    "</head>\n<body>\n" + body + "\n</body>\n</html>";
  officeDownload(new Blob([html], { type: "text/html" }), base + ".html");
  toast("Documento exportado como .html ✔");
}

/* ---------- Eventos de la barra de herramientas ---------- */
$("#officeFormulaInput").addEventListener("keydown", e => {
  if (e.key === "Enter") { commitFormulaInput(); e.preventDefault(); }
  else if (e.key === "Escape") { cancelFormulaInput(); e.preventDefault(); }
});
$("#officeCopyBtn").addEventListener("click", officeCopy);
$("#officeExportCsvBtn").addEventListener("click", officeExportCsv);
$("#officeExportXlsxBtn").addEventListener("click", officeExportXlsx);
$("#officeExportMdBtn").addEventListener("click", officeExportMd);
$("#officeExportHtmlBtn").addEventListener("click", officeExportHtml);
$("#officeUndoBtn").addEventListener("click", officeUndo);
$("#officeImgBtn").addEventListener("click", () => $("#officeImgFile").click());
$("#officeImgFile").addEventListener("change", () => {
  const f = $("#officeImgFile").files[0];
  if (f) officeInsertImageFile(f);
  $("#officeImgFile").value = "";
});

/* ---------- Barra de formato: Excel ---------- */
$("#officeBoldBtn").addEventListener("click", () => {
  const on = !officeSelectionHasStyle("bold");
  officeStyleSelection({ bold: on ? true : null });
});
$("#officeItalicBtn").addEventListener("click", () => {
  const on = !officeSelectionHasStyle("italic");
  officeStyleSelection({ italic: on ? true : null });
});
$("#officeUnderlineBtn").addEventListener("click", () => {
  const on = !officeSelectionHasStyle("underline");
  officeStyleSelection({ underline: on ? true : null });
});
$("#officeFontSize").addEventListener("change", e => {
  const v = e.target.value;
  if (v) officeStyleSelection({ fontSize: +v });
  e.target.value = "";
});
$("#officeFontColor").addEventListener("input", e => officeStyleSelection({ color: e.target.value }));
$("#officeFillColor").addEventListener("input", e => officeStyleSelection({ fill: e.target.value }));
$("#officeAlignH").addEventListener("change", e => {
  officeStyleSelection({ alignH: e.target.value || null });
  e.target.value = "";
});
$("#officeAlignV").addEventListener("change", e => {
  officeStyleSelection({ alignV: e.target.value || null });
  e.target.value = "";
});

/* ¿Alguna celda de la selección tiene esta propiedad de estilo? */
function officeSelectionHasStyle(prop) {
  const range = officeState.sel || (officeState.activeCell &&
    { r1: officeState.activeCell.r, c1: officeState.activeCell.c, r2: officeState.activeCell.r, c2: officeState.activeCell.c });
  if (!range) return false;
  const sheet = officeSheet();
  if (!sheet) return false;
  for (let r = range.r1; r <= range.r2; r++)
    for (let c = range.c1; c <= range.c2; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.s && cell.s[prop]) return true;
    }
  return false;
}

/* ---------- Barra de formato: Word ---------- */
/* El foco se pierde al pulsar la barra; se restaura antes de formatear. */
function officeWordRefocus() {
  const box = officeState.wordBox;
  if (!box) return null;
  const sel = window.getSelection();
  if (sel && sel.rangeCount && box.contains(sel.anchorNode)) return sel;
  if (officeState.savedRange) {
    sel.removeAllRanges();
    sel.addRange(officeState.savedRange);
    return sel;
  }
  box.focus();
  return sel;
}

function officeWordExec(cmd, value) {
  if (officeState.kind !== "word" || !officeState.wordBox) return;
  officeWordRefocus();
  document.execCommand(cmd, false, value || null);
  officeState.wordHtml = officeState.wordBox.innerHTML;
  officeState.wordBox.focus();
}

$("#officeWBoldBtn").addEventListener("click", () => officeWordExec("bold"));
$("#officeWItalicBtn").addEventListener("click", () => officeWordExec("italic"));
$("#officeWUnderlineBtn").addEventListener("click", () => officeWordExec("underline"));
$("#officeWFontSize").addEventListener("change", e => {
  if (e.target.value) officeWordExec("fontSize", e.target.value);
  e.target.value = "";
});
$("#officeWFontColor").addEventListener("input", e => officeWordExec("foreColor", e.target.value));
$("#officeWAlignLeft").addEventListener("click", () => officeWordExec("justifyLeft"));
$("#officeWAlignCenter").addEventListener("click", () => officeWordExec("justifyCenter"));
$("#officeWAlignRight").addEventListener("click", () => officeWordExec("justifyRight"));
$("#officeWAlignJustify").addEventListener("click", () => officeWordExec("justifyFull"));
$("#officeWColumns").addEventListener("change", e => {
  const n = +e.target.value;
  e.target.value = "";
  if (officeState.kind !== "word") return;
  if (n >= 1 && n <= 3) officeState.wordBox.style.columnCount = n;
});

/* ---------- Atajos globales del modo Office ---------- */
/* Tras usar la barra de formato el foco queda fuera de la cuadrícula; este
   manejador global garantiza que Ctrl+Z / Ctrl+C sigan funcionando. */
document.addEventListener("keydown", e => {
  if (appMode !== "office") return;
  const mod = e.ctrlKey || e.metaKey;
  if (!mod || (e.key !== "z" && e.key !== "Z" && e.key !== "c" && e.key !== "C")) return;
  const t = e.target;
  // Dentro de campos de texto o del documento Word: comportamiento normal
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  if (officeState.kind === "excel") {
    if (e.key === "z" || e.key === "Z") { officeUndo(); e.preventDefault(); }
    else { officeCopy(); e.preventDefault(); }
  }
});
