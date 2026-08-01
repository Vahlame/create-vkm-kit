# Guía de skills: cuál usar, cuándo, y cuándo no

El kit instala **ocho skills** en `~/.claude/skills/`. Cada una se dispara sola cuando su
`description` coincide con lo que pediste, y también podés invocarlas a mano (`/vkm-spec`,
`/vkm-design`, …). Esta guía existe porque la pregunta cara no es "qué hace cada una" sino
**cuál corresponde ahora** — y sobre todo cuál **no**, porque una skill que se mete donde no
va empeora el resultado en vez de mejorarlo.

Regla de oro: **una skill no reemplaza tu criterio ni el del modelo**. Si pediste algo con
un alcance concreto, ese alcance gana siempre (regla de arbitraje).

## El mapa en una línea

| Skill             | Se usa cuando…                                                                            | Entrega                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `/vkm-spec`       | la idea todavía es vaga y **codificar sería adivinar**                                    | una spec testeable, anclada al vault, validada por máquina                    |
| `/vkm-discipline` | ya sabés qué hacer y hay que **hacerlo bien**: código, datos, infra, docs, PR, postmortem | el trabajo hecho + evidencia ejecutada de que funciona                        |
| `/vkm-design`     | hay algo que **se ve**: UI, pantalla, componente, gráfico, marca, diagrama                | una dirección de diseño con nombre, checks computados, loop visual            |
| `/vkm-verify`     | algo dio **verde** y estás por creerle: "tests pasan", "CI verde", "quedó commiteado"     | un veredicto: PROVEN · VACUOUS · DIRTY                                        |
| `/vkm-research`   | hay un banco `RESEARCH/<tema>` con fuentes sin consolidar                                 | un `summary.md` con wikilinks, supersesión y fuentes marcadas                 |
| `/vkm-intake`     | la tarea es **no trivial** y arrancar mal saldría caro: prompt/imágenes/contexto          | objetivo/entregable/no-hacer en 3 líneas + contexto mínimo cargado            |
| `/vkm-ui-judge`   | una GUI **se ve mal** (web, Flutter o nativa): contraste, dark mode, responsive           | defectos medidos (audit/tests/screenshots reales) + arreglo con antes/después |
| `/vkm-seo`        | una web debe **posicionar**: sinónimos/variantes/ubicaciones, técnica, búsqueda con IA    | cobertura semántica + audit estático antes/después (`seo-audit.mjs`)          |

## El orden natural de un trabajo real

```text
idea vaga ──/vkm-spec──▶ spec ──/vkm-discipline──▶ implementación ──/vkm-verify──▶ "listo" defendible
                                      │
                                      └── si hay UI de por medio ──/vkm-design──▶ dirección + checks
```

`/vkm-research` corre en paralelo a todo eso: alimenta el vault con material consolidado que
`/vkm-spec` después usa como contexto (una sola llamada a `assemble_context`).

## Cuándo NO usar cada una

Esta mitad importa más que la otra.

**`/vkm-spec`** — no la uses para un cambio de una línea, para un bug con causa conocida, ni
cuando ya trajiste vos el alcance escrito. Especificar lo obvio es puro costo.

**`/vkm-discipline`** — no la uses para un typo, un rename o un bump de versión; tampoco para
preguntas, explicaciones, recaps de chat, ni cuando pediste explícitamente "dos opciones y
elijo yo" (ahí el alcance lo pusiste vos). Su propia `description` excluye esos casos a
propósito: una skill que se dispara en todo hace peor al modelo, no mejor.

**`/vkm-design`** — no la uses para lógica sin superficie visible, ni para "poné este texto
en negrita". Sí para cualquier cosa que alguien vaya a _mirar_, aunque no digas la palabra
"diseño".

**`/vkm-verify`** — no la uses para escribir tests nuevos (eso es `/vkm-discipline`), ni para
depurar algo que **ya está rojo**: ahí el problema es visible y el trabajo es arreglarlo. Es
para el verde sospechoso, no para el rojo.

**`/vkm-research`** — no la uses para buscar en la web (eso son las tools `obscura_*`) ni para
resumir un solo documento. Es específicamente el paso de **consolidación** de un banco que ya
tiene fuentes persistidas.

**`/vkm-intake`** — no la uses para ediciones de una línea ni cuando el alcance ya viene
cerrado y claro: reformular lo obvio es puro costo. Es para arranques donde equivocarse de
entregable saldría caro.

**`/vkm-ui-judge`** — no la uses para diseñar desde cero (eso es `/vkm-design`) ni para
lógica sin superficie visible. Es para GUIs que **ya existen** y se ven mal.

**`/vkm-seo`** — no la uses para entregables que no sean web ni para campañas de anuncios
(SEM). Y ojo: no promete posiciones — promete los insumos medibles (audit limpio, cobertura
hecha); prometer rankings es el humo que esta skill existe para evitar.

## Las tres que se confunden

- **`/vkm-discipline` vs `/vkm-verify`.** `discipline` termina en evidencia ejecutada:
  corre los checks del proyecto y reporta. `verify` pregunta lo siguiente: _¿ese check
  sabe fallar?_ Usá `verify` cuando el verde llegó demasiado fácil, cuando el guard nunca
  falló ni una vez, o cuando el síntoma que reportaste sigue ahí pese al verde.
- **`/vkm-spec` vs `/vkm-discipline`.** Si la pregunta es "¿qué hay que construir?", es
  `spec`. Si es "¿cómo lo construyo bien?", es `discipline`. Un plan para algo que ya está
  decidido es ceremonia.
- **`/vkm-design` vs `/vkm-discipline`.** Si el resultado se juzga con los ojos, `design`
  manda; si se juzga con un test, `discipline`. En una pantalla real suelen ir las dos:
  `design` decide la dirección, `discipline` la implementa y la prueba.

## Ejemplos concretos

| Lo que pedís                                         | Skill             | Por qué                                              |
| ---------------------------------------------------- | ----------------- | ---------------------------------------------------- |
| "quiero que la app avise cuando baje el stock"       | `/vkm-spec`       | no hay alcance todavía; codificar sería adivinar     |
| "implementá el endpoint de reposición según la spec" | `/vkm-discipline` | alcance cerrado, hay que ejecutarlo con evidencia    |
| "el dashboard se ve genérico"                        | `/vkm-design`     | el juicio es visual                                  |
| "los tests pasan, ¿mergeamos?"                       | `/vkm-verify`     | verde por confirmar antes de una acción irreversible |
| "consolidá lo que investigamos de pricing"           | `/vkm-research`   | banco `RESEARCH/` con fuentes sin unificar           |
| "arreglá el typo del README"                         | ninguna           | una línea; las skills son costo sin retorno acá      |
| "¿por qué falla este test?" (ya está rojo)           | `/vkm-discipline` | es depuración, no verificación de un verde           |

## Costo

La `description` de cada skill está **siempre** en contexto (por eso el kit las mantiene
cortas, con un tope duro en CI); el cuerpo se carga **solo** cuando la skill se activa. Ocho
skills instaladas no son ocho cuerpos en cada sesión: son ocho descripciones y, como mucho,
un cuerpo cuando hace falta.

Si el estilo de una skill te estorba en un trabajo puntual, decilo y listo — tu instrucción
del chat gana sobre cualquier skill.
