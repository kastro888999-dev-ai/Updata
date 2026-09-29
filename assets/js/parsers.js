/* ================= Parseo CSV ================= */
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') pushField();
      else if (ch === ';' && !text.includes(',')) pushField(); // soporte CSV con ;
      else if (ch === '\r') { /* skip */ }
      else if (ch === '\n') { pushField(); pushRow(); }
      else field += ch;
    }
  }
  if (field.length || row.length) { pushField(); pushRow(); }
  // quitar filas vacías finales
  while (rows.length && rows[rows.length - 1].every(c => c === "")) rows.pop();
  if (!rows.length) throw new Error("CSV vacío");
  const headers = rows[0];
  const records = rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h || ("col_" + (idx + 1))] = r[idx] !== undefined ? r[idx] : ""; });
    return obj;
  });
  if (!records.length) throw new Error("El CSV no tiene filas de datos (solo encabezados)");
  return records;
}

/* ================= Parseo Java toString (DTOs estilo Lombok) ================= */
/* Soporta texto tipo:  AUTHZ data for user demo: UserProfileDto(profiles=[ProfilesDto(name=X, cifs=[CifDto(cif=001)]), errors=null)
   Gramática: Class(field=valor, field=valor) · valor = Class(...) | [v1, v2] | escalar
   Escalares: null → null · true/false → boolean · numérico → number · resto → string tal cual.
   Limitación: los valores string no van entrecomillados en este formato, por lo que un
   escalar que contenga "," o ")" ambigua puede cortarse antes de tiempo. */
function parseJavaToString(text) {
  const src = String(text);
  // JSON puro o embebido con texto alrededor: "[AUTHZ] - user X ... {\"user\":...} and got ... {\"data\":...}"
  // Extrae TODOS los bloques JSON balanceados y los encadena con el texto entre ellos como clave.
  const blocks = jtsFindAllEmbeddedJson(src);
  if (blocks.length === 1 && blocks[0].start === 0 && blocks[0].end === src.length) {
    return blocks[0].data; // JSON puro (no debería llegar aquí: detectFormat lo manda a "json")
  }
  if (blocks.length) {
    const result = {};
    let cursor = 0, fallbackCounter = 0;
    blocks.forEach(b => {
      const label = src.slice(cursor, b.start).trim().replace(/[:\s]+$/, "") || ("JSON " + (++fallbackCounter));
      result[label] = b.data;
      cursor = b.end;
    });
    return result;
  }
  const start = src.search(/[A-Za-z_$][\w.$]*\s*\(/);
  if (start < 0) throw new Error("No se detectó ningún DTO ClassName(...) ni JSON válido");
  const prefix = src.slice(0, start).trim().replace(/[:\s]+$/, "");
  const p = { src, pos: start };
  const value = jtsParseValue(p);
  jtsSkipWs(p);
  if (p.pos < p.src.length) {
    const rest = p.src.slice(p.pos, p.pos + 30).replace(/\s+/g, " ");
    throw new Error("Texto no reconocido después del DTO: \"" + rest + "\"…");
  }
  if (value === null || typeof value !== "object") throw new Error("El contenido no es estructural (ClassName(...))");
  // prefijo tipo "AUTHZ data for user demo" → clave raíz del árbol
  return prefix ? { [prefix]: value } : value;
}

function jtsSkipWs(p) {
  while (p.pos < p.src.length && /\s/.test(p.src[p.pos])) p.pos++;
}
/* Busca TODOS los JSON embebidos en texto libre: prueba cada { o [ y extrae el bloque
   balanceado (respetando strings JSON con escapes). Devuelve [{start, end, data}, ...].
   Reglas:
   - Un bloque balanceado que no parsea como JSON se salta COMPLETO (no se fragmenta en
     sub-objetos internos, que producían claves basura tipo ',"key"').
   - Un array simple de escalares embebido en texto (p. ej. "[23137]") se deja como parte
     del texto para no romper la etiqueta del bloque siguiente.
   - Un { o [ sin cerrar al final (log truncado) se repara cerrando strings/estructuras
     abiertas, para mostrar toda la información disponible. */
/* Intenta recuperar un JSON truncado (log cortado a mitad de clave, valor o estructura):
   cierra el string abierto si lo hay, completa ':' sin valor, quita ',' colgante y agrega
   los cierres pendientes; si aun así no parsea, recorta hasta la última coma válida
   (fuera de strings) y reintenta. Devuelve el valor parseado o null. */
function jtsRepairTruncatedJson(text) {
  const stateOf = (t) => {
    const stack = [];
    let inStr = false, esc = false;
    for (let k = 0; k < t.length; k++) {
      const c = t[k];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === "{" || c === "[") stack.push(c === "{" ? "}" : "]");
      else if (c === "}" || c === "]") stack.pop();
    }
    return { stack, inStr };
  };
  const tryClose = (t, inStr, stack) => {
    let s = t;
    if (inStr) s += '"';
    if (/:\s*$/.test(s)) s += "null";
    else s = s.replace(/,\s*$/, "");
    try { return JSON.parse(s + stack.slice().reverse().join("")); } catch (err) { return null; }
  };
  let cut = text.length;
  for (let attempt = 0; attempt <= 10; attempt++) {
    const t = text.slice(0, cut);
    const { stack, inStr } = stateOf(t);
    let r = tryClose(t, inStr, stack);
    if (r !== null) return r;
    /* String abierto que era una CLAVE (cortada a mitad): cerrar y completar con null */
    if (inStr) {
      try { r = JSON.parse(t + '":null' + stack.slice().reverse().join("")); } catch (err) { r = null; }
      if (r !== null) return r;
    }
    /* Recortar hasta la última coma fuera de string y reintentar */
    let lastComma = -1, inS = false, esc = false;
    for (let k = 0; k < cut; k++) {
      const c = t[k];
      if (inS) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inS = false;
        continue;
      }
      if (c === '"') inS = true;
      else if (c === ",") lastComma = k;
    }
    if (lastComma < 0) return null;
    cut = lastComma;
  }
  return null;
}

function jtsFindAllEmbeddedJson(src) {
  const blocks = [];
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch !== "{" && ch !== "[") continue;
    let depth = 0, inStr = false, esc = false, closed = -1;
    const openers = [];
    for (let j = i; j < src.length; j++) {
      const c = src[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === "{" || c === "[") { depth++; openers.push(c === "{" ? "}" : "]"); }
      else if (c === "}" || c === "]") {
        depth--;
        if (depth === 0) {
          closed = j;
          let data = null;
          try { data = JSON.parse(src.slice(i, j + 1)); } catch (err) { data = null; }
          if (data !== null) {
            // Array simple de escalares con texto antes y después: parte del texto
            const before = src.slice(0, i).trim(), after = src.slice(j + 1).trim();
            const simpleArr = Array.isArray(data) && data.length > 0 &&
              data.every(v => v === null || typeof v !== "object");
            if (!(simpleArr && before && after)) blocks.push({ start: i, end: j + 1, data });
          }
          i = j; // JSON válido o no: no fragmentar el interior del bloque
          break;
        }
      }
    }
    if (closed < 0) {
      /* Estructura sin cerrar (log truncado): intentar reparación */
      const data = jtsRepairTruncatedJson(src.slice(i));
      if (data !== null) blocks.push({ start: i, end: src.length, data });
      i = src.length; // consumir el resto: no fragmentar sub-objetos de un truncado
    }
  }
  return blocks;
}
function jtsParseValue(p) {
  jtsSkipWs(p);
  const ch = p.src[p.pos];
  if (ch === "[") return jtsParseList(p);
  const id = /^[A-Za-z_$][\w.$]*/.exec(p.src.slice(p.pos));
  if (id && p.src[p.pos + id[0].length] === "(") return jtsParseObject(p, id[0]);
  return jtsParseScalar(p);
}
function jtsParseObject(p, className) {
  p.pos += className.length + 1; // saltar "ClassName("
  const obj = {};
  jtsSkipWs(p);
  if (p.src[p.pos] === ")") { p.pos++; return obj; }
  for (;;) {
    jtsSkipWs(p);
    const field = /^[\w$][\w$.]*/.exec(p.src.slice(p.pos));
    if (!field) throw new Error("Se esperaba un nombre de campo en " + className + " (pos " + p.pos + ")");
    p.pos += field[0].length;
    jtsSkipWs(p);
    if (p.src[p.pos] !== "=") throw new Error("Se esperaba '=' tras el campo " + field[0] + " (pos " + p.pos + ")");
    p.pos++;
    obj[field[0]] = jtsParseValue(p);
    jtsSkipWs(p);
    const ch = p.src[p.pos];
    if (ch === ",") { p.pos++; continue; }
    if (ch === ")") { p.pos++; return obj; }
    throw new Error("Se esperaba ',' o ')' en " + className + " (pos " + p.pos + ")");
  }
}
function jtsParseList(p) {
  p.pos++; // saltar "["
  const arr = [];
  jtsSkipWs(p);
  if (p.src[p.pos] === "]") { p.pos++; return arr; }
  for (;;) {
    arr.push(jtsParseValue(p));
    jtsSkipWs(p);
    const ch = p.src[p.pos];
    if (ch === ",") { p.pos++; continue; }
    if (ch === "]") { p.pos++; return arr; }
    throw new Error("Se esperaba ',' o ']' en lista (pos " + p.pos + ")");
  }
}
function jtsParseScalar(p) {
  let end = p.pos;
  while (end < p.src.length && p.src[end] !== "," && p.src[end] !== ")" && p.src[end] !== "]") end++;
  const raw = p.src.slice(p.pos, end).trim();
  p.pos = end;
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw !== "" && !isNaN(Number(raw)) && !/^0\d/.test(raw)) return Number(raw); // "000111" sigue siendo string
  return raw;
}

function detectFormat(text) {
  const t = text.trim();
  // JSON real (empieza y parsea como tal); si no parsea, puede ser JSON embebido en texto
  if (t.startsWith("{") || t.startsWith("[")) {
    try { JSON.parse(t); return "json"; } catch (err) { /* seguir probando */ }
  }
  // código HTML
  if (/^<!DOCTYPE|^<html|^<\w+[\s>]/i.test(t)) return "html";
  // código Java
  if (/\b(public|private|protected)\s+(class|interface|enum|static|void)\b|\bSystem\.out\.print/.test(t)) return "java";
  // código Python
  if (/^(def |class |import |from |if __name__)/m.test(t) && !/[;{]\s*$/m.test(t.split("\n")[0])) return "python";
  // Java toString de DTOs (estilo Lombok): Class(field=..., list=[...])
  if (looksLikeJavaToString(t)) return "jtostring";
  return "csv";
}

function looksLikeJavaToString(text) {
  try { parseJavaToString(text); return true; } catch (err) { return false; }
}
