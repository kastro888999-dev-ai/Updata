/* ================= Render del árbol ================= */
let currentFormat = "json"; // formato del dato renderizado

function renderData(data) {
  viewer.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.id = "viewerContent";
  wrap.style.zoom = (typeof appZoom !== "undefined" ? appZoom : 1);
  viewer.appendChild(wrap);
  if (currentFormat === "csv" && Array.isArray(data)) {
    wrap.appendChild(buildCSVTable(data));
  } else {
    wrap.appendChild(buildNode(null, data, true));
  }
}

/* Render de TODOS los documentos de Datos (JSON/CSV/código) apilados en el visor */
function renderDataAll() {
  const fmtSel = $("#formatSelect").value;
  viewer.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.id = "viewerContent";
  wrap.style.zoom = (typeof appZoom !== "undefined" ? appZoom : 1);
  viewer.appendChild(wrap);
  let count = 0;
  dataDocs.forEach(doc => {
    const text = doc.ta.value;
    if (!text.trim()) return;
    let fmt = fmtSel === "auto" ? detectFormat(text) : fmtSel;
    const section = document.createElement("div");
    section.className = "doc-view";
    const title = document.createElement("div");
    title.className = "doc-view-title";
    title.dataset.doc = doc.id;
    doc.fmt = fmt;
    title.textContent = docViewTitleText(doc);
    section.appendChild(title);
    const body = document.createElement("div");
    body.className = "doc-view-body";
    try {
      if (isCodeFormat(fmt)) {
        body.appendChild(buildCodeBlock(text, fmt, doc.ta));
      } else {
        let data;
        if (fmt === "json") data = JSON.parse(text);
        else if (fmt === "jtostring") data = parseJavaToString(text);
        else data = parseCSV(text);
        currentFormat = fmt;
        if (fmt === "csv" && Array.isArray(data)) body.appendChild(buildCSVTable(data));
        else body.appendChild(buildNode(null, data, true));
      }
    } catch (err) {
      const e = document.createElement("div");
      e.className = "error";
      e.textContent = "⚠ " + doc.name + " (" + fmt.toUpperCase() + "): " + err.message;
      body.appendChild(e);
    }
    section.appendChild(body);
    wrap.appendChild(section);
    count++;
  });
  if (!count) {
    if (typeof showManualInViewer === "function") { showManualInViewer(); return; }
    viewer.innerHTML = '<div class="hint">Pega JSON/CSV a la izquierda y pulsa Formatear.</div>';
    return;
  }
  statusEl.textContent = "DATOS · " + count + " documento(s)";
  updateFormatBadges();
}

/* ================= Tabla CSV ================= */
function buildCSVTable(records) {
  const wrap = document.createElement("div");
  wrap.className = "csv-table-wrap";
  const table = document.createElement("table");
  table.className = "csv-table";

  const headers = Object.keys(records[0]);

  // thead
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const thNum = document.createElement("th");
  thNum.className = "row-num";
  thNum.textContent = "#";
  headRow.appendChild(thNum);
  headers.forEach((h, colIdx) => {
    const th = document.createElement("th");
    th.title = h;
    const name = document.createElement("span");
    name.className = "col-name";
    name.textContent = h;
    th.appendChild(name);

    const controls = document.createElement("span");
    controls.className = "th-controls";

    const colCells = () => table.querySelectorAll('td[data-col="' + colIdx + '"]');

    // expandir columna (mostrar texto completo)
    const expandBtn = document.createElement("button");
    expandBtn.className = "tbtn";
    expandBtn.textContent = "⤢";
    expandBtn.title = "Expandir columna (texto completo)";
    // contraer columna (minimizar)
    const collapseBtn = document.createElement("button");
    collapseBtn.className = "tbtn tbtn-collapse";
    collapseBtn.textContent = "⊟";
    collapseBtn.title = "Contraer / restaurar columna";
    // mask columna
    const maskBtn = document.createElement("button");
    maskBtn.className = "tbtn";
    maskBtn.textContent = "***";
    maskBtn.title = "Enmascarar / desenmascarar columna";

    expandBtn.addEventListener("click", e => {
      e.stopPropagation();
      const on = !expandBtn.classList.contains("active");
      expandBtn.classList.toggle("active", on);
      collapseBtn.classList.remove("active");
      th.classList.remove("c-collapsed");
      colCells().forEach(td => {
        td.classList.toggle("c-expanded", on);
        td.classList.remove("c-collapsed");
      });
    });
    collapseBtn.addEventListener("click", e => {
      e.stopPropagation();
      const on = !collapseBtn.classList.contains("active");
      collapseBtn.classList.toggle("active", on);
      expandBtn.classList.remove("active");
      th.classList.toggle("c-collapsed", on);
      colCells().forEach(td => {
        td.classList.toggle("c-collapsed", on);
        td.classList.remove("c-expanded");
      });
    });
    maskBtn.addEventListener("click", e => {
      e.stopPropagation();
      const vals = table.querySelectorAll('td[data-col="' + colIdx + '"] .val');
      const anyUnmasked = [...vals].some(v => !v.classList.contains("masked"));
      vals.forEach(v => {
        const isMasked = v.classList.contains("masked");
        if (anyUnmasked && !isMasked) toggleMask(v);
        if (!anyUnmasked && isMasked) toggleMask(v);
      });
      maskBtn.classList.toggle("active", anyUnmasked);
    });

    controls.appendChild(expandBtn);
    controls.appendChild(collapseBtn);
    controls.appendChild(maskBtn);
    th.appendChild(controls);
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  // tbody
  const tbody = document.createElement("tbody");
  records.forEach((rec, rowIdx) => {
    const tr = document.createElement("tr");
    const tdNum = document.createElement("td");
    tdNum.className = "row-num";

    const numLabel = document.createElement("span");
    numLabel.textContent = rowIdx + 1;
    tdNum.appendChild(numLabel);

    const rowExpand = document.createElement("button");
    rowExpand.className = "rbtn";
    rowExpand.textContent = "⤢";
    rowExpand.title = "Expandir / contraer fila (texto completo)";
    rowExpand.addEventListener("click", () => {
      tr.classList.toggle("r-expanded");
      rowExpand.textContent = tr.classList.contains("r-expanded") ? "⤡" : "⤢";
    });
    tdNum.appendChild(rowExpand);

    const rowCopy = document.createElement("button");
    rowCopy.className = "rbtn";
    rowCopy.textContent = "⧉";
    rowCopy.title = "Copiar esta fila tal como se ve";
    rowCopy.addEventListener("click", () => copyText(serializeCSVRow(tr)));
    tdNum.appendChild(rowCopy);

    tr.appendChild(tdNum);
    headers.forEach((h, colIdx) => {
      const td = document.createElement("td");
      td.dataset.col = colIdx;
      const v = document.createElement("span");
      v.className = "val v-string";
      v.textContent = rec[h];
      v.title = "Clic: enmascarar · Doble clic: editar";
      v.addEventListener("click", () => toggleMask(v));
      v.addEventListener("dblclick", e => { e.stopPropagation(); editValueInline(v); });
      td.appendChild(v);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function csvEscape(value) {
  return /[",\n\r]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
}

function serializeCSVRow(tr) {
  const cells = [...tr.querySelectorAll("td:not(.row-num) .val")];
  return cells.map(v => csvEscape(v.textContent)).join(",");
}

function serializeCSVTableEl(table) {
  const headers = [...table.querySelectorAll("thead th:not(.row-num) .col-name")]
    .map(el => csvEscape(el.textContent));
  const lines = [headers.join(",")];
  table.querySelectorAll("tbody tr").forEach(tr => lines.push(serializeCSVRow(tr)));
  return lines.join("\n");
}

function serializeCSVTable() {
  const table = viewer.querySelector("table.csv-table");
  if (!table) return "";
  return serializeCSVTableEl(table);
}

function buildNode(key, value, isRoot) {
  const node = document.createElement("div");
  node.className = "node";
  const row = document.createElement("div");
  row.className = "row";
  node.appendChild(row);

  const isObj = value !== null && typeof value === "object";
  const isArr = Array.isArray(value);

  // toggle
  const tog = document.createElement("span");
  tog.className = "toggle" + (isObj ? "" : " leaf");
  tog.textContent = "▾";
  row.appendChild(tog);

  // key
  if (key !== null) {
    const k = document.createElement("span");
    k.className = "key";
    k.textContent = currentFormat === "json" ? JSON.stringify(String(key)) : String(key);
    row.appendChild(k);
    row.appendChild(punct(": "));
  }

  if (isObj) {
    const open = isArr ? "[" : "{";
    const close = isArr ? "]" : "}";
    row.appendChild(punct(open));

    const ell = document.createElement("span");
    ell.className = "ellipsis";
    ell.textContent = "…";
    ell.title = "Expandir";
    row.appendChild(ell);

    const cnt = document.createElement("span");
    cnt.className = "count";
    const n = isArr ? value.length : Object.keys(value).length;
    cnt.textContent = n + (isArr ? " elementos" : " propiedades");

    const children = document.createElement("div");
    children.className = "children";
    const entries = isArr ? value.map((v, i) => [i, v]) : Object.entries(value);
    entries.forEach(([k2, v2], idx) => {
      const child = buildNode(isArr ? null : k2, v2, false);
      if (idx < entries.length - 1) child.dataset.comma = "1";
      children.appendChild(child);
    });
    node.appendChild(children);

    const closeRow = document.createElement("div");
    closeRow.className = "close-line punct";
    closeRow.style.color = "var(--muted)";
    closeRow.textContent = close;
    node.appendChild(closeRow);

    // en la fila (para vista colapsada): { … } n props
    row.appendChild(cnt);

    // acciones de fila
    row.appendChild(buildRowActions(node));

    const toggleFn = () => {
      node.classList.toggle("collapsed");
      const collapsed = node.classList.contains("collapsed");
      tog.textContent = collapsed ? "▸" : "▾";
      closeRow.style.display = collapsed ? "none" : "";
      if (collapsed) {
        ell.style.display = "inline";
        ell.insertAdjacentElement("afterend", makeCloseInline(close, node));
      } else {
        ell.style.display = "";
        const inl = row.querySelector(".close-inline");
        if (inl) inl.remove();
      }
    };
    tog.addEventListener("click", toggleFn);
    ell.addEventListener("click", toggleFn);
  } else {
    // hoja
    const v = document.createElement("span");
    v.className = "val v-" + (value === null ? "null" : typeof value);
    v.dataset.raw = JSON.stringify(value);
    v.textContent = displayValue(value);
    v.title = "Clic: enmascarar · Doble clic: editar";
    v.addEventListener("click", () => toggleMask(v));
    v.addEventListener("dblclick", e => { e.stopPropagation(); editValueInline(v); });
    row.appendChild(v);
    row.appendChild(buildRowActions(node));
  }
  return node;
}

function makeCloseInline(close, node) {
  const s = document.createElement("span");
  s.className = "punct close-inline";
  s.textContent = close;
  return s;
}

function punct(t) {
  const s = document.createElement("span");
  s.className = "punct";
  s.textContent = t;
  return s;
}

function displayValue(value) {
  if (value === null) return "null";
  if (typeof value === "string") return currentFormat === "json" ? JSON.stringify(value) : value;
  return String(value);
}

/* ================= Máscaras ================= */
/* ================= Edición de valores en el visor ================= */
function editValueInline(valEl) {
  if (valEl.classList.contains("masked")) { toast("Desenmascara el valor antes de editar"); return; }
  if (valEl.querySelector("input")) return;
  const original = valEl.textContent;
  const inp = document.createElement("input");
  inp.type = "text";
  inp.className = "val-edit";
  inp.value = original;
  valEl.textContent = "";
  valEl.appendChild(inp);
  inp.focus();
  inp.select();

  const commit = () => {
    const newVal = inp.value;
    valEl.textContent = newVal;
    // actualizar el color según el tipo aparente (para el árbol JSON)
    if (valEl.classList.contains("v-number") || valEl.classList.contains("v-boolean") || valEl.classList.contains("v-null")) {
      valEl.className = valEl.className.replace(/v-\w+/, guessTypeClass(newVal));
    }
    if (newVal !== original) toast("Valor editado (usa Copiar para llevarte el resultado)");
  };
  const cancel = () => { valEl.textContent = original; };

  inp.addEventListener("blur", commit);
  inp.addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.key === "Enter") inp.blur();
    if (e.key === "Escape") { inp.removeEventListener("blur", commit); cancel(); }
  });
  inp.addEventListener("click", e => e.stopPropagation());
  inp.addEventListener("dblclick", e => e.stopPropagation());
}

function guessTypeClass(text) {
  const t = text.trim().replace(/^"|"$/g, "");
  if (t === "null") return "v-null";
  if (t === "true" || t === "false") return "v-boolean";
  if (t !== "" && !isNaN(Number(t))) return "v-number";
  return "v-string";
}

function toggleMask(valEl) {
  const masked = valEl.classList.toggle("masked");
  if (masked) {
    valEl.dataset.original = valEl.textContent;
    valEl.textContent = MASK;
  } else {
    valEl.textContent = valEl.dataset.original || "";
    delete valEl.dataset.original;
  }
}
function maskAllIn(node, mask) {
  node.querySelectorAll(".val").forEach(v => {
    const isMasked = v.classList.contains("masked");
    if (mask && !isMasked) toggleMask(v);
    if (!mask && isMasked) toggleMask(v);
  });
}

/* ================= Acciones por fila ================= */
function buildRowActions(node) {
  const box = document.createElement("span");
  box.className = "row-actions";

  const copyBtn = document.createElement("button");
  copyBtn.className = "mini";
  copyBtn.textContent = "⧉ copiar";
  copyBtn.title = "Copiar esta sección tal como se ve";
  copyBtn.addEventListener("click", e => {
    e.stopPropagation();
    copyText(serializeNode(node, 0));
  });

  const maskBtn = document.createElement("button");
  maskBtn.className = "mini";
  maskBtn.textContent = "*** mask";
  maskBtn.title = "Enmascarar / desenmascarar esta sección";
  maskBtn.addEventListener("click", e => {
    e.stopPropagation();
    const vals = node.querySelectorAll(".val");
    const anyUnmasked = [...vals].some(v => !v.classList.contains("masked"));
    maskAllIn(node, anyUnmasked);
  });

  box.appendChild(copyBtn);
  box.appendChild(maskBtn);
  return box;
}

/* ================= Serialización "lo que se ve" ================= */
function serializeNode(node, depth) {
  const indent = "  ".repeat(depth);
  const row = node.querySelector(":scope > .row");
  const keyEl = row.querySelector(":scope > .key");
  const keyPart = keyEl ? keyEl.textContent + ": " : "";
  const valEl = row.querySelector(":scope > .val");

  if (valEl) {
    return indent + keyPart + valEl.textContent;
  }

  // contenedor
  const collapsed = node.classList.contains("collapsed");
  const puncts = [...row.querySelectorAll(":scope > .punct")].map(p => p.textContent);
  const openBrace = puncts.includes("[") ? "[" : "{";
  const close = openBrace === "[" ? "]" : "}";
  if (collapsed) {
    const cnt = row.querySelector(":scope > .count");
    return indent + keyPart + openBrace + " … " + close + (cnt ? "  // " + cnt.textContent : "");
  }
  const children = node.querySelector(":scope > .children");
  const lines = [indent + keyPart + openBrace];
  const kids = children ? [...children.children].filter(c => c.classList.contains("node")) : [];
  kids.forEach((kid, i) => {
    let line = serializeNode(kid, depth + 1);
    if (i < kids.length - 1) line += ",";
    lines.push(line);
  });
  lines.push(indent + close);
  return lines.join("\n");
}

function serializeAll() {
  // Markdown apilado
  const mdPreviews = viewer.querySelectorAll(".md-preview");
  if (mdPreviews.length) {
    return mdDocs.map(d => d.ta.value).filter(v => v.trim()).join("\n\n---\n\n");
  }
  // bloques de código (uno o varios)
  const codeEls = [...viewer.querySelectorAll(".code-view code")];
  if (codeEls.length) {
    return codeEls.map(el => el.innerText).join("\n\n");
  }
  // tablas CSV (una o varias)
  const tables = [...viewer.querySelectorAll("table.csv-table")];
  if (tables.length) {
    return tables.map(t => serializeCSVTableEl(t)).join("\n\n");
  }
  // árboles JSON
  const roots = [
    ...viewer.querySelectorAll(".doc-view-body > .node"),
    ...viewer.querySelectorAll("#viewerContent > .node")
  ];
  if (!roots.length) return "";
  return roots.map(r => serializeNode(r, 0)).join("\n\n");
}
