/***********************
 * CONFIG
 ***********************/
const MODULE_SHELTERS = "shelters";

const MODULE_DOOR_OBJECTS = "doorObjects";
const MODULE_WINDOW_OBJECTS = "windowObjects";
const MODULE_ALUMINUM_OBJECTS = "aluminumObjects";
const MODULE_FILTRATION_OBJECTS = "filtrationObjects";

/* Shelters fields */
const F_shelterProject = "shelterProject";
const F_shelterLocation = "shelterLocation";
const F_shelterEntrance = "shelterEntrance";
const F_shelterApartment = "shelterApartment";
const F_shelterFloor = "shelterFloor";
const F_shelterTiach = "shelterTiach";
const F_shelterAtimut = "shelterAtimut";
const F_shelterRemarks = "shelterRemarks";

/* Need checkboxes */
const F_shelterNeedAtimut = "shelterNeedAtimut";
const F_shelterNeedTiach = "shelterNeedTiach";

/* Objects fields */
const F_objectShelter = "objectShelter";
const F_objectProject = "objectProject";
const F_objectStatus = "objectStatus";

/***********************
 * UI refs
 ***********************/
const elState = document.getElementById("state");
const elError = document.getElementById("error");
const elLayoutHost = document.getElementById("layoutHost");

function showError(msg) {
  elError.style.display = "block";
  elError.textContent = msg;
}
function hideError() {
  elError.style.display = "none";
  elError.textContent = "";
}
function setLoading(isLoading, msg = "טוען נתונים…") {
  elState.style.display = isLoading ? "block" : "none";
  elState.textContent = msg;
  elLayoutHost.style.display = isLoading ? "none" : "block";
}

/***********************
 * CSS vars to JS
 ***********************/
function cssPx(varName, fallback) {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  const n = parseInt(v.replace("px", ""), 10);
  return Number.isFinite(n) ? n : fallback;
}
const CARD_W = cssPx("--card-w", 230);
const GRID_GAP = cssPx("--grid-gap", 12);
const ZONE_PAD_X = cssPx("--zone-pad-x", 28);

/***********************
 * Helpers
 ***********************/
const _collatorHe = new Intl.Collator("he", {
  numeric: true,
  sensitivity: "base",
});

function safeText(v) {
  const s = String(v ?? "").trim();
  return s || "—";
}

function escapeCOQLString(value) {
  return String(value).replace(/'/g, "\\'");
}

function hasLookupValue(v) {
  return !!(v && typeof v === "object" && v.id);
}

/* picklist string/object */
function pickText(v) {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
    return String(v);
  if (typeof v === "object") {
    if (v.display_value != null) return String(v.display_value);
    if (v.name != null) return String(v.name);
    if (v.value != null) return String(v.value);
  }
  return String(v);
}
function normStatusText(v) {
  return pickText(v).replace(/\s+/g, " ").trim();
}

/* lookup to id (יותר עמיד) */
function shelterIdFromLookup(lookup) {
  if (!lookup) return null;
  if (Array.isArray(lookup)) lookup = lookup[0];
  if (typeof lookup === "object" && lookup.id) return String(lookup.id);
  return null;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/***********************
 * SORT KEYS
 ***********************/
function getEntranceSortKey(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return { type: 9, val: 9999, str: "" };

  const hebOrder = "אבגדהוזחטיכלמנסעפצקרשת";
  const lastTok = s.split(/\s+/).filter(Boolean).slice(-1)[0] || s;

  const hebIdx = hebOrder.indexOf(lastTok[0]);
  if (hebIdx >= 0) return { type: 0, val: hebIdx, str: s };

  const num = parseInt(lastTok, 10);
  if (!Number.isNaN(num)) return { type: 1, val: num, str: s };

  return { type: 9, val: 9999, str: s };
}

function getFloorSortKeyDesc(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return { type: 9, val: 9999, str: "" };

  const m = s.match(/-?\d+/);
  if (m) return { type: 0, val: -parseInt(m[0], 10), str: s };

  if (s.includes("קרקע")) return { type: 1, val: 0, str: s };

  return { type: 9, val: 9999, str: s };
}

function getApartmentSortKey(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return { type: 9, val: 9999, str: "" };

  const m = s.match(/\d+/);
  if (m) return { type: 0, val: parseInt(m[0], 10), str: s };

  return { type: 9, val: 9999, str: s };
}

/***********************
 * COQL pagination
 ***********************/
async function coqlAll(selectQueryBase) {
  const all = [];
  let offset = 0;

  while (true) {
    const q = `${selectQueryBase} limit 200 offset ${offset}`;
    const res = await ZOHO.CRM.API.coql({ select_query: q });
    const rows = res && res.data ? res.data : [];
    all.push(...rows);
    if (rows.length < 200) break;
    offset += 200;
  }
  return all;
}

/***********************
 * Data fetch
 ***********************/
async function fetchSheltersByProject(projectId) {
  const pid = escapeCOQLString(projectId);

  const q = `
    select id,
      ${F_shelterLocation},
      ${F_shelterEntrance},
      ${F_shelterApartment},
      ${F_shelterFloor},
      ${F_shelterTiach},
      ${F_shelterAtimut},
      ${F_shelterRemarks},
      ${F_shelterNeedAtimut},
      ${F_shelterNeedTiach},
      ${F_shelterProject}
    from ${MODULE_SHELTERS}
    where ${F_shelterProject}.id = '${pid}'
  `.trim();

  return await coqlAll(q);
}

/* ✅ קריטי: מביא objects לפי Shelters (לא לפי Project) */
async function fetchObjectsByShelterIds(shelterIds, moduleApiName) {
  const ids = (shelterIds || []).map((x) => String(x)).filter(Boolean);
  if (!ids.length) return [];

  const chunks = chunk(ids, 45); // בטוח מבחינת אורך query
  const out = [];

  for (const ch of chunks) {
    const inList = ch.map((id) => `'${escapeCOQLString(id)}'`).join(", ");
    const q = `
      select id, ${F_objectShelter}, ${F_objectStatus}
      from ${moduleApiName}
      where ${F_objectShelter}.id in (${inList})
    `.trim();

    const rows = await coqlAll(q);
    out.push(...rows);
  }

  return out;
}

/***********************
 * Group shelters
 ***********************/
function groupShelters(shelters) {
  const entrancesSet = new Set();
  const floorsSet = new Set();
  const grouped = {};

  for (const s of shelters) {
    const floorRaw = safeText(s?.[F_shelterFloor]);
    const entrRaw = safeText(s?.[F_shelterEntrance]);

    floorsSet.add(floorRaw);
    entrancesSet.add(entrRaw);

    if (!grouped[floorRaw]) grouped[floorRaw] = {};
    if (!grouped[floorRaw][entrRaw]) grouped[floorRaw][entrRaw] = [];
    grouped[floorRaw][entrRaw].push(s);
  }

  const entrances = Array.from(entrancesSet).sort((a, b) => {
    const ka = getEntranceSortKey(a);
    const kb = getEntranceSortKey(b);
    if (ka.type !== kb.type) return ka.type - kb.type;
    if (ka.val !== kb.val) return ka.val - kb.val;
    return _collatorHe.compare(ka.str, kb.str);
  });

  const floors = Array.from(floorsSet).sort((a, b) => {
    const ka = getFloorSortKeyDesc(a);
    const kb = getFloorSortKeyDesc(b);
    if (ka.type !== kb.type) return ka.type - kb.type;
    if (ka.val !== kb.val) return ka.val - kb.val;
    return _collatorHe.compare(String(b), String(a));
  });

  for (const floor of Object.keys(grouped)) {
    for (const ent of Object.keys(grouped[floor])) {
      grouped[floor][ent].sort((s1, s2) => {
        const a1 = getApartmentSortKey(s1?.[F_shelterApartment]);
        const a2 = getApartmentSortKey(s2?.[F_shelterApartment]);
        if (a1.type !== a2.type) return a1.type - a2.type;
        if (a1.val !== a2.val) return a1.val - a2.val;
        return _collatorHe.compare(a1.str, a2.str);
      });
    }
  }

  return { entrances, floors, grouped };
}

function computeEntranceUnits(entrances, floors, grouped) {
  const units = {};
  for (const ent of entrances) {
    let maxCap = 0;
    for (const floor of floors) {
      const count = (grouped?.[floor]?.[ent] || []).length;
      maxCap = Math.max(maxCap, Math.min(3, count));
    }
    units[ent] = Math.max(1, maxCap);
  }
  return units;
}

/***********************
 * Open record
 ***********************/
let SHELTERS_ENTITY_CANDIDATES = ["Shelters", "shelters", "SHELTERS"];

function _uniq(arr) {
  const s = new Set();
  const out = [];
  for (const x of arr) {
    const k = String(x || "").trim();
    if (!k) continue;
    if (s.has(k)) continue;
    s.add(k);
    out.push(k);
  }
  return out;
}

async function buildSheltersEntityCandidates() {
  try {
    const res = await ZOHO.CRM.META.getModules();
    const mods = res?.modules || res?.data || [];
    if (!Array.isArray(mods)) return;

    const m = mods.find(
      (x) =>
        String(x?.api_name || x?.apiName || "").toLowerCase() ===
        MODULE_SHELTERS.toLowerCase()
    );
    if (!m) return;

    SHELTERS_ENTITY_CANDIDATES = _uniq([
      m.api_name,
      m.module_name,
      m.plural_label,
      m.singular_label,
      "Shelters",
      "shelters",
    ]);
  } catch (_) {}
}

function openShelterRecord(sid) {
  const openFn = ZOHO?.CRM?.UI?.Record?.open;
  if (!openFn) return;

  for (const ent of SHELTERS_ENTITY_CANDIDATES) {
    try {
      const p = openFn({ Entity: ent, RecordID: sid });
      if (p && typeof p.then === "function") p.catch(() => {});
      return;
    } catch (_) {}
  }
}

/***********************
 * Chips
 ***********************/
function createStatusChip(label, isOn) {
  const chip = document.createElement("div");
  chip.className = "chip";

  const dot = document.createElement("span");
  dot.className = "statusDot " + (isOn ? "on" : "off");

  const txt = document.createElement("div");
  txt.textContent = label;

  chip.appendChild(dot);
  chip.appendChild(txt);
  return chip;
}

/***********************
 * Objects
 ***********************/
const TYPE_META = [
  { key: "door" },
  { key: "window" },
  { key: "aluminum" },
  { key: "filter" },
];

const STATUS_ORDER = [
  { cls: "done" },
  { cls: "done-defect" },
  { cls: "defect" },
  { cls: "notdone" },
];

function statusClassFromValue(v) {
  const s = normStatusText(v);
  if (s.includes("הודבק תווית") && s.includes("ליקוי")) return "done-defect";
  if (s.includes("הודבק תווית")) return "done";
  if (s.includes("קיים ליקוי")) return "defect";
  if (s.includes("לא בוצע")) return "notdone";
  return "unknown";
}

function buildTypeSvg(typeKey) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");

  const add = (tag, attrs) => {
    const el = document.createElementNS(ns, tag);
    for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k]);
    svg.appendChild(el);
  };

  if (typeKey === "door") {
    add("rect", { x: "7", y: "3", width: "10", height: "18", rx: "1" });
    add("circle", { cx: "14", cy: "12", r: "1" });
  } else if (typeKey === "window") {
    add("rect", { x: "4", y: "4", width: "16", height: "16", rx: "1" });
    add("path", { d: "M12 4v16M4 12h16" });
  } else if (typeKey === "aluminum") {
    add("rect", { x: "4", y: "5", width: "14", height: "14", rx: "1" });
    add("rect", { x: "7", y: "4", width: "13", height: "16", rx: "1" });
    add("path", { d: "M11 4v16" });
  } else {
    add("circle", { cx: "12", cy: "12", r: "8" });
    add("path", { d: "M12 7v10M7 12h10M9 9l6 6M15 9l-6 6" });
  }
  return svg;
}

function createObjIcon(typeKey, statusCls) {
  const d = document.createElement("div");
  d.className = `objIcon st-${statusCls}`;
  d.appendChild(buildTypeSvg(typeKey));
  return d;
}

function createObjRow(typeKey, statusCls, count) {
  const row = document.createElement("div");
  row.className = "objRow";

  const cnt = document.createElement("span");
  cnt.className = "objCnt";
  cnt.textContent = `x${count}`;

  const icon = createObjIcon(typeKey, statusCls);

  row.appendChild(cnt);
  row.appendChild(icon);
  return row;
}

function buildObjectsArea(objsByType) {
  const total =
    (objsByType?.door?.length || 0) +
    (objsByType?.window?.length || 0) +
    (objsByType?.aluminum?.length || 0) +
    (objsByType?.filter?.length || 0);

  if (!total) {
    const empty = document.createElement("div");
    empty.className = "objEmpty";
    empty.textContent = "אין פריטים";
    return empty;
  }

  const wrap = document.createElement("div");
  wrap.className = "objMatrix";

  for (const t of TYPE_META) {
    const col = document.createElement("div");
    col.className = "objCol";

    const arr = objsByType?.[t.key] || [];
    if (!arr.length) {
      wrap.appendChild(col); // עמודה ריקה (חור קבוע)
      continue;
    }

    const counts = {
      done: 0,
      "done-defect": 0,
      defect: 0,
      notdone: 0,
      unknown: 0,
    };
    for (const o of arr) {
      const cls = statusClassFromValue(o.status);
      counts[cls] = (counts[cls] || 0) + 1;
    }

    for (const s of STATUS_ORDER) {
      const c = counts[s.cls] || 0;
      if (!c) continue;
      col.appendChild(createObjRow(t.key, s.cls, c));
    }

    wrap.appendChild(col);
  }

  return wrap;
}

/***********************
 * Card
 ***********************/
function createMamadCard(shelter, objsByType) {
  const sid = String(shelter.id);

  const card = document.createElement("div");
  card.className = "mamad-card";
  card.tabIndex = 0;

  card.addEventListener("click", () => openShelterRecord(sid));
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openShelterRecord(sid);
    }
  });

  const loc = String(shelter?.[F_shelterLocation] ?? "").trim();
  const aptRaw = String(shelter?.[F_shelterApartment] ?? "").trim();
  const title = loc ? loc : aptRaw ? `דירה ${aptRaw}` : "ממ״ד";

  const top = document.createElement("div");
  top.className = "mamad-top";
  top.textContent = title;

  const remarks = String(shelter?.[F_shelterRemarks] ?? "").trim();
  if (remarks) {
    const wrap = document.createElement("div");
    wrap.className = "remarksWrap";
    wrap.addEventListener("click", (e) => e.stopPropagation());

    const badge = document.createElement("div");
    badge.className = "remarksBadge";

    const tip = document.createElement("div");
    tip.className = "remarksTip";
    tip.textContent = remarks;

    wrap.appendChild(badge);
    wrap.appendChild(tip);
    top.appendChild(wrap);
  }

  card.appendChild(top);

  const needAtimut = !!shelter?.[F_shelterNeedAtimut];
  const needTiach = !!shelter?.[F_shelterNeedTiach];

  const hasAtimut = hasLookupValue(shelter?.[F_shelterAtimut]);
  const hasTiach = hasLookupValue(shelter?.[F_shelterTiach]);

  const mid = document.createElement("div");
  mid.className = "mamad-mid";

  if (!needAtimut && !needTiach) {
    const txt = document.createElement("div");
    txt.className = "needNone";
    txt.textContent = "לא צריך בדיקות";
    mid.appendChild(txt);
  } else {
    if (needAtimut) mid.appendChild(createStatusChip("אטימות", hasAtimut));
    if (needTiach) mid.appendChild(createStatusChip("טיח", hasTiach));
  }

  card.appendChild(mid);

  const bottom = document.createElement("div");
  bottom.className = "mamad-bottom";
  bottom.appendChild(
    buildObjectsArea(
      objsByType || { door: [], window: [], aluminum: [], filter: [] }
    )
  );
  card.appendChild(bottom);

  return card;
}

/***********************
 * Render table
 ***********************/
function renderTable(entrances, floors, grouped, objsByShelterId) {
  elLayoutHost.innerHTML = "";

  const widthUnits = computeEntranceUnits(entrances, floors, grouped);
  const entranceMinWidths = {};

  const table = document.createElement("table");
  table.className = "matrix";

  const thead = document.createElement("thead");
  const trh = document.createElement("tr");

  const corner = document.createElement("th");
  corner.className = "corner";

  const cornerDiag = document.createElement("div");
  cornerDiag.className = "cornerDiag";

  const lblEntrance = document.createElement("div");
  lblEntrance.className = "cornerLabel cornerEntrance";
  lblEntrance.textContent = "כניסה";

  const lblFloor = document.createElement("div");
  lblFloor.className = "cornerLabel cornerFloor";
  lblFloor.textContent = "קומה";

  cornerDiag.appendChild(lblEntrance);
  cornerDiag.appendChild(lblFloor);
  corner.appendChild(cornerDiag);
  trh.appendChild(corner);

  for (const ent of entrances) {
    const u = widthUnits[ent] || 1;
    const contentW = u * CARD_W + (u - 1) * GRID_GAP;
    const minW = contentW + ZONE_PAD_X;

    entranceMinWidths[ent] = minW;

    const th = document.createElement("th");
    th.textContent = ent;
    th.style.minWidth = `${minW}px`;
    trh.appendChild(th);
  }

  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  for (const floor of floors) {
    const tr = document.createElement("tr");

    const thFloor = document.createElement("th");
    thFloor.className = "floor";

    const floorBox = document.createElement("div");
    floorBox.className = "floorBox";
    floorBox.textContent = floor;

    thFloor.appendChild(floorBox);
    tr.appendChild(thFloor);

    for (const ent of entrances) {
      const td = document.createElement("td");
      td.className = "zone";
      td.style.minWidth = `${entranceMinWidths[ent]}px`;

      const list = grouped?.[floor]?.[ent] ? grouped[floor][ent] : [];
      const u = widthUnits[ent] || 1;

      const grid = document.createElement("div");
      grid.className = "mamad-grid";
      grid.style.gridTemplateColumns = `repeat(${u}, ${CARD_W}px)`;

      for (const shelter of list) {
        const sid = String(shelter.id);
        const objs = objsByShelterId[sid] || {
          door: [],
          window: [],
          aluminum: [],
          filter: [],
        };
        grid.appendChild(createMamadCard(shelter, objs));
      }

      td.appendChild(grid);
      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  elLayoutHost.appendChild(table);
}

/***********************
 * Main
 ***********************/
function getProjectIdFromPageLoad(data) {
  const id =
    (data && Array.isArray(data.EntityId) && data.EntityId[0]) ||
    (data && data.EntityId) ||
    (data && data.recordId) ||
    null;
  return id ? String(id) : null;
}

/***********************
 * AUTO RESIZE
 ***********************/
const RESIZE_WIDTH = 1400;
const RESIZE_MIN_H = 520;
const RESIZE_MAX_H = 2200;
const RESIZE_PAD = 24;

let _resizeRaf = null;
let _lastH = 0;
let _ro = null;

function _clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function calcDesiredWidgetHeight() {
  const topbar = document.querySelector(".topbar");
  const table = document.querySelector("table.matrix");

  const errH =
    elError && elError.style.display !== "none" ? elError.offsetHeight : 0;
  const stateH =
    elState && elState.style.display !== "none" ? elState.offsetHeight : 0;

  const tableH = table ? table.offsetHeight : 420;

  const total =
    (topbar?.offsetHeight || 0) + errH + stateH + tableH + RESIZE_PAD;
  return _clamp(total, RESIZE_MIN_H, RESIZE_MAX_H);
}

function scheduleAutoResize() {
  if (!ZOHO?.CRM?.UI?.Resize) return;

  if (_resizeRaf) cancelAnimationFrame(_resizeRaf);
  _resizeRaf = requestAnimationFrame(() => {
    _resizeRaf = null;
    const h = calcDesiredWidgetHeight();
    if (Math.abs(h - _lastH) < 8) return;
    _lastH = h;
    ZOHO.CRM.UI.Resize({ height: h, width: RESIZE_WIDTH });
  });
}

function startAutoResizeObserver() {
  if (_ro) return;
  const target =
    document.querySelector("table.matrix") || elLayoutHost || document.body;

  if ("ResizeObserver" in window) {
    _ro = new ResizeObserver(() => scheduleAutoResize());
    _ro.observe(target);
  } else {
    window.addEventListener("resize", scheduleAutoResize);
  }
}

function initObjsForShelter(map, sid) {
  if (!map[sid]) map[sid] = { door: [], window: [], aluminum: [], filter: [] };
  return map[sid];
}

ZOHO.embeddedApp.on("PageLoad", async function (data) {
  try {
    startAutoResizeObserver();
    scheduleAutoResize();

    hideError();
    setLoading(true, "טוען ממדים…");

    const projectId = getProjectIdFromPageLoad(data);
    if (!projectId)
      throw new Error(
        "לא נמצא Project ID מה-PageLoad. ודא שהווידג'ט נמצא בתוך Projects."
      );

    await buildSheltersEntityCandidates();

    const shelters = await fetchSheltersByProject(projectId);
    if (!shelters || shelters.length === 0) {
      setLoading(false, "אין ממדים בפרויקט הזה.");
      return;
    }

    const shelterIds = shelters.map((s) => String(s.id)).filter(Boolean);

    setLoading(true, "טוען אובייקטים…");

    const [doors, windows, aluminums, filtrations] = await Promise.all([
      fetchObjectsByShelterIds(shelterIds, MODULE_DOOR_OBJECTS),
      fetchObjectsByShelterIds(shelterIds, MODULE_WINDOW_OBJECTS),
      fetchObjectsByShelterIds(shelterIds, MODULE_ALUMINUM_OBJECTS),
      fetchObjectsByShelterIds(shelterIds, MODULE_FILTRATION_OBJECTS),
    ]);

    const objsByShelterId = {};

    function applyObjs(rows, typeKey) {
      for (const r of rows || []) {
        const sid = shelterIdFromLookup(r?.[F_objectShelter]);
        if (!sid) continue;

        initObjsForShelter(objsByShelterId, sid)[typeKey].push({
          id: String(r.id),
          status: r?.[F_objectStatus],
        });
      }
    }

    applyObjs(doors, "door");
    applyObjs(windows, "window");
    applyObjs(aluminums, "aluminum");
    applyObjs(filtrations, "filter");

    const { entrances, floors, grouped } = groupShelters(shelters);

    setLoading(false);
    renderTable(entrances, floors, grouped, objsByShelterId);
    scheduleAutoResize();
    setTimeout(scheduleAutoResize, 0);
  } catch (e) {
    setLoading(false);
    showError(e && e.message ? e.message : String(e));
  }
});

ZOHO.embeddedApp.init();
