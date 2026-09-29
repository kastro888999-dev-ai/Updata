# Updata — Historia de Desarrollo del Proyecto

**Gestor del proyecto:** Carlos Augusto Castro C.

## Cómo se creó

Updata fue construido de forma **iterativa y conversacional**, dirigido por Carlos Augusto Castro C. como gestor y diseñador del producto, en colaboración con un agente de IA:

- **Agente:** CODA (agente de codificación de Globant)
- **Metodología:** desarrollo incremental guiado por requerimientos en lenguaje natural. Cada funcionalidad se solicitó, implementó, probó y refinó en ciclos cortos, con retroalimentación directa del gestor sobre el resultado visual y funcional.

El gestor definió en cada iteración qué debía hacer la herramienta (requerimientos funcionales, de privacidad, de marca y de experiencia de usuario), y el agente tradujo esos requerimientos a código, proponiendo además decisiones técnicas (arquitectura, librerías, fallbacks) que fueron validadas sobre la marcha.

## Principios de diseño (definidos por el gestor)

1. **100% local y privado** — se ejecuta con doble clic en `index.html`; ninguna petición a internet en ejecución, ningún dato sale del equipo.
2. **Identidad Globant** — verde `#BFD732` y gris oscuro, con modo claro/oscuro.
3. **"Se copia lo que se ve"** — el copiado y las exportaciones respetan el estado del visor: colapsos, máscaras y ediciones.
4. **Responsive** — visor ~75% de la pantalla, paneles con scroll independiente, apilado en pantallas pequeñas.

## Cronología de mejoras

| # | Iteración | Qué se agregó |
|---|-----------|---------------|
| 1 | Base | Visor JSON/CSV en un solo `index.html`: árbol colapsable, enmascarado `***`, copiado fiel a lo visible, colores Globant, dark mode, responsive |
| 2 | Desencriptado (explorado) | Se analizó desencriptar respuestas con session ID/seed; se descartó al no ser reversible el esquema (hash de 32 bytes) |
| 3 | Tabla CSV | CSV renderizado como tabla con filas/columnas, máscara por celda/columna, copiado como CSV válido |
| 4 | Expandir/contraer | Control por columna (⤢/⊟) y por fila en la tabla CSV |
| 5 | Markdown | Editor con barra de herramientas para no expertos, renderizador MD propio (sin librerías) y vista previa en vivo |
| 6 | Reestructuración | De un único HTML a arquitectura escalable: `assets/css` + `assets/js` (core, parsers, viewer, markdown, controls) manteniendo ejecución desde `file://` |
| 7 | Modos + PDF | Barra de modos (Datos/Markdown/PDF), lector PDF offline con pdf.js + pdf-lib vendorizadas, reordenar/rotar/eliminar páginas, exportar PDF editado, exportar MD→PDF |
| 8 | Scroll independiente | Layout fijado al viewport: cada panel con su propio scroll |
| 9 | PDF avanzado | Capa de texto seleccionable, resaltar/subrayar/censurar, texto e imágenes sobre el PDF, copiar zona como imagen, anexar otros PDF, exportar a `.md` |
| 10 | Refinamientos PDF | Punto indicador de color, exportaciones movidas al visor, duplicar páginas, navegación por miniaturas |
| 11 | Imágenes y color | Imágenes movibles/redimensionables, selector de color libre (paleta + hex), soporte de PDFs con contraseña y exportación sin ella |
| 12 | Formas | "Pintar" con rectángulo, redondeado, elipse y mano alzada; formas también en resaltado |
| 13 | Texto rico en PDF | Editor de texto con negrita, cursiva, subrayado, tamaño, alineación, 13 fuentes, color, columnas y listas; textos movibles y re-editables |
| 14 | UX | Deshacer/rehacer completos (Ctrl+Z / Ctrl+Shift+Z) con historial de acciones (agregar/borrar/editar/mover), scroll estable en la vista previa MD |
| 15 | Archivos y fuentes | Botón 📂 Abrir con detección de extensión (json/csv/md/pdf/java/html/py), selector de tipo de letra para el contenido, color de letra en MD |
| 16 | Código | Soporte Java, HTML y Python con resaltado de sintaxis propio y edición directa en el visor; edición de valores JSON/CSV con doble clic |
| 17 | GIF | Reproductor de GIF animados con decodificador y codificador GIF propios (LZW, disposal, transparencia, entrelazado, cuantización median-cut): play/pausa/stop, navegación frame a frame, velocidad, edición por frame (resaltar, pintar, trazo, texto) y exportación PNG/GIF con las ediciones incrustadas |

## Arquitectura resultante

```
Updata/
├── index.html            # Maquetación (sin lógica)
├── MANUAL.md             # Manual de usuario
├── DESARROLLO.md         # Este documento
├── README.md             # Documentación técnica
└── assets/
    ├── css/main.css      # Estilos (temas, layout, componentes)
    ├── vendor/           # Librerías vendorizadas (offline)
    │   ├── pdf.min.js          # pdf.js (Mozilla) — render de PDF
    │   ├── pdf.worker.min.js
    │   └── pdf-lib.min.js      # pdf-lib — edición/exportación de PDF
    └── js/
        ├── core.js       # Utilidades, gestor de modos, tema, fuente
        ├── parsers.js    # CSV + detección de formato (JSON/CSV/Java/HTML/Python)
        ├── code.js       # Resaltado y edición de código
        ├── viewer.js     # Árbol JSON, tabla CSV, máscaras, edición, serialización
        ├── markdown.js   # Renderizador MD propio + toolbar + export PDF
        ├── pdf.js        # Modo PDF completo (render, anotaciones, export)
        ├── gif.js        # Modo GIF: codec propio + reproductor + edición + export
        └── controls.js   # Cambio de modos y eventos globales
```

### Decisiones técnicas destacadas

- **Scripts clásicos (no módulos ES)** para funcionar desde `file://` sin servidor.
- **Sin dependencias en ejecución**: los renderizadores de Markdown y de código son propios; el modo GIF incluye además un decodificador y codificador GIF completos (LZW, disposal, entrelazado, cuantización de color) escritos a mano. Solo pdf.js/pdf-lib están vendorizadas localmente para el modo PDF.
- **Anotaciones PDF en coordenadas fraccionarias** (0–1) del viewport, lo que permite re-render a cualquier tamaño y exportación fiel incluso con páginas rotadas. Las ediciones del modo GIF usan el mismo sistema de coordenadas fraccionarias, por frame.
- **Fallback de rasterización** para PDFs cifrados que pdf-lib no puede copiar: la página se exporta como imagen de alta resolución ya descifrada.
- **Historial de acciones** (no de estados) para deshacer/rehacer granular en el editor PDF.

## Créditos

| Rol | Nombre |
|-----|--------|
| **Gestor y diseño de producto** | Carlos Augusto Castro C. |
| **Desarrollo asistido por IA** | CODA (agente de codificación, Globant) |
| Librerías de terceros | pdf.js (Mozilla, Apache 2.0) · pdf-lib (MIT) |
