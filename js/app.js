"use strict";
/* ============================================================
   Nuestra historia — lógica de la página
   Guarda los datos en Supabase (si está configurado en js/config.js)
   o, si no, en el propio navegador (modo local).
   ============================================================ */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lines = (t) => (Array.isArray(t) ? t : String(t ?? "").split("\n")).map((x) => String(x).trim()).filter(Boolean);
const errMsg = (e) => (e && e.message) || String(e);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};

const TEXT_FIELDS = ["n1", "n2", "start", "carta", "amaT", "ama", "pregunta", "cierre"];
const LIST_FIELDS = ["lugares", "lista", "vales", "ruleta"];
const N_PHOTOS = 6;
const DEF = {
  n1: "Ella", n2: "Yo", start: "",
  carta: "Mi amor,\n\nCada vez que te miro siento mariposas en la barriga. Eres lo mejor que me ha pasado.\n\nGracias por ser tú.\n\nTe quiero.",
  amaT: "Lo que más amo de ti",
  ama: "Nuestras sonrisas, el humor que compartimos, la forma en que nos queremos…",
  lugares: ["Donde nos conocimos", "Nuestro sitio favorito", "De viaje"],
  lista: ["Viajar juntos", "Ver el amanecer", "Una escapada de fin de semana", "Un concierto", "Cocinar juntos"],
  vales: ["Vale por un beso", "Vale por un abrazo fuerte", "Vale por un masaje", "Vale por la película que elijas", "Vale por desayuno en la cama", "Vale por una noche sin teléfono", "Vale por 30 minutos de mimos", "Vale por elegir la playlist"],
  ruleta: ["Cena en casa", "Paseo al atardecer", "Cine", "Escapada"],
  pregunta: "¿A dónde me llevarías en nuestro primer viaje?",
  cierre: "Por todo\nlo que somos.\nTe amo.",
  photos: [],
  audio: null, // { ref, name }
};

let cfg = normalize(null);
let estado = { usados: [] };
let store = null;   // adaptador de almacenamiento
let sb = null;      // cliente Supabase
let session = null; // sesión del editor
let draft = null;   // copia en edición
let hadCfg = false;

function normalize(c) {
  const o = { ...DEF, ...(c || {}) };
  LIST_FIELDS.forEach((k) => (o[k] = lines(o[k])));
  const p = Array.isArray(o.photos) ? o.photos : [];
  o.photos = Array.from({ length: N_PHOTOS }, (_, i) => p[i] || null);
  if (o.audio && !o.audio.ref) o.audio = null;
  return o;
}
const now = () => new Date().toISOString();
const resolve = (ref) => (store ? store.resolve(ref) : Promise.resolve(ref || ""));

/* ============================================================
   Almacenamiento
   ============================================================ */

function createLocalStore() {
  const K_CFG = "nh:cfg", K_EST = "nh:estado";
  const urls = new Map();
  let dbp = null;
  const idb = () => (dbp ??= new Promise((res, rej) => {
    const q = indexedDB.open("nuestra-historia", 1);
    q.onupgradeneeded = () => q.result.createObjectStore("media");
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  }));
  const tx = async (mode, fn) => {
    const db = await idb();
    return new Promise((res, rej) => {
      const t = db.transaction("media", mode);
      const r = fn(t.objectStore("media"));
      t.oncomplete = () => res(r && r.result);
      t.onerror = () => rej(t.error);
    });
  };
  const getEst = () => ({ usados: [], ...(ls.get(K_EST) || {}) });
  const putEst = (e) => { ls.set(K_EST, e); return e; };
  return {
    remote: false,
    async load() { return { cfg: ls.get(K_CFG), estado: getEst() }; },
    async saveCfg(c) { if (!ls.set(K_CFG, c)) throw new Error("no queda espacio en el navegador"); },
    async saveEstado(e) { putEst(e); },
    async redeem(v) { const e = getEst(); if (!e.usados.includes(v)) e.usados.push(v); return putEst(e); },
    async answer(t) { return putEst({ ...getEst(), respuesta: t, respuesta_at: now() }); },
    async spin(o) { return putEst({ ...getEst(), ruleta: o, ruleta_at: now() }); },
    async upload(blob, kind) {
      const key = `idb:${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await tx("readwrite", (s) => s.put(blob, key));
      return key;
    },
    async resolve(ref) {
      if (!ref || !ref.startsWith("idb:")) return ref || "";
      if (!urls.has(ref)) {
        const blob = await tx("readonly", (s) => s.get(ref)).catch(() => null);
        urls.set(ref, blob ? URL.createObjectURL(blob) : "");
      }
      return urls.get(ref);
    },
  };
}

function createRemoteStore(client) {
  const ROW = "main";
  const rpc = async (fn, args) => {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw error;
    return data || {};
  };
  const update = async (patch) => {
    const { data, error } = await client.from("pagina").update({ ...patch, updated_at: now() }).eq("id", ROW).select("id");
    if (error) throw error;
    if (!data || !data.length) throw new Error("sin permiso para guardar (¿has iniciado sesión?)");
  };
  return {
    remote: true,
    async load() {
      const { data, error } = await client.from("pagina").select("cfg,estado").eq("id", ROW).maybeSingle();
      if (error) throw error;
      return data || {};
    },
    saveCfg: (c) => update({ cfg: c }),
    saveEstado: (e) => update({ estado: e }),
    redeem: (v) => rpc("canjear_vale", { vale: v }),
    answer: (t) => rpc("guardar_respuesta", { texto: t }),
    spin: (o) => rpc("guardar_ruleta", { opcion: o }),
    async upload(blob, kind, ext) {
      const safeExt = /^[a-z0-9]{1,5}$/.test(ext || "") ? ext : "bin";
      const path = `${kind}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
      const { error } = await client.storage.from("media").upload(path, blob, {
        contentType: blob.type || "application/octet-stream", cacheControl: "31536000", upsert: false,
      });
      if (error) throw error;
      return client.storage.from("media").getPublicUrl(path).data.publicUrl;
    },
    async resolve(ref) { return ref || ""; },
  };
}

async function initBackend() {
  const conf = window.APP_CONFIG || {};
  const supabaseUrl = String(conf.supabaseUrl || "").trim().replace(/\/(rest|auth|storage)\/v1\/?.*$/, "").replace(/\/+$/, "");
  const supabaseAnonKey = String(conf.supabaseAnonKey || "").trim();
  if (!supabaseUrl || !supabaseAnonKey) return createLocalStore();
  if (!window.supabase || !window.supabase.createClient) throw new Error("No se pudo cargar la conexión con la base de datos. Revisa tu conexión a internet.");
  sb = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
  const { data } = await sb.auth.getSession();
  session = data.session;
  sb.auth.onAuthStateChange((_ev, s) => { session = s; updateFab(); });
  return createRemoteStore(sb);
}

async function refresh() {
  if (!store) return;
  try {
    const d = await store.load();
    hadCfg = !!(d.cfg && Object.keys(d.cfg).length);
    cfg = normalize(d.cfg);
    estado = { usados: [], ...(d.estado || {}) };
  } catch (e) {
    console.error(e);
    toast("No se pudieron cargar los datos: " + errMsg(e), "error");
  }
}

/* ============================================================
   Pintar la página
   ============================================================ */

function render() {
  const c = cfg;
  $("gN").textContent = c.n1;
  $("rN").textContent = c.n1;
  $("title").innerHTML = `${esc(c.n2)} <span class="amp">&amp;</span> ${esc(c.n1)}`;
  document.title = `${c.n2} & ${c.n1} · Nuestra historia`;
  $("amaT").textContent = c.amaT;
  $("ama").textContent = c.ama;
  $("q").textContent = c.pregunta;
  $("cierre").textContent = c.cierre;
  $("firma").textContent = c.n2;
  $("lugares").innerHTML = c.lugares.map((x) => `<span class="chip">📍 ${esc(x)}</span>`).join("");
  $("lista").innerHTML = c.lista.map((x) => `<li>${esc(x)}</li>`).join("");
  renderVales();
  buildWheel();
  renderAnswerBox();
  renderPhotos();
  renderMusic();
  tick();
}

function renderAnswerBox() {
  const r = $("resp");
  if (document.activeElement !== r) r.value = estado.respuesta || "";
  $("rok").textContent = estado.respuesta ? "Respuesta guardada ✓" : "";
  $("lastSpin").textContent = estado.ruleta ? `Última vez salió: ${estado.ruleta}` : "";
}

async function renderPhotos() {
  await Promise.all(cfg.photos.map(async (ref, i) => {
    const el = $(`ph${i + 1}`);
    const url = ref ? await resolve(ref) : "";
    if (!url) { el.innerHTML = ""; return; }
    el.innerHTML = `<button class="photo-btn" type="button" aria-label="Ver foto ${i + 1} en grande"><img class="photo" src="${esc(url)}" alt="Foto ${i + 1}" loading="lazy" decoding="async"></button>`;
    el.firstChild.addEventListener("click", () => openLightbox(url));
  }));
}

function renderVales() {
  const used = new Set(estado.usados || []);
  $("vales").innerHTML = cfg.vales.map((v, i) => {
    const u = used.has(v);
    return `<div class="vale${u ? " u" : ""}"><span>🎟️ ${esc(v)}</span><button class="btn g" type="button" data-vale="${i}"${u ? " disabled" : ""}>${u ? "Usado" : "Canjear"}</button></div>`;
  }).join("");
}

async function redeem(i) {
  const v = cfg.vales[i];
  if (!v || (estado.usados || []).includes(v)) return;
  if (!confirm(`¿Canjear «${v}»?\nSolo se puede usar una vez.`)) return;
  const prev = estado;
  estado = { ...estado, usados: [...(estado.usados || []), v] };
  renderVales();
  confetti(16);
  try { estado = { usados: [], ...(await store.redeem(v)) }; renderVales(); }
  catch (e) { estado = prev; renderVales(); toast("No se pudo canjear: " + errMsg(e), "error"); }
}

/* ---------- Contador ---------- */
function tick() {
  const set = (d, h, m, s) => { $("d").textContent = d; $("h").textContent = h; $("m").textContent = m; $("s").textContent = s; };
  if (!cfg.start) { set(0, 0, 0, 0); $("ym").textContent = store ? "Configura la fecha en ✏️ Editar" : ""; return; }
  const t0 = new Date(cfg.start), n = new Date(), ms = n - t0;
  if (isNaN(ms)) return;
  if (ms < 0) { set(0, 0, 0, 0); $("ym").textContent = "Nuestra historia está a punto de empezar 💫"; return; }
  set(Math.floor(ms / 864e5), Math.floor(ms / 36e5) % 24, Math.floor(ms / 6e4) % 60, Math.floor(ms / 1e3) % 60);
  let y = n.getFullYear() - t0.getFullYear(), mo = n.getMonth() - t0.getMonth();
  if (n.getDate() < t0.getDate()) mo--;
  if (mo < 0) { y--; mo += 12; }
  const parts = [];
  if (y > 0) parts.push(`${y} ${y === 1 ? "año" : "años"}`);
  parts.push(`${mo} ${mo === 1 ? "mes" : "meses"}`);
  $("ym").textContent = `${parts.join(" y ")} de nosotros`;
}

/* ---------- Ruleta ---------- */
let rot = 0, opts = [];
function buildWheel() {
  opts = cfg.ruleta.slice(0, 8);
  if (opts.length < 2) opts = ["Cena", "Paseo"];
  const n = opts.length, seg = 360 / n, cols = ["#e05a77", "#f08fa3", "#c9425f", "#f4a6b6"];
  const color = (i) => cols[i > 0 && i === n - 1 && i % 4 === 0 ? 1 : i % 4]; // evita que el último y el primero coincidan
  $("wh").style.background = `conic-gradient(${opts.map((_, i) => `${color(i)} ${i * seg}deg ${(i + 1) * seg}deg`).join(",")})`;
  $("wh").innerHTML = opts.map((o, i) => `<i style="transform:rotate(${i * seg + seg / 2}deg)"><b>${esc(o)}</b></i>`).join("");
}
function spin() {
  const n = opts.length, seg = 360 / n, btn = $("spin");
  rot += 1440 + Math.random() * 360;
  $("wh").style.transform = `rotate(${rot}deg)`;
  btn.disabled = true;
  setTimeout(() => {
    const a = (360 - (rot % 360)) % 360, opt = opts[Math.floor(a / seg) % n];
    $("rs").textContent = `${opt} — ya no hay marcha atrás 😌`;
    openModal("rm");
    btn.disabled = false;
    confetti(30);
    estado = { ...estado, ruleta: opt };
    renderAnswerBox();
    store && store.spin(opt).then((e) => (estado = { usados: [], ...e })).catch((e) => console.warn(e));
  }, reduceMotion ? 300 : 4100);
}

/* ---------- Respuesta ---------- */
async function saveResp() {
  const v = $("resp").value.trim(), btn = $("saveResp");
  if (!v) { toast("Escribe algo antes de guardar 💭", "error"); return; }
  btn.disabled = true;
  try {
    estado = { usados: [], ...(await store.answer(v)) };
    $("rok").textContent = "Guardada ✓ Gracias, mi amor 💖";
    confetti(40);
  } catch (e) { toast("No se pudo guardar: " + errMsg(e), "error"); }
  finally { btn.disabled = false; }
}

/* ---------- Música ---------- */
const audio = new Audio();
audio.loop = true;
audio.preload = "metadata";
audio.volume = (() => { const v = ls.get("nh:vol"); return typeof v === "number" && v >= 0 && v <= 1 ? v : 0.8; })();
let audioRef = null;

async function renderMusic() {
  const a = cfg.audio;
  if (!a) { $("plsec").hidden = true; audio.pause(); audio.removeAttribute("src"); audioRef = null; return; }
  $("plsec").hidden = false;
  $("songName").textContent = (a.name || "").replace(/\.[^.]+$/, "") || "Nuestra canción";
  if (audioRef !== a.ref) { audioRef = a.ref; audio.src = await resolve(a.ref); }
}
function playMusic() { if (audio.src) audio.play().catch(() => {}); }
function playerUi() {
  $("pbtn").textContent = audio.paused ? "▶" : "⏸";
  $("pbtn").setAttribute("aria-label", audio.paused ? "Reproducir" : "Pausar");
  const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
  $("pbar").style.width = pct + "%";
  $("pbarWrap").setAttribute("aria-valuenow", Math.round(pct));
}
["play", "pause", "timeupdate", "loadedmetadata"].forEach((ev) => audio.addEventListener(ev, playerUi));

/* ============================================================
   Ventanas, avisos y efectos
   ============================================================ */

let lastFocus = null;
function openModal(id) {
  lastFocus = document.activeElement;
  const m = $(id);
  m.classList.add("on");
  document.body.style.overflow = "hidden";
  const f = m.querySelector("input, textarea, button");
  if (f) setTimeout(() => f.focus({ preventScroll: true }), 50);
}
function closeModal(id) {
  $(id).classList.remove("on");
  if (!document.querySelector(".mod.on")) document.body.style.overflow = "";
  if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
}
function openLightbox(url) { $("lbImg").src = url; openModal("lb"); }

function toast(text, type = "ok") {
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.setAttribute("role", type === "error" ? "alert" : "status");
  t.textContent = text;
  $("toasts").appendChild(t);
  setTimeout(() => t.classList.add("out"), type === "error" ? 6000 : 3200);
  setTimeout(() => t.remove(), type === "error" ? 6500 : 3700);
}

function confetti(n) {
  if (reduceMotion) return;
  const c = ["#e05a77", "#f6c9d3", "#ffd166", "#f27b95"], ch = ["♥", "💖", "✨", "🌸"];
  for (let i = 0; i < n; i++) {
    const e = document.createElement("div");
    e.className = "cf";
    e.textContent = ch[i % 4];
    e.style.left = Math.random() * 100 + "vw";
    e.style.fontSize = 12 + Math.random() * 18 + "px";
    e.style.color = c[i % 4];
    e.style.animationDuration = 2 + Math.random() * 2.5 + "s";
    document.body.appendChild(e);
    setTimeout(() => e.remove(), 5000);
  }
}
function floaters() {
  if (reduceMotion) return;
  const f = $("fl");
  for (let i = 0; i < 16; i++) {
    const s = document.createElement("span");
    s.textContent = ["♥", "✿", "♡"][i % 3];
    s.style.left = Math.random() * 100 + "%";
    s.style.fontSize = 12 + Math.random() * 20 + "px";
    s.style.animationDuration = 14 + Math.random() * 14 + "s";
    s.style.animationDelay = -Math.random() * 20 + "s";
    f.appendChild(s);
  }
}

function openGate() {
  const g = $("gate");
  if (g.disabled) return;
  playMusic();
  g.style.opacity = 0;
  setTimeout(() => (g.hidden = true), 700);
  confetti(24);
}
function hideGate() { $("gate").hidden = true; }

/* ============================================================
   Editor
   ============================================================ */

function updateFab() {
  $("fab").hidden = !(store && (!store.remote || session || location.hash === "#editar"));
}

function requestEdit() {
  if (!store) { toast("No hay conexión con la base de datos.", "error"); return; }
  if (store.remote && !session) { $("l_err").textContent = ""; openModal("login"); return; }
  openEditor();
}

async function openEditor() {
  if (store.remote) {
    try { const d = await store.load(); estado = { usados: [], ...(d.estado || {}) }; } catch { /* usamos lo que ya hay */ }
  }
  draft = structuredClone(cfg);
  fillEditor();
  openModal("ed");
}

function fillEditor() {
  [...TEXT_FIELDS, ...LIST_FIELDS].forEach((k) => {
    const v = draft[k];
    $("e_" + k).value = Array.isArray(v) ? v.join("\n") : v ?? "";
  });
  renderSlots();
  renderAudioSlot();
  renderAnswers();
  $("logout").hidden = !(store.remote && session);
  $("modeHint").textContent = store.remote
    ? "Los cambios se guardan en la nube: los verá cualquiera que abra la página, desde cualquier dispositivo."
    : "Modo local: los cambios solo se guardan en este navegador. Configura Supabase (ver README) para guardarlos en la nube.";
}

function readEditorFields() {
  TEXT_FIELDS.forEach((k) => (draft[k] = $("e_" + k).value.trim()));
  LIST_FIELDS.forEach((k) => (draft[k] = lines($("e_" + k).value)));
}

const fmtDate = (iso) => { try { return new Date(iso).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" }); } catch { return ""; } };
function renderAnswers() {
  const e = estado, out = [];
  out.push(e.respuesta
    ? `<p><b>Su respuesta</b>${e.respuesta_at ? ` · ${esc(fmtDate(e.respuesta_at))}` : ""}</p><blockquote>${esc(e.respuesta)}</blockquote>`
    : `<p>Todavía no ha respondido a la pregunta.</p>`);
  if (e.ruleta) out.push(`<p><b>Ruleta:</b> ${esc(e.ruleta)}${e.ruleta_at ? ` · ${esc(fmtDate(e.ruleta_at))}` : ""}</p>`);
  const u = e.usados || [];
  out.push(`<p><b>Vales canjeados:</b> ${u.length ? u.map(esc).join(", ") : "ninguno todavía"}</p>`);
  $("answers").innerHTML = out.join("");
}

async function resetVales() {
  if (!confirm("¿Volver a dejar todos los vales sin usar?")) return;
  try { estado = { ...estado, usados: [] }; await store.saveEstado(estado); renderVales(); renderAnswers(); toast("Vales reiniciados ✓"); }
  catch (e) { toast("No se pudo: " + errMsg(e), "error"); }
}

/* ---------- Archivos ---------- */
function pickFile(accept) {
  return new Promise((res) => {
    const f = document.createElement("input");
    f.type = "file";
    f.accept = accept;
    f.onchange = () => res(f.files[0] || null);
    f.click();
  });
}
function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error("formato de imagen no compatible (prueba con JPG o PNG)"));
    im.src = src instanceof Blob ? URL.createObjectURL(src) : src;
  });
}
async function compressImage(file, max = 1600, q = 0.82) {
  const im = await loadImage(file);
  const k = Math.min(1, max / Math.max(im.width, im.height));
  const c = document.createElement("canvas");
  c.width = Math.round(im.width * k);
  c.height = Math.round(im.height * k);
  c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
  URL.revokeObjectURL(im.src);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("no se pudo procesar la imagen"))), "image/jpeg", q));
}
const extOf = (name, fb) => { const m = /\.([a-z0-9]{1,5})$/i.exec(name || ""); return m ? m[1].toLowerCase() : fb; };
const AUDIO_MIME = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", wav: "audio/wav", opus: "audio/ogg" };

function renderSlots() {
  const box = $("slots");
  box.innerHTML = draft.photos.map((_, i) => `<div class="slot" data-slot="${i}" role="button" tabindex="0" aria-label="Elegir foto ${i + 1}">+ Foto ${i + 1}</div>`).join("");
  draft.photos.forEach(async (ref, i) => {
    if (!ref) return;
    const url = await resolve(ref);
    const el = box.children[i];
    if (!el || draft.photos[i] !== ref) return;
    el.style.backgroundImage = `url("${url.replace(/"/g, "%22")}")`;
    el.innerHTML = `<button type="button" class="x" data-del="${i}" aria-label="Quitar foto ${i + 1}">×</button>`;
  });
}
async function pickPhoto(i) {
  const file = await pickFile("image/*");
  if (!file) return;
  const el = $("slots").children[i];
  el.classList.add("busy");
  el.textContent = "Subiendo…";
  try { draft.photos[i] = await store.upload(await compressImage(file), "foto", "jpg"); }
  catch (e) { toast("No se pudo subir la foto: " + errMsg(e), "error"); }
  renderSlots();
}

function renderAudioSlot() {
  const a = draft.audio;
  $("aslot").innerHTML = a ? `🎵 ${esc(a.name)} <button type="button" class="x" data-del-audio aria-label="Quitar canción">×</button>` : "+ Subir canción (MP3, M4A…)";
}
async function pickAudio() {
  const file = await pickFile("audio/*");
  if (!file) return;
  if (file.size > 30e6) { toast("La canción pesa demasiado (máx. 30 MB).", "error"); return; }
  const slot = $("aslot");
  slot.classList.add("busy");
  slot.textContent = "Subiendo canción…";
  try { draft.audio = { ref: await store.upload(file, "cancion", extOf(file.name, "mp3")), name: file.name }; }
  catch (e) { toast("No se pudo subir la canción: " + errMsg(e), "error"); }
  slot.classList.remove("busy");
  renderAudioSlot();
}

/* ---------- Guardar ---------- */
async function saveEditor() {
  readEditorFields();
  if (draft.ruleta.length < 2) { toast("La ruleta necesita al menos 2 opciones.", "error"); return; }
  if (draft.ruleta.length > 8) { draft.ruleta = draft.ruleta.slice(0, 8); toast("La ruleta admite 8 opciones; he guardado las 8 primeras."); }
  if (document.querySelector("#ed .busy")) { toast("Espera a que terminen de subirse los archivos.", "error"); return; }
  const btn = $("saveEd");
  btn.disabled = true;
  btn.textContent = "Guardando…";
  try {
    await store.saveCfg(draft);
    cfg = normalize(draft);
    hadCfg = true;
    // Los vales canjeados se recuerdan por su texto: si borras uno, se limpia.
    const valid = (estado.usados || []).filter((v) => cfg.vales.includes(v));
    if (valid.length !== (estado.usados || []).length) {
      estado = { ...estado, usados: valid };
      await store.saveEstado(estado).catch(() => {});
    }
    closeModal("ed");
    render();
    confetti(20);
    toast("Cambios guardados ✓");
  } catch (e) {
    toast("No se pudo guardar: " + errMsg(e), "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Guardar";
  }
}

/* ---------- Copias e importación ---------- */
function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function exportBackup() {
  readEditorFields();
  const data = { version: 2, exportado: now(), cfg: draft, estado };
  download(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), `nuestra-historia-${now().slice(0, 10)}.json`);
}

async function importData() {
  const file = await pickFile(".html,.htm,.json,text/html,application/json");
  if (!file) return;
  const btn = $("importBtn");
  btn.disabled = true;
  try {
    const text = await file.text();
    const m = text.match(/<script id="seed" type="application\/json">([\s\S]*?)<\/script>/);
    const data = JSON.parse(m ? m[1] : text);
    if (!data || !data.cfg) throw new Error("el archivo no contiene datos. En la versión antigua usa «Exportar versión final».");
    toast("Importando… no cierres la página");
    const c = normalize({ ...draft, ...data.cfg });
    // Formato antiguo: fotos como data:URL y canción en base64
    if (Array.isArray(data.photos)) {
      for (let i = 0; i < N_PHOTOS; i++) {
        const p = data.photos[i];
        if (typeof p === "string" && p.startsWith("data:")) c.photos[i] = await store.upload(await (await fetch(p)).blob(), "foto", "jpg");
      }
    }
    if (data.audio && data.audio.b64) {
      const bin = atob(data.audio.b64), u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const name = data.audio.name || "cancion.mp3", ext = extOf(name, "mp3");
      c.audio = { ref: await store.upload(new Blob([u], { type: AUDIO_MIME[ext] || "audio/mpeg" }), "cancion", ext), name };
    }
    draft = c;
    fillEditor();
    toast("Datos importados. Revísalos y pulsa Guardar ✓");
  } catch (e) {
    toast("No se pudo importar: " + errMsg(e), "error");
  } finally {
    btn.disabled = false;
  }
}

function loadDefaults() {
  if (!confirm("¿Rellenar el formulario con los textos por defecto? (Las fotos y la canción se mantienen. No se guarda hasta que pulses Guardar.)")) return;
  draft = normalize({ photos: draft.photos, audio: draft.audio });
  fillEditor();
}

/* ---------- Acceso ---------- */
async function doLogin(ev) {
  ev.preventDefault();
  const btn = $("l_btn");
  btn.disabled = true;
  $("l_err").textContent = "";
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email: $("l_email").value.trim(), password: $("l_pw").value });
    if (error) throw error;
    session = data.session;
    $("l_pw").value = "";
    closeModal("login");
    updateFab();
    openEditor();
  } catch (e) {
    $("l_err").textContent = /invalid login/i.test(errMsg(e)) ? "Correo o contraseña incorrectos." : errMsg(e);
  } finally {
    btn.disabled = false;
  }
}
async function doLogout() {
  await sb.auth.signOut().catch(() => {});
  session = null;
  closeModal("ed");
  if (location.hash === "#editar") history.replaceState(null, "", location.pathname + location.search);
  updateFab();
  toast("Sesión cerrada");
}

/* ============================================================
   Eventos e inicio
   ============================================================ */

function bindEvents() {
  $("gate").addEventListener("click", openGate);
  $("openLetter").addEventListener("click", () => { $("lt").textContent = cfg.carta; $("lf").textContent = cfg.n2; openModal("lm"); });
  $("spin").addEventListener("click", spin);
  $("saveResp").addEventListener("click", saveResp);
  $("vales").addEventListener("click", (e) => { const b = e.target.closest("[data-vale]"); if (b) redeem(+b.dataset.vale); });
  $("fab").addEventListener("click", requestEdit);

  $("pbtn").addEventListener("click", () => (audio.paused ? playMusic() : audio.pause()));
  $("pbarWrap").addEventListener("click", (e) => {
    if (!audio.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
  });
  $("pbarWrap").addEventListener("keydown", (e) => {
    if (!audio.duration) return;
    if (e.key === "ArrowRight") audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
    if (e.key === "ArrowLeft") audio.currentTime = Math.max(0, audio.currentTime - 5);
  });
  $("vol").value = Math.round(audio.volume * 100);
  $("vol").addEventListener("input", (e) => { audio.volume = e.target.value / 100; ls.set("nh:vol", audio.volume); });

  // Editor
  $("saveEd").addEventListener("click", saveEditor);
  $("cancelEd").addEventListener("click", () => closeModal("ed"));
  $("logout").addEventListener("click", doLogout);
  $("resetVales").addEventListener("click", resetVales);
  $("importBtn").addEventListener("click", importData);
  $("exportBtn").addEventListener("click", exportBackup);
  $("defaultsBtn").addEventListener("click", loadDefaults);
  $("loginForm").addEventListener("submit", doLogin);
  $("slots").addEventListener("click", (e) => {
    const del = e.target.closest("[data-del]");
    if (del) { draft.photos[+del.dataset.del] = null; renderSlots(); return; }
    const s = e.target.closest("[data-slot]");
    if (s && !s.classList.contains("busy")) pickPhoto(+s.dataset.slot);
  });
  $("aslot").addEventListener("click", (e) => {
    if (e.target.closest("[data-del-audio]")) { draft.audio = null; renderAudioSlot(); return; }
    if (!e.currentTarget.classList.contains("busy")) pickAudio();
  });
  // Activar casillas con teclado
  document.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches(".slot")) { e.preventDefault(); e.target.click(); }
    if (e.key === "Escape") {
      const open = [...document.querySelectorAll(".mod.on")].pop();
      if (open && open.id !== "ed") closeModal(open.id);
    }
  });
  // Cerrar ventanas al tocar fuera o con botones [data-close]
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t.matches && t.matches(".mod[data-dismiss]")) closeModal(t.id);
    const c = t.closest && t.closest("[data-close]");
    if (c) closeModal(c.dataset.close);
  });
  window.addEventListener("hashchange", () => { updateFab(); if (location.hash === "#editar") requestEdit(); });
  // Si vuelve a la pestaña, recargar datos (por si se han cambiado desde otro dispositivo)
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible" || !store || !store.remote || $("ed").classList.contains("on")) return;
    await refresh();
    render();
  });
}

async function boot() {
  bindEvents();
  floaters();
  try { store = await initBackend(); }
  catch (e) { toast(errMsg(e), "error"); store = null; }
  await refresh();
  render();
  setInterval(tick, 1000);
  updateFab();

  const gate = $("gate");
  gate.disabled = false;
  $("gHint").textContent = "Toca para abrir";

  if (store && !store.remote && !hadCfg) { hideGate(); openEditor(); toast("Bienvenido 👋 Personaliza la página y pulsa Guardar."); }
  else if (location.hash === "#editar") { hideGate(); requestEdit(); }
}

boot();
