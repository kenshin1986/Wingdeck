# Wingdeck

Orquestador visual de terminales y flotas de agentes IA para Windows. Organiza múltiples
consolas en un lienzo libre (arrastrar y redimensionar), con sesiones persistentes que
recuerdan la carpeta de trabajo, el título y la posición de cada terminal entre reinicios.

## Características

- **Multi-shell**: PowerShell 7, Windows PowerShell, CMD, Git Bash y WSL (se detectan automáticamente).
- **Lienzo libre**: arrastra cada terminal desde su barra superior y redimensiónala desde la esquina.
- **Sesiones persistentes**: al cerrar y volver a abrir, cada terminal se restaura en su posición y en la carpeta donde estaba trabajando (seguimiento en vivo del directorio vía OSC 9;9).
- **Workspaces con nombre**: agrupa terminales por proyecto (selector `▣` en la barra superior). Al cambiar de workspace las terminales siguen vivas en segundo plano y recuperan su pantalla al volver.
- **Comando de arranque** (⚡ en cada terminal): se ejecuta automáticamente al abrir o restaurar esa terminal (p. ej. `npm run dev`), disparado cuando el shell muestra su primer prompt.
- **Monitoreo de recursos**: CPU y RAM del sistema en la barra superior, y consumo por terminal (árbol de procesos completo de cada shell).
- **Rendimiento**: renderizado WebGL en cada terminal.

### Modo orquestador de agentes IA (Claude Code, Qwen Code, OpenCode)

- **Detección de "agente terminó"**: cuando una terminal deja de emitir salida tras una racha de trabajo (umbral configurable en ⚙) y su árbol de procesos queda ocioso, la tarjeta se resalta en ámbar con brillo animado y muestra "● listo". El punto de estado es verde pulsante mientras el agente trabaja. La campana del terminal (BEL) también dispara la alerta al instante.
- **Avisos**: parpadeo en la barra de tareas + contador en el título, notificación nativa de Windows (clic → salta a esa terminal), sonido suave y toast dentro de la app. Todo configurable en ⚙.
- **Centro de actividad (🔔)**: historial de qué agente terminó, en qué terminal y hace cuánto; clic en un evento salta a la terminal (cambiando de workspace si hace falta).
- **Chip de agente**: detecta automáticamente qué herramienta corre en cada terminal (`✳ Claude`, `◆ Qwen`, `⬡ OpenCode`) inspeccionando el árbol de procesos.
- **Portapapeles de primera clase**:
  - `Ctrl+V` pegado inteligente: texto → pega; **imagen** → guarda PNG temporal e inserta su ruta (funciona con los 3 agentes); **archivos copiados en Explorer** → inserta la ruta.
  - `Ctrl+Alt+V` reenvía la tecla cruda para que el agente lea el portapapeles por sí mismo.
  - `Ctrl+Shift+V` pega siempre como texto; `Ctrl+Shift+C` copia la selección.
  - **Copiar al seleccionar** (estilo Windows Terminal, configurable) y menú contextual con clic derecho.
  - **Arrastrar y soltar** archivos sobre una terminal inserta su ruta entre comillas.

### Orquestación avanzada

- **Plantillas de flota (🚀)**: guarda el workspace actual (shells, carpetas, comandos de arranque) como plantilla y lánzala de nuevo con un clic para levantar toda una flota de agentes en un workspace nuevo.
- **Cola de prompts (📋 en cada terminal)**: encola instrucciones para que se envíen automáticamente, una por una, cuando el agente de esa terminal quede libre (con opción de pausar la cola).
- **Broadcast (📢)**: envía el mismo mensaje a varias terminales seleccionadas del workspace actual, enviándolo ya o encolándolo.
- **Resumen en los avisos**: el toast y el centro de actividad muestran las últimas líneas de salida de la terminal, no solo el título.
- **Modo enfoque (⛶ / `Ctrl+Shift+F`)**: expande una terminal a pantalla completa sin perder su estado; clic en el fondo oscuro para volver a la grilla.
- **Búsqueda en el historial (`Ctrl+F`)**: encuentra texto en todo el scrollback de una terminal (`Enter`/`Shift+Enter` para siguiente/anterior).
- **Rutas de archivo clicables**: cualquier ruta que aparezca en la salida de un agente (`src/foo.ts:42`, `C:\...`) se puede abrir directamente en VS Code.
- **Tamaño de fuente y salto rápido**: `Ctrl+rueda` cambia el tamaño de fuente de una terminal (se recuerda); `Ctrl+1`…`Ctrl+9` salta a la n-ésima terminal según su posición en la grilla.
- **Scrollback persistente**: el historial de cada terminal sobrevive a reinicios de la app (marcado con un separador "sesión anterior"), usando una serialización limpia del estado visible en vez de reproducir bytes crudos.
- **Rama de git en el header**: si la carpeta de la terminal es un repo, se muestra su rama actual junto al cwd.
- **Bandeja del sistema**: cerrar la ventana (✕) la minimiza a la bandeja — la app y los agentes siguen corriendo y los avisos te siguen llegando. "Salir" desde el menú de la bandeja pregunta si seguir en segundo plano o cerrar todo de verdad (con "no volver a preguntar" reversible en ⚙).
- **Alerta de CPU sostenida**: si una terminal satura un núcleo de forma sostenida (p. ej. un agente en bucle), aparece un aviso silencioso (sin notificación de sistema) en el centro de actividad.
- **Descripción por consola**: chip corto junto al título (`「refactor de ptys」`) para recordar en qué estás trabajando en cada terminal — doble clic para editarlo, o desde el menú contextual.
- **Instancia única**: abrir Wingdeck de nuevo mientras ya está corriendo no crea una segunda ventana — enfoca la existente. Evita que dos instancias se pisen la misma sesión guardada.

### Cerebro agéntico por workspace (🧠 Memoria)

Cada workspace tiene un markdown compartido entre todas sus terminales — el lugar donde
anotar (o dejar que los propios agentes anoten) cómo se conectan los proyectos que lo
forman: contratos de API, puertos, variables de entorno compartidas, orden de
build/deploy, decisiones de arquitectura transversales. No repite lo que cada agente ya
puede ver en su propio repo — es el conocimiento de *integración* que hoy solo tenés vos
en la cabeza.

- **Automático para agentes**: cualquier terminal con un comando de arranque (⚡) configurado recibe, apenas el agente queda listo, un mensaje con la ruta del cerebro y la instrucción de leerlo y actualizarlo. Una terminal de shell plano (sin ⚡) no recibe nada.
- **Los agentes lo editan directo**: es un archivo real en disco (`%APPDATA%\orq-terminal\brains\<workspace>.md`); cualquier agente puede leerlo y escribirlo con sus propias herramientas de archivo, no hace falta pasar por Wingdeck.
- **Sincronización pasiva**: si un agente lo actualiza mientras el panel está abierto en otra parte, Wingdeck te avisa ahí mismo ("un agente actualizó este archivo") sin sobreescribir lo que estés viendo ni interrumpir ninguna terminal en marcha — se relee cuando vos querés, o automáticamente en el próximo arranque de cada terminal. Con el panel **cerrado**, un punto en el botón 🧠 te avisa que hubo un cambio sin que tengas que abrirlo para enterarte.
- **Semilla inicial**: la primera vez que se crea el cerebro de un workspace, arranca listando las terminales que ya tenía (título, shell, carpeta) — no en blanco.
- **Repasar a mitad de sesión**: el botón "🔄 Repasar con los agentes" del panel les pide a todas las terminales-agente del workspace que relean el cerebro ahora mismo, sin reiniciarlas (se entrega recién cuando cada una esté libre, nunca interrumpe una tarea en curso).
- **Respaldo automático**: antes de que cualquier cambio (tuyo o de un agente reescribiendo el archivo entero) reemplace el contenido anterior, Wingdeck guarda una copia — "↺ Restaurar versión anterior" la trae de vuelta, y es reversible (podés alternar entre las dos versiones).
- **Enlace en el `CLAUDE.md` de cada proyecto**: al arrancar una terminal con comando de arranque, Wingdeck agrega (o crea) un bloque delimitado en el `CLAUDE.md` de esa carpeta apuntando al cerebro del workspace — así el proyecto lo sabe de entrada, no solo por el mensaje inyectado al arrancar. No toca el resto del archivo si ya tenías contenido ahí, y es idempotente (no se duplica en reinicios sucesivos).
- El botón **🧠 Memoria** en la barra superior abre el panel de edición del workspace activo.

### Integración con Graphify (grafo de código)

[Graphify](https://github.com/Graphify-Labs/graphify) es una herramienta externa (no
incluida, la instala cada agente/usuario por su cuenta) que genera un grafo de código
navegable de un proyecto. Wingdeck no la ejecuta ni la empaqueta — solo sugiere su uso a los
agentes y da un atajo para ver el resultado si ya existe:

- **Sugerencia automática por cola**: toda terminal con comando de arranque (⚡) recibe, apenas el agente queda listo, un mensaje encolado sobre Graphify — antes que el mensaje del cerebro del workspace, así el orden final de entrega es cerebro → Graphify → tus prompts. Si la carpeta no tiene `graphify-out/graph.json`, sugiere generarlo con `graphify .`; si ya existe, sugiere usar `graphify query/explain/path` en vez de releer archivos sueltos.
- **Botón 🕸 por terminal**: aparece junto a ⚡ cuando existe `graphify-out/graph.html` en la carpeta actual de esa terminal (se revisa cada 10s, sigue al `cd` en vivo) y lo abre con el programa por defecto del sistema.
- **Referencia en el cerebro del workspace**: si al crearse el cerebro de un workspace alguna de sus terminales ya tiene un grafo generado, la semilla inicial lo lista junto a esa terminal.

### Retomar sesión de agente

Claude Code, Qwen Code y OpenCode guardan sus propias sesiones en disco. Wingdeck las
lee (sin ejecutar ningún CLI) y te las ofrece para no repetir `claude` → esperar →
`/resume` → elegir cada vez que volvés a una carpeta donde ya trabajaste.

- **Automático**: al abrir una terminal en una carpeta con historial de agentes, aparece un panel con las sesiones previas (agente, título, hace cuánto) y las opciones **Retomar**, **Nueva con \<agente\>**, **Otra herramienta ▾** o **Cerrar**. Mientras decidís, el comando de arranque (⚡) queda en pausa — nunca se escribe nada hasta que elegís, así que jamás se manda por error dentro de un agente ya corriendo.
- **Manual**: menú contextual (clic derecho) → "Sesiones anteriores…", disponible en cualquier terminal en cualquier momento.
- **"No volver a preguntar en esta terminal"**: se recuerda por terminal (reversible: basta con usar la entrada manual de nuevo).
- No se piden sesiones para terminales WSL en esta versión.

### Configuración inicial

La primera vez que abrís Wingdeck aparece un asistente que revisa qué CLIs de agente
tenés instalados (Claude Code, Qwen Code, OpenCode):

- Si falta alguno, te muestra el comando de instalación (`npm install -g ...`) listo para copiar.
- Si ya está instalado, un botón abre una terminal nueva con ese CLI listo para que
  inicies sesión vos mismo — **ninguna credencial pasa por Wingdeck**, cada CLI maneja
  su propio login (navegador, API key, etc.) exactamente igual que si lo corrieras a mano.
- Podés repetirlo cuando quieras desde **⚙ Ajustes → "Repetir configuración inicial"**.

## Instalación

Descargá el instalador (`Wingdeck Setup x.x.x.exe`) desde
[Releases](https://github.com/kenshin1986/Wingdeck/releases) y ejecutalo — es un NSIS
estándar de Windows (podés elegir la carpeta de instalación). Al abrir Wingdeck por
primera vez te va a recibir el asistente de configuración inicial descripto arriba.

### Desde el código fuente

```powershell
npm install
npm run dev      # desarrollo con hot-reload
npm start        # compilar y ejecutar
npm run dist     # generar el instalador de Windows (dist/)
```

- `+ Terminal` en la barra superior abre el menú de shells; el icono 📁 permite elegir la carpeta inicial.
- Doble clic en el título de una terminal para renombrarla.
- `↻` reinicia el shell de esa terminal (en su carpeta actual); `✕` la elimina de la sesión.

La sesión se guarda en `%APPDATA%/orq-terminal/session.json` (la carpeta conserva el
nombre interno `orq-terminal` desde antes del rebrand a Wingdeck, para no perder
sesiones/cerebros/plantillas ya guardados).
