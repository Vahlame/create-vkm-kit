// Assembles the "Specimen Cabinet" proof page: faithful traced silhouettes from real
// references, each with its measured IoU fidelity and reference credit.
import { readFileSync, writeFileSync } from "node:fs";

// Only specimens whose CLEAN reference traced faithfully survive (IoU ≥ ~0.7, content-normalized).
// Busy-background aquarium photos (tarpon/machaca/bee) and holed objects (scissors/trumpet) were
// dropped by the verify gate — you cannot threshold a subject out of a cluttered scene, and
// fill-holes closes meaningful gaps. That IS the lesson: trace CLEAN references, verify, and drop
// what won't come out faithful rather than ship artifacts.
const specimens = [
  {
    key: "tuna",
    name: "Atún aleta amarilla",
    sci: "Thunnus albacares",
    cat: "Pez",
    iou: 0.89,
    ref: "PhyloPic (CC0)",
    stroke: "#1b3a2b"
  },
  {
    key: "trout",
    name: "Trucha común",
    sci: "Salmo trutta",
    cat: "Pez",
    iou: 0.87,
    ref: "Wikimedia (CC)",
    stroke: "#2b4a3a"
  },
  {
    key: "fedora",
    name: "Sombrero fedora",
    sci: "objeto — fieltro",
    cat: "Objeto",
    iou: 0.98,
    ref: "Wikimedia (CC)",
    stroke: "#3a2d22"
  },
  {
    key: "teapot",
    name: "Tetera",
    sci: "objeto — loza",
    cat: "Objeto",
    iou: 0.74,
    ref: "Wikimedia (CC)",
    stroke: "#5a2d2d"
  },
  {
    key: "bicycle",
    name: "Bicicleta",
    sci: "objeto — acero",
    cat: "Objeto",
    iou: 0.64,
    ref: "Wikimedia (CC)",
    stroke: "#3a3226"
  }
];

const dir = process.argv[2];

const cards = specimens
  .map((s) => {
    // Traces are produced with `--square` (already cropped to content, centred, padded), so the
    // grid just fills identical cells — alignment is baked into the asset, no per-page fixup.
    let svg = readFileSync(`${dir}/${s.key}-trace.svg`, "utf8").trim();
    svg = svg.replace(/\s+width="\d+"\s+height="\d+"/, ' width="100%" height="100%"');
    const grade = s.iou >= 0.85 ? "a" : s.iou >= 0.75 ? "b" : "c";
    return `<figure class="plate">
      <span class="no">${s.cat}</span>
      <div class="art">${svg}</div>
      <figcaption>
        <b>${s.name}</b><i>${s.sci}</i>
        <div class="meta">
          <span class="fid fid-${grade}">fidelidad ${s.iou.toFixed(2)}</span>
          <span class="src">ref: ${s.ref}</span>
        </div>
      </figcaption>
    </figure>`;
  })
  .join("\n");

const html = `<title>El Gabinete — ilustración fiel por trazado de referencia</title>
<style>
:root{
  --paper:oklch(0.96 0.015 85); --paper-2:oklch(0.93 0.02 85);
  --ink:oklch(0.26 0.03 90); --ink-soft:oklch(0.45 0.04 90); --hair:oklch(0.8 0.03 90);
  --rust:oklch(0.5 0.14 35); --forest:oklch(0.38 0.08 150); --river:oklch(0.45 0.09 230);
  --serif:Georgia,'Times New Roman',serif; --mono:ui-monospace,'Cascadia Code',monospace;
  --s1:8px;--s2:16px;--s3:24px;--s4:32px;--s5:48px;--s6:64px;
}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--paper);color:var(--ink);font-family:var(--serif);line-height:1.6;
  background-image:radial-gradient(oklch(0.6 0.04 85 / .05) 1px,transparent 1px);background-size:6px 6px}
.wrap{max-width:1120px;margin:0 auto;padding:var(--s6) var(--s4)}
header{border-bottom:2px solid var(--ink);padding-bottom:var(--s3);margin-bottom:var(--s5)}
.kicker{font-family:var(--mono);font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--rust)}
h1{font-size:clamp(32px,5vw,52px);font-weight:600;letter-spacing:-.01em;margin-top:var(--s2);line-height:1.05}
h1 em{font-style:italic;color:var(--forest)}
.lede{margin-top:var(--s3);max-width:64ch;color:var(--ink-soft);font-size:18px}
.lede b{color:var(--ink)}
.method{font-family:var(--mono);font-size:13px;color:var(--ink-soft);margin-top:var(--s3);border-left:3px solid var(--forest);padding-left:var(--s2)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:var(--s4);margin-top:var(--s5)}
.plate{border:2px solid var(--ink);background:var(--paper);position:relative;padding:var(--s3);display:flex;flex-direction:column}
.plate::after{content:"";position:absolute;inset:5px;border:1px solid var(--hair);pointer-events:none}
.no{position:absolute;top:-2px;right:var(--s3);background:var(--ink);color:var(--paper);font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;padding:3px 10px;z-index:1}
.art{display:flex;align-items:center;justify-content:center;height:200px;padding:var(--s2)}
.art svg{display:block;width:200px;height:200px}
figcaption{border-top:1px solid var(--hair);padding-top:var(--s2)}
figcaption b{font-size:19px;font-weight:600;display:block}
figcaption i{color:var(--ink-soft);font-size:14px}
.meta{display:flex;justify-content:space-between;align-items:center;margin-top:var(--s1);flex-wrap:wrap;gap:6px}
.fid{font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.06em;padding:2px 8px;border:1.5px solid}
.fid-a{color:var(--forest);border-color:var(--forest)}
.fid-b{color:var(--river);border-color:var(--river)}
.fid-c{color:var(--rust);border-color:var(--rust)}
.src{font-family:var(--mono);font-size:11px;color:var(--ink-soft)}
footer{margin-top:var(--s6);border-top:2px solid var(--ink);padding-top:var(--s3);font-family:var(--mono);font-size:12px;color:var(--ink-soft)}
@media(max-width:560px){.grid{grid-template-columns:1fr}}
</style>
<div class="wrap">
  <header>
    <p class="kicker">vkm-design · illustration.md · prueba en vivo</p>
    <h1>El Gabinete: ilustración <em>fiel por trazado</em>, no de memoria</h1>
    <p class="lede">Cada espécimen fue <b>trazado desde una referencia real limpia</b> con
      <code>trace-svg.mjs</code> (potrace), no ploteado a mano — y la máscara se <b>limpia</b>
      antes de trazar (mayor componente conectado, relleno de huecos, suavizado) para seguir la
      <b>forma</b>, no el ruido de la foto. La <b>fidelidad</b> es el IoU medido contra la
      referencia; 1.00 sería idéntico.</p>
    <p class="method">referencia limpia → máscara (Otsu) → limpiar → potrace → cuadrar (–square) → verificar IoU · los sujetos que no salían fieles (fondos cargados, objetos con agujeros) los descartó el gate, no se muestran artefactos</p>
  </header>
  <div class="grid">
    ${cards}
  </div>
  <footer>
    Trazas derivadas de referencias CC/CC0 (Wikimedia, PhyloPic) — línea original, sin copiar la expresión de la imagen fuente.
    El método completo vive en <code>references/illustration.md</code>.
  </footer>
</div>`;

writeFileSync(process.argv[3], html);
console.log("cabinet built:", specimens.length, "specimens");
