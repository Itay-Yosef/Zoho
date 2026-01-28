// app.js
"use strict";

/**
 * למה לא קיבלת recordId מהכפתור?
 * בכפתור Zoho ב-Detail View, ה-PageLoad מחזיר לרוב data.EntityId כ-Array(1) (למשל ["123"]).
 * ב-Related List זה הרבה פעמים string ("123").
 * לכן חייבים לנרמל: אם Array -> לקחת [0]. (זה בדיוק התיקון כאן.)
 *
 * למה "Parentwindow reference not found"?
 * זה קורה כשפותחים את ה-widget כעמוד רגיל (URL) ולא מתוך Zoho CRM (iframe).
 * הפתרון: לוודא שהכפתור הוא "Open a Widget" ולא "Open URL",
 * או לכל הפחות להעביר recordId ב-URL ולדעת שה-SDK לא יעבוד מחוץ ל-Zoho.
 */

/***********************
 * CONFIG (API Names)
 ***********************/
const PROJECTS_MODULE_API = "projects";
const SHELTERS_MODULE_API = "shelters";

const PROJECT_NAME_FIELD_API = "Name";
const PROJECT_SPLIT_NAME_FIELD_API = "projectSplitName";
const PROJECT_SPLIT_ADDR_FIELD_API = "projectSplitAddress";

const PROJECT_CITY_API = "projectCity";
const PROJECT_STREET_API = "projectStreet";
const PROJECT_NUMBER_API = "projectNumber";
const PROJECT_GUSH_API = "projectGush";
const PROJECT_HELKA_API = "projectHelka";
const PROJECT_MIGRASH_API = "projectMigrash";

// Shelters
const SHELTER_PROJECT_LOOKUP_API = "shelterProject";
const SHELTER_OWNER_NAME_API = "shelterOwnerName";

const SHELTER_STREET_API = "shelterStreet";
const SHELTER_NUMBER_API = "shelterNumber";
const SHELTER_GUSH_API = "shelterGush";
const SHELTER_HELKA_API = "shelterHelka";
const SHELTER_MIGRASH_API = "shelterMigrash";

const SHELTER_ENTRANCE_API = "shelterEntrance";
const SHELTER_FLOOR_API = "shelterFloor";
const SHELTER_APARTMENT_API = "shelterApartment";
const SHELTER_REMARKS_API = "shelterRemarks";

/***********************
 * UI / STATE
 ***********************/
const el = {
  banner: document.getElementById("banner"),
  title: document.getElementById("title"),
  metaCity: document.getElementById("metaCity"),
  metaAddr: document.getElementById("metaAddr"),

  toggleSplitName: document.getElementById("toggleSplitName"),
  toggleSplitAddr: document.getElementById("toggleSplitAddr"),

  btnFillNames: document.getElementById("btnFillNames"),
  btnFillAddr: document.getElementById("btnFillAddr"),

  btnAdd: document.getElementById("btnAdd"),
  btnDelete: document.getElementById("btnDelete"),
  btnSave: document.getElementById("btnSave"),
  btnRefresh: document.getElementById("btnRefresh"),

  chkAll: document.getElementById("chkAll"),
  loading: document.getElementById("loading"),
  empty: document.getElementById("empty"),
  grid: document.getElementById("grid"),
  tbody: document.getElementById("tbody"),
};

const state = {
  started: false,
  insideZoho: typeof window.ZOHO !== "undefined",

  projectId: null,
  project: null,

  shelters: [],
  originalById: new Map(), // snapshot for dirty compare

  // desired UI flags
  splitName: false,
  splitAddr: false,

  // persisted flags in CRM (last known)
  splitNamePersisted: false,
  splitAddrPersisted: false,

  // selection
  selectedIds: new Set(),

  // save/pending
  saving: false,
};

/***********************
 * Helpers
 ***********************/
function safeStr(v) {
  if (v === null || v === undefined) return "";
  return String(v);
}
function norm(v) {
  return safeStr(v).trim();
}
function escapeHtml(str) {
  return safeStr(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function getUrlParam(name) {
  try {
    const u = new URL(window.location.href);
    return u.searchParams.get(name);
  } catch {
    return null;
  }
}
function getRecordIdFromUrl() {
  // תומך גם recordId לפי הדרישה וגם fallbackים שכיחים
  return (
    getUrlParam("recordId") ||
    getUrlParam("EntityId") ||
    getUrlParam("entityId") ||
    getUrlParam("id")
  );
}

/**
 * זה התיקון הקריטי:
 * בכפתור (Detail View) data.EntityId יכול להיות Array(1), וברשימה/relatedList יכול להיות string.
 */
function extractEntityIdFromPageLoad(data) {
  if (!data) return null;

  const raw =
    data.EntityId ??
    data.EntityID ??
    data.entityId ??
    data.entityID ??
    data.EntityIds ??
    data.EntityIDs;

  if (Array.isArray(raw)) return raw[0] || null;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (typeof raw === "number") return String(raw);

  // לפעמים מגיעים ערכים בצורה אחרת:
  if (data?.EntityId && Array.isArray(data.EntityId))
    return data.EntityId[0] || null;

  return null;
}

function showBanner(type, msg) {
  el.banner.className = `banner show ${type}`;
  el.banner.innerHTML = escapeHtml(msg);
}
function clearBanner() {
  el.banner.className = "banner";
  el.banner.innerHTML = "";
}

function resize(height) {
  try {
    if (window.ZOHO?.CRM?.UI?.Resize) {
      window.ZOHO.CRM.UI.Resize({ height });
    }
  } catch {
    // ignore
  }
}
function resizeFor(mode) {
  if (mode === "loading") return resize(520);
  if (mode === "list") return resize(1000);
  return resize(900);
}
function resizeAfterRender() {
  const h = Math.max(900, Math.min(1200, document.body.scrollHeight + 60));
  resize(h);
}

function setLoading(isLoading) {
  el.loading.style.display = isLoading ? "block" : "none";
  el.grid.style.display = isLoading ? "none" : el.grid.style.display;
  el.empty.style.display = "none";
  resizeFor(isLoading ? "loading" : "list");
}

/***********************
 * Zoho API wrappers
 ***********************/
async function zohoGetRecord(entity, id) {
  const res = await ZOHO.CRM.API.getRecord({ Entity: entity, RecordID: id });
  const rec = res?.data?.[0];
  if (!rec) throw new Error("Record not found");
  return rec;
}

async function zohoUpdateRecord(entity, id, fields) {
  const APIData = { id, ...fields };
  const res = await ZOHO.CRM.API.updateRecord({ Entity: entity, APIData });
  const ok = res?.data?.[0]?.status === "success";
  if (!ok) throw new Error(res?.data?.[0]?.message || "Update failed");
  return res;
}

async function zohoInsertRecord(entity, fields) {
  // Lookup: ננסה קודם אובייקט {id}, ואם זה נכשל ננסה string.
  try {
    const res = await ZOHO.CRM.API.insertRecord({
      Entity: entity,
      APIData: fields,
    });
    const ok = res?.data?.[0]?.status === "success";
    if (!ok) throw new Error(res?.data?.[0]?.message || "Insert failed");
    return res;
  } catch (e) {
    // fallback אם lookup הוגדר כמחרוזת
    throw e;
  }
}

async function zohoDeleteRecord(entity, id) {
  const res = await ZOHO.CRM.API.deleteRecord({ Entity: entity, RecordID: id });
  const ok = res?.data?.[0]?.status === "success";
  if (!ok) throw new Error(res?.data?.[0]?.message || "Delete failed");
  return res;
}

async function zohoSearchAll(entity, criteria, perPage = 200) {
  const out = [];
  let page = 1;

  while (true) {
    const res = await ZOHO.CRM.API.searchRecord(
      { Entity: entity, Type: "criteria", Query: criteria },
      page,
      perPage,
    );
    const data = res?.data || [];
    out.push(...data);

    const more = !!res?.info?.more_records;
    if (!more || data.length === 0) break;
    page += 1;

    // safety
    if (page > 50) break;
  }

  return out;
}

/***********************
 * Data formatting
 ***********************/
function projectField(api) {
  return state.project ? state.project[api] : "";
}
function projectName() {
  return norm(projectField(PROJECT_NAME_FIELD_API));
}
function projectCity() {
  return norm(projectField(PROJECT_CITY_API));
}
function formatProjectAddressLine() {
  const street = norm(projectField(PROJECT_STREET_API));
  const num = norm(projectField(PROJECT_NUMBER_API));
  const gush = norm(projectField(PROJECT_GUSH_API));
  const helka = norm(projectField(PROJECT_HELKA_API));
  const migrash = norm(projectField(PROJECT_MIGRASH_API));

  const parts = [];
  if (street || num) parts.push(`רחוב ${street || "—"} ${num || ""}`.trim());
  if (gush) parts.push(`גוש ${gush}`);
  if (helka) parts.push(`חלקה ${helka}`);
  if (migrash) parts.push(`מגרש ${migrash}`);
  return parts.length ? parts.join(" | ") : "—";
}

function getShelterId(rec) {
  return safeStr(rec.id);
}
function lookupId(val) {
  if (!val) return "";
  if (typeof val === "string") return val;
  if (typeof val === "object" && val.id) return safeStr(val.id);
  return "";
}

/***********************
 * Boot / recordId capture
 ***********************/
function startWithProjectId(id, source) {
  const pid = norm(id);
  if (!pid) return;

  if (state.started) return;
  state.started = true;
  state.projectId = pid;

  clearBanner();
  showBanner("info", `נטען פרויקט… (${source})`);
  loadAll().catch((e) => {
    showBanner("err", `שגיאה בטעינה: ${e.message || e}`);
  });
}

function showNoIdError() {
  showBanner("err", "לא התקבל מזהה פרויקט (recordId) מהכפתור");
  setLoading(false);
  el.grid.style.display = "none";
  el.empty.style.display = "block";
  resizeFor("list");
}

/***********************
 * Load
 ***********************/
async function loadAll() {
  setLoading(true);

  state.project = await zohoGetRecord(PROJECTS_MODULE_API, state.projectId);

  state.splitNamePersisted = !!state.project[PROJECT_SPLIT_NAME_FIELD_API];
  state.splitAddrPersisted = !!state.project[PROJECT_SPLIT_ADDR_FIELD_API];

  state.splitName = state.splitNamePersisted;
  state.splitAddr = state.splitAddrPersisted;

  // Load shelters by lookup
  const crit1 = `(${SHELTER_PROJECT_LOOKUP_API}.id:equals:${state.projectId})`;
  let shelters = [];
  try {
    shelters = await zohoSearchAll(SHELTERS_MODULE_API, crit1);
  } catch {
    // fallback (אם אצלך החיפוש ב-lookup לא צריך ".id")
    const crit2 = `(${SHELTER_PROJECT_LOOKUP_API}:equals:${state.projectId})`;
    shelters = await zohoSearchAll(SHELTERS_MODULE_API, crit2);
  }

  state.shelters = shelters;
  state.originalById = new Map();
  state.selectedIds = new Set();

  for (const s of state.shelters) {
    const id = getShelterId(s);
    state.originalById.set(id, JSON.parse(JSON.stringify(s)));
  }

  renderAll();

  // Resize after DOM render
  setTimeout(resizeAfterRender, 0);

  setLoading(false);

  // empty state
  if (state.shelters.length === 0) {
    el.grid.style.display = "none";
    el.empty.style.display = "block";
  } else {
    el.empty.style.display = "none";
    el.grid.style.display = "table";
  }
  resizeAfterRender();
}

/***********************
 * Render
 ***********************/
function renderAll() {
  // Header
  el.title.textContent = `ניהול ממדים לפרויקט: ${projectName() || "—"}`;
  el.metaCity.textContent = `עיר: ${projectCity() || "—"}`;
  el.metaAddr.textContent = `כתובת פרויקט: ${formatProjectAddressLine()}`;

  // Toolbar
  el.toggleSplitName.checked = !!state.splitName;
  el.toggleSplitAddr.checked = !!state.splitAddr;

  el.btnFillNames.style.display = state.splitName ? "inline-block" : "none";
  el.btnFillAddr.style.display = state.splitAddr ? "inline-block" : "none";

  // Delete selected visibility
  el.btnDelete.style.display = state.selectedIds.size ? "inline-block" : "none";

  // Save enabled?
  el.btnSave.disabled = !hasUnsavedChanges() || state.saving;

  // Table
  el.tbody.innerHTML = "";
  if (!state.shelters.length) return;

  const rowsHtml = state.shelters.map(renderRow).join("");
  el.tbody.innerHTML = rowsHtml;

  // bind input listeners (event delegation)
  el.tbody.querySelectorAll("input[data-field]").forEach((inp) => {
    inp.addEventListener("input", onCellEdit);
  });
  el.tbody.querySelectorAll("input[data-select]").forEach((chk) => {
    chk.addEventListener("change", onRowSelect);
  });
  el.tbody.querySelectorAll("[data-open]").forEach((a) => {
    a.addEventListener("click", onOpenRecord);
  });

  // Check all
  el.chkAll.checked =
    state.selectedIds.size && state.selectedIds.size === state.shelters.length;
}

function renderRow(rec) {
  const id = getShelterId(rec);

  const entrance = norm(rec[SHELTER_ENTRANCE_API]);
  const floor = norm(rec[SHELTER_FLOOR_API]);
  const apt = norm(rec[SHELTER_APARTMENT_API]);

  const remarks = norm(rec[SHELTER_REMARKS_API]);

  // Display owner name
  const ownerVal = state.splitName
    ? norm(rec[SHELTER_OWNER_NAME_API])
    : projectName();
  const ownerReadOnly = !state.splitName;

  // Display address (without city)
  const streetVal = state.splitAddr
    ? norm(rec[SHELTER_STREET_API])
    : norm(projectField(PROJECT_STREET_API));
  const numVal = state.splitAddr
    ? norm(rec[SHELTER_NUMBER_API])
    : norm(projectField(PROJECT_NUMBER_API));
  const gushVal = state.splitAddr
    ? norm(rec[SHELTER_GUSH_API])
    : norm(projectField(PROJECT_GUSH_API));
  const helkaVal = state.splitAddr
    ? norm(rec[SHELTER_HELKA_API])
    : norm(projectField(PROJECT_HELKA_API));
  const migrashVal = state.splitAddr
    ? norm(rec[SHELTER_MIGRASH_API])
    : norm(projectField(PROJECT_MIGRASH_API));

  const addrReadOnly = !state.splitAddr;

  const badgeOwner = ownerReadOnly
    ? `<span class="pill">נלקח מהפרויקט</span>`
    : "";
  const badgeAddr = addrReadOnly
    ? `<span class="pill">נלקח מהפרויקט</span>`
    : "";

  return `
    <tr>
      <td>
        <input type="checkbox" data-select="1" data-id="${escapeHtml(id)}" ${state.selectedIds.has(id) ? "checked" : ""}/>
      </td>

      <td>
        <div>
          <a class="link" data-open="1" data-id="${escapeHtml(id)}">פתח רקורד</a>
          <div class="muted" style="font-size:11px;margin-top:4px;">${escapeHtml(id)}</div>
        </div>
      </td>

      <td>
        <div class="grid2">
          <div><span class="muted">כניסה:</span> ${escapeHtml(entrance || "—")}</div>
          <div><span class="muted">קומה:</span> ${escapeHtml(floor || "—")}</div>
          <div><span class="muted">דירה:</span> ${escapeHtml(apt || "—")}</div>
        </div>
      </td>

      <td>
        <div style="display:flex;align-items:center;gap:6px;">
          ${
            ownerReadOnly
              ? `<span>${escapeHtml(ownerVal || "—")}</span>${badgeOwner}`
              : `<input type="text" data-field="${escapeHtml(SHELTER_OWNER_NAME_API)}" data-id="${escapeHtml(id)}" value="${escapeHtml(ownerVal)}" placeholder="שם לממד" />`
          }
        </div>
      </td>

      <td>
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
          ${addrReadOnly ? `<span class="muted">${badgeAddr}</span>` : ""}
        </div>
        <div class="grid2">
          <div>
            <span class="muted">רחוב</span>
            ${
              addrReadOnly
                ? `<div>${escapeHtml(streetVal || "—")}</div>`
                : `<input type="text" data-field="${escapeHtml(SHELTER_STREET_API)}" data-id="${escapeHtml(id)}" value="${escapeHtml(streetVal)}" />`
            }
          </div>
          <div>
            <span class="muted">מספר</span>
            ${
              addrReadOnly
                ? `<div>${escapeHtml(numVal || "—")}</div>`
                : `<input type="text" data-field="${escapeHtml(SHELTER_NUMBER_API)}" data-id="${escapeHtml(id)}" value="${escapeHtml(numVal)}" />`
            }
          </div>
          <div>
            <span class="muted">גוש</span>
            ${
              addrReadOnly
                ? `<div>${escapeHtml(gushVal || "—")}</div>`
                : `<input type="text" data-field="${escapeHtml(SHELTER_GUSH_API)}" data-id="${escapeHtml(id)}" value="${escapeHtml(gushVal)}" />`
            }
          </div>
          <div>
            <span class="muted">חלקה</span>
            ${
              addrReadOnly
                ? `<div>${escapeHtml(helkaVal || "—")}</div>`
                : `<input type="text" data-field="${escapeHtml(SHELTER_HELKA_API)}" data-id="${escapeHtml(id)}" value="${escapeHtml(helkaVal)}" />`
            }
          </div>
          <div>
            <span class="muted">מגרש</span>
            ${
              addrReadOnly
                ? `<div>${escapeHtml(migrashVal || "—")}</div>`
                : `<input type="text" data-field="${escapeHtml(SHELTER_MIGRASH_API)}" data-id="${escapeHtml(id)}" value="${escapeHtml(migrashVal)}" />`
            }
          </div>
        </div>
      </td>

      <td>
        <input type="text" data-field="${escapeHtml(SHELTER_REMARKS_API)}" data-id="${escapeHtml(id)}" value="${escapeHtml(remarks)}" placeholder="הערות..." />
      </td>
    </tr>
  `;
}

/***********************
 * Dirty / changes
 ***********************/
function getOriginal(id) {
  return state.originalById.get(id) || null;
}
function fieldsEqual(a, b) {
  return norm(a) === norm(b);
}

function hasUnsavedChanges() {
  // project split changes
  if (state.splitName !== state.splitNamePersisted) return true;
  if (state.splitAddr !== state.splitAddrPersisted) return true;

  // row fields
  for (const rec of state.shelters) {
    const id = getShelterId(rec);
    const orig = getOriginal(id);
    if (!orig) continue;

    // Always-edit fields
    if (!fieldsEqual(rec[SHELTER_REMARKS_API], orig[SHELTER_REMARKS_API]))
      return true;

    // Split-dependent fields (only meaningful when split ON)
    if (state.splitName) {
      if (
        !fieldsEqual(rec[SHELTER_OWNER_NAME_API], orig[SHELTER_OWNER_NAME_API])
      )
        return true;
    }
    if (state.splitAddr) {
      const addrFields = [
        SHELTER_STREET_API,
        SHELTER_NUMBER_API,
        SHELTER_GUSH_API,
        SHELTER_HELKA_API,
        SHELTER_MIGRASH_API,
      ];
      for (const f of addrFields) {
        if (!fieldsEqual(rec[f], orig[f])) return true;
      }
    }
  }
  return false;
}

/***********************
 * Events
 ***********************/
function onCellEdit(e) {
  const id = e.target.getAttribute("data-id");
  const field = e.target.getAttribute("data-field");
  const rec = state.shelters.find((x) => getShelterId(x) === id);
  if (!rec) return;

  rec[field] = e.target.value;
  renderAll();
  resizeAfterRender();
}

function onRowSelect(e) {
  const id = e.target.getAttribute("data-id");
  if (!id) return;

  if (e.target.checked) state.selectedIds.add(id);
  else state.selectedIds.delete(id);

  renderAll();
  resizeAfterRender();
}

async function onOpenRecord(e) {
  const id = e.currentTarget.getAttribute("data-id");
  if (!id) return;

  try {
    if (window.ZOHO?.CRM?.UI?.Record?.open) {
      await ZOHO.CRM.UI.Record.open({
        Entity: SHELTERS_MODULE_API,
        RecordID: id,
      });
    }
  } catch {
    // ignore
  }
}

async function onToggleSplitName() {
  if (!state.project) return;
  const next = !!el.toggleSplitName.checked;

  state.splitName = next;

  // לפי דרישה: בהדלקה לעדכן מיד את הפרויקט
  if (next && state.splitNamePersisted !== true) {
    try {
      showBanner("info", "מעדכן בפרויקט: פיצול שם = פעיל…");
      await zohoUpdateRecord(PROJECTS_MODULE_API, state.projectId, {
        [PROJECT_SPLIT_NAME_FIELD_API]: true,
      });
      state.splitNamePersisted = true;
      state.project[PROJECT_SPLIT_NAME_FIELD_API] = true;
      showBanner("ok", "פיצול שם הופעל בפרויקט.");
    } catch (e) {
      showBanner("err", `נכשל לעדכן פיצול שם בפרויקט: ${e.message || e}`);
      // rollback UI toggle
      state.splitName = state.splitNamePersisted;
      el.toggleSplitName.checked = state.splitName;
    }
  }

  // בהדלקה: אם שדה שם ממד ריק -> למלא שם פרויקט (לוקאלי, נשמר ב-Save)
  if (state.splitName) {
    const pn = projectName();
    for (const s of state.shelters) {
      if (!norm(s[SHELTER_OWNER_NAME_API])) s[SHELTER_OWNER_NAME_API] = pn;
    }
  }

  renderAll();
  resizeAfterRender();
}

async function onToggleSplitAddr() {
  if (!state.project) return;
  const next = !!el.toggleSplitAddr.checked;

  state.splitAddr = next;

  // לפי דרישה: בהדלקה לעדכן מיד את הפרויקט
  if (next && state.splitAddrPersisted !== true) {
    try {
      showBanner("info", "מעדכן בפרויקט: פיצול כתובת = פעיל…");
      await zohoUpdateRecord(PROJECTS_MODULE_API, state.projectId, {
        [PROJECT_SPLIT_ADDR_FIELD_API]: true,
      });
      state.splitAddrPersisted = true;
      state.project[PROJECT_SPLIT_ADDR_FIELD_API] = true;
      showBanner("ok", "פיצול כתובת הופעל בפרויקט.");
    } catch (e) {
      showBanner("err", `נכשל לעדכן פיצול כתובת בפרויקט: ${e.message || e}`);
      // rollback
      state.splitAddr = state.splitAddrPersisted;
      el.toggleSplitAddr.checked = state.splitAddr;
    }
  }

  // בהדלקה: אם שדה כתובת ריק -> למלא מערכי הפרויקט (לוקאלי, נשמר ב-Save)
  if (state.splitAddr) {
    for (const s of state.shelters) {
      if (!norm(s[SHELTER_STREET_API]))
        s[SHELTER_STREET_API] = projectField(PROJECT_STREET_API);
      if (!norm(s[SHELTER_NUMBER_API]))
        s[SHELTER_NUMBER_API] = projectField(PROJECT_NUMBER_API);
      if (!norm(s[SHELTER_GUSH_API]))
        s[SHELTER_GUSH_API] = projectField(PROJECT_GUSH_API);
      if (!norm(s[SHELTER_HELKA_API]))
        s[SHELTER_HELKA_API] = projectField(PROJECT_HELKA_API);
      if (!norm(s[SHELTER_MIGRASH_API]))
        s[SHELTER_MIGRASH_API] = projectField(PROJECT_MIGRASH_API);
    }
  }

  renderAll();
  resizeAfterRender();
}

async function onFillNames() {
  if (!state.splitName) return;
  const ok = window.confirm("זה ידרוס את כל שמות הממדים. בטוח?");
  if (!ok) return;

  const pn = projectName();
  for (const s of state.shelters) s[SHELTER_OWNER_NAME_API] = pn;

  showBanner("info", "עודכן לוקאלית. לחץ 'שמור שינויים' כדי לעדכן ב-CRM.");
  renderAll();
  resizeAfterRender();
}

async function onFillAddr() {
  if (!state.splitAddr) return;
  const ok = window.confirm("זה ידרוס את כל כתובות הממדים (ללא עיר). בטוח?");
  if (!ok) return;

  for (const s of state.shelters) {
    s[SHELTER_STREET_API] = projectField(PROJECT_STREET_API);
    s[SHELTER_NUMBER_API] = projectField(PROJECT_NUMBER_API);
    s[SHELTER_GUSH_API] = projectField(PROJECT_GUSH_API);
    s[SHELTER_HELKA_API] = projectField(PROJECT_HELKA_API);
    s[SHELTER_MIGRASH_API] = projectField(PROJECT_MIGRASH_API);
  }

  showBanner("info", "עודכן לוקאלית. לחץ 'שמור שינויים' כדי לעדכן ב-CRM.");
  renderAll();
  resizeAfterRender();
}

/***********************
 * Save / Add / Delete / Refresh
 ***********************/
function validateBeforeSave() {
  const pn = projectName();
  if (!pn) return "חסר שם לפרויקט (Name).";

  // city only display - no validation needed

  const pStreet = norm(projectField(PROJECT_STREET_API));
  const pNum = norm(projectField(PROJECT_NUMBER_API));
  const pGush = norm(projectField(PROJECT_GUSH_API));
  const pHelka = norm(projectField(PROJECT_HELKA_API));
  const pMigrash = norm(projectField(PROJECT_MIGRASH_API));

  // When split address OFF, shelters will be forced to project address -> project must have min street+number
  if (!state.splitAddr && (!pStreet || !pNum)) {
    return "פיצול כתובת כבוי, אבל בפרויקט חסרים רחוב/מספר. או תמלא בפרויקט או תדליק פיצול כתובת ותמלא בממדים.";
  }

  for (const s of state.shelters) {
    // owner name must exist always
    const owner = state.splitName ? norm(s[SHELTER_OWNER_NAME_API]) : pn;
    if (!owner) return `יש ממד בלי שם (shelterOwnerName).`;

    // effective address (no city)
    const street = state.splitAddr ? norm(s[SHELTER_STREET_API]) : pStreet;
    const num = state.splitAddr ? norm(s[SHELTER_NUMBER_API]) : pNum;
    if (!street || !num) return `יש ממד בלי רחוב/מספר.`;

    // If project has values, shelter must have them (effective)
    const gush = state.splitAddr ? norm(s[SHELTER_GUSH_API]) : pGush;
    const helka = state.splitAddr ? norm(s[SHELTER_HELKA_API]) : pHelka;
    const migrash = state.splitAddr ? norm(s[SHELTER_MIGRASH_API]) : pMigrash;

    if (pGush && !gush) return `בפרויקט יש גוש, אבל באחד הממדים חסר גוש.`;
    if (pHelka && !helka) return `בפרויקט יש חלקה, אבל באחד הממדים חסרה חלקה.`;
    if (pMigrash && !migrash)
      return `בפרויקט יש מגרש, אבל באחד הממדים חסר מגרש.`;
  }

  return null;
}

async function runBatched(items, batchSize, worker, progressLabel) {
  let done = 0;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    // sequential per batch to be safe with rate limits
    for (const it of batch) {
      await worker(it);
      done += 1;
      showBanner("info", `${progressLabel} ${done}/${items.length}`);
    }
  }
}

async function onSave() {
  if (state.saving) return;

  const err = validateBeforeSave();
  if (err) {
    showBanner("err", err);
    return;
  }

  const pn = projectName();

  state.saving = true;
  el.btnSave.disabled = true;

  try {
    // 1) update project split flags if needed (OFF is saved here)
    const projUpdates = {};
    if (state.splitName !== state.splitNamePersisted)
      projUpdates[PROJECT_SPLIT_NAME_FIELD_API] = state.splitName;
    if (state.splitAddr !== state.splitAddrPersisted)
      projUpdates[PROJECT_SPLIT_ADDR_FIELD_API] = state.splitAddr;

    if (Object.keys(projUpdates).length) {
      showBanner("info", "שומר שינויים בפרויקט…");
      await zohoUpdateRecord(PROJECTS_MODULE_API, state.projectId, projUpdates);
      Object.assign(state.project, projUpdates);
      if (projUpdates[PROJECT_SPLIT_NAME_FIELD_API] !== undefined)
        state.splitNamePersisted = !!projUpdates[PROJECT_SPLIT_NAME_FIELD_API];
      if (projUpdates[PROJECT_SPLIT_ADDR_FIELD_API] !== undefined)
        state.splitAddrPersisted = !!projUpdates[PROJECT_SPLIT_ADDR_FIELD_API];
    }

    // 2) build shelter updates (only changed rows), BUT:
    //    אם Split OFF -> דריסה לערכי הפרויקט בעת Save (לפי דרישה)
    const pStreet = projectField(PROJECT_STREET_API);
    const pNum = projectField(PROJECT_NUMBER_API);
    const pGush = projectField(PROJECT_GUSH_API);
    const pHelka = projectField(PROJECT_HELKA_API);
    const pMigrash = projectField(PROJECT_MIGRASH_API);

    const updates = [];
    for (const s of state.shelters) {
      const id = getShelterId(s);
      const orig = getOriginal(id);
      if (!orig) continue;

      const patch = {};
      // Always-edit fields
      if (!fieldsEqual(s[SHELTER_REMARKS_API], orig[SHELTER_REMARKS_API]))
        patch[SHELTER_REMARKS_API] = s[SHELTER_REMARKS_API];

      // Name
      if (!state.splitName) {
        // force
        if (norm(s[SHELTER_OWNER_NAME_API]) !== norm(pn))
          patch[SHELTER_OWNER_NAME_API] = pn;
      } else {
        if (
          !fieldsEqual(s[SHELTER_OWNER_NAME_API], orig[SHELTER_OWNER_NAME_API])
        )
          patch[SHELTER_OWNER_NAME_API] = s[SHELTER_OWNER_NAME_API];
      }

      // Address
      if (!state.splitAddr) {
        // force
        if (norm(s[SHELTER_STREET_API]) !== norm(pStreet))
          patch[SHELTER_STREET_API] = pStreet;
        if (norm(s[SHELTER_NUMBER_API]) !== norm(pNum))
          patch[SHELTER_NUMBER_API] = pNum;
        if (norm(s[SHELTER_GUSH_API]) !== norm(pGush))
          patch[SHELTER_GUSH_API] = pGush;
        if (norm(s[SHELTER_HELKA_API]) !== norm(pHelka))
          patch[SHELTER_HELKA_API] = pHelka;
        if (norm(s[SHELTER_MIGRASH_API]) !== norm(pMigrash))
          patch[SHELTER_MIGRASH_API] = pMigrash;
      } else {
        const addrFields = [
          SHELTER_STREET_API,
          SHELTER_NUMBER_API,
          SHELTER_GUSH_API,
          SHELTER_HELKA_API,
          SHELTER_MIGRASH_API,
        ];
        for (const f of addrFields) {
          if (!fieldsEqual(s[f], orig[f])) patch[f] = s[f];
        }
      }

      if (Object.keys(patch).length) {
        updates.push({ id, patch });
      }
    }

    if (!updates.length) {
      showBanner("ok", "אין שינויים לשמירה.");
      state.saving = false;
      renderAll();
      return;
    }

    showBanner("info", `שומר ממדים… 0/${updates.length}`);

    await runBatched(
      updates,
      50,
      async (u) => {
        await zohoUpdateRecord(SHELTERS_MODULE_API, u.id, u.patch);
      },
      "Saving",
    );

    showBanner("ok", "נשמר בהצלחה.");

    // reload fresh to sync originals
    await loadAll();
  } catch (e) {
    showBanner("err", `נכשל לשמור: ${e.message || e}`);
  } finally {
    state.saving = false;
    renderAll();
    resizeAfterRender();
  }
}

async function onAdd() {
  if (state.saving) return;

  const pn = projectName();
  const fields = {
    [SHELTER_PROJECT_LOOKUP_API]: { id: state.projectId },
    [SHELTER_OWNER_NAME_API]: pn,
    [SHELTER_STREET_API]: projectField(PROJECT_STREET_API),
    [SHELTER_NUMBER_API]: projectField(PROJECT_NUMBER_API),
    [SHELTER_GUSH_API]: projectField(PROJECT_GUSH_API),
    [SHELTER_HELKA_API]: projectField(PROJECT_HELKA_API),
    [SHELTER_MIGRASH_API]: projectField(PROJECT_MIGRASH_API),
  };

  try {
    showBanner("info", "יוצר ממד חדש…");
    const res = await zohoInsertRecord(SHELTERS_MODULE_API, fields);
    const newId = res?.data?.[0]?.details?.id;
    if (!newId) throw new Error("Insert success but no id returned");

    // fetch full record and add
    const rec = await zohoGetRecord(SHELTERS_MODULE_API, newId);
    state.shelters.unshift(rec);
    state.originalById.set(newId, JSON.parse(JSON.stringify(rec)));

    showBanner("ok", "נוצר ממד חדש.");
    renderAll();
    el.grid.style.display = "table";
    el.empty.style.display = "none";
    resizeAfterRender();
  } catch (e) {
    showBanner("err", `נכשל ליצור ממד: ${e.message || e}`);
  }
}

async function onDeleteSelected() {
  if (!state.selectedIds.size) return;
  const ok = window.confirm(`למחוק ${state.selectedIds.size} ממדים?`);
  if (!ok) return;

  const ids = Array.from(state.selectedIds);

  try {
    showBanner("info", `מוחק… 0/${ids.length}`);
    await runBatched(
      ids,
      50,
      async (id) => {
        await zohoDeleteRecord(SHELTERS_MODULE_API, id);
      },
      "Deleting",
    );

    // remove locally
    state.shelters = state.shelters.filter(
      (s) => !state.selectedIds.has(getShelterId(s)),
    );
    for (const id of ids) state.originalById.delete(id);

    state.selectedIds = new Set();
    showBanner("ok", "נמחק בהצלחה.");
    renderAll();

    if (state.shelters.length === 0) {
      el.grid.style.display = "none";
      el.empty.style.display = "block";
    }
    resizeAfterRender();
  } catch (e) {
    showBanner("err", `נכשל למחוק: ${e.message || e}`);
  }
}

async function onRefresh() {
  if (!state.projectId) return;
  clearBanner();
  await loadAll();
}

/***********************
 * Bind UI
 ***********************/
function bindUI() {
  el.toggleSplitName.addEventListener("change", onToggleSplitName);
  el.toggleSplitAddr.addEventListener("change", onToggleSplitAddr);

  el.btnFillNames.addEventListener("click", onFillNames);
  el.btnFillAddr.addEventListener("click", onFillAddr);

  el.btnSave.addEventListener("click", onSave);
  el.btnAdd.addEventListener("click", onAdd);
  el.btnDelete.addEventListener("click", onDeleteSelected);
  el.btnRefresh.addEventListener("click", onRefresh);

  el.chkAll.addEventListener("change", () => {
    state.selectedIds = new Set();
    if (el.chkAll.checked) {
      for (const s of state.shelters) state.selectedIds.add(getShelterId(s));
    }
    renderAll();
    resizeAfterRender();
  });
}

/***********************
 * Init
 ***********************/
async function initZoho() {
  // URL param fallback (works even if PageLoad never arrives)
  const urlId = getRecordIdFromUrl();
  if (urlId) startWithProjectId(urlId, "url");

  // If SDK not available, show clear error (also prevents Parentwindow confusion)
  if (!state.insideZoho || !window.ZOHO?.embeddedApp) {
    showBanner(
      "err",
      "נראה שהווידג׳ט נפתח מחוץ ל-Zoho CRM (SDK לא זמין). חייב לפתוח דרך כפתור 'Open a Widget' בתוך ה-Detail View.",
    );
    resizeFor("list");
    return;
  }

  // Subscribe PageLoad BEFORE init (Zoho doc pattern)
  ZOHO.embeddedApp.on("PageLoad", function (data) {
    const pid = extractEntityIdFromPageLoad(data);
    if (pid) startWithProjectId(pid, "pageload");
  });

  try {
    // init handshake
    await ZOHO.embeddedApp.init();

    // If neither URL nor PageLoad gave an id after a short delay -> show error
    setTimeout(() => {
      if (!state.started) showNoIdError();
    }, 1200);
  } catch (e) {
    // Usually happens when opened outside iframe => Parentwindow reference not found
    showBanner(
      "err",
      "Parentwindow reference not found: הווידג׳ט חייב להיפתח מתוך Zoho CRM (לא לפתוח את ה-URL ישירות בדפדפן).",
    );
    resizeFor("list");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  bindUI();

  // Resize in open
  resize(1000);
  resizeFor("loading");

  initZoho();
});
