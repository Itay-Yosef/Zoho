// app.js

/***********************
 * CONFIG (API Names)
 ***********************/
const PROJECTS_MODULE_API = "projects";
const SHELTERS_MODULE_API = "shelters";

// Projects
const PROJECT_NAME_FIELD_API = "projectPremitHolder";
const PROJECT_SPLIT_NAME_FIELD_API = "projectIsNameSplit";
const PROJECT_SPLIT_ADDR_FIELD_API = "projectIsAddressSplit";

const PROJECT_CITY_API = "projectCity";
const PROJECT_STREET_API = "projectStreet";
const PROJECT_NUMBER_API = "projectHouse";
const PROJECT_GUSH_API = "projectBlock";
const PROJECT_HELKA_API = "projectParcel";
const PROJECT_MIGRASH_API = "projectLot";

// Shelters
const SHELTER_PROJECT_LOOKUP_API = "shelterProject";
const SHELTER_NAME_API = "Name"; // <-- חדש לפי בקשתך
const SHELTER_LOCATION_API = "shelterLocation"; // <-- חדש לפי בקשתך

const SHELTER_OWNER_NAME_API = "shelterPermitHolder";

const SHELTER_STREET_API = "shelterStreet";
const SHELTER_NUMBER_API = "shelterHouse";
const SHELTER_GUSH_API = "shelterBlock";
const SHELTER_HELKA_API = "shelterParcel";
const SHELTER_MIGRASH_API = "shelterLot";

const SHELTER_ENTRANCE_API = "shelterEntrance";
const SHELTER_FLOOR_API = "shelterFloor";
const SHELTER_APARTMENT_API = "shelterApartment";
const SHELTER_REMARKS_API = "shelterRemarks";

/***********************
 * UI: Elements
 ***********************/
const el = {
  banner: document.getElementById("banner"),
  bannerMsg: document.getElementById("bannerMsg"),
  bannerClose: document.getElementById("bannerClose"),

  headerTitle: document.getElementById("headerTitle"),
  headerSubtitle: document.getElementById("headerSubtitle"),
  metaCity: document.getElementById("metaCity"),
  metaAddr: document.getElementById("metaAddr"),
  modeLabel: document.getElementById("modeLabel"),

  btnRefresh: document.getElementById("btnRefresh"),
  btnAdd: document.getElementById("btnAdd"),
  btnDelete: document.getElementById("btnDelete"),
  btnSave: document.getElementById("btnSave"),
  dirtyHint: document.getElementById("dirtyHint"),

  toggleSplitName: document.getElementById("toggleSplitName"),
  toggleSplitAddr: document.getElementById("toggleSplitAddr"),
  btnFillName: document.getElementById("btnFillName"),
  btnFillAddr: document.getElementById("btnFillAddr"),

  centerState: document.getElementById("centerState"),
  grid: document.getElementById("grid"),
  gridHead: document.getElementById("gridHead"),
  gridBody: document.getElementById("gridBody"),
  tableScroll: document.getElementById("tableScroll"),

  modalBackdrop: document.getElementById("modalBackdrop"),
  modalTitle: document.getElementById("modalTitle"),
  modalBody: document.getElementById("modalBody"),
  modalActions: document.getElementById("modalActions"),
  modalX: document.getElementById("modalX"),
};

/***********************
 * State
 ***********************/
const state = {
  projectId: null,
  loadStarted: false,

  project: null,
  shelters: [], // visible rows
  deleted: [], // rows pending delete (existing rows only)
  tmpCounter: 1,

  // UI toggles (draft until save)
  splitName: false,
  splitAddr: false,

  // Track original split flags (from CRM) to know if project needs update
  originalSplitName: false,
  originalSplitAddr: false,

  // Active edit cell: { rowId, field } (for single-field cells)
  activeCell: null,

  // For address subfields: { rowId, field } also works
  // Dirty indicator
  isDirty: false,

  // Loading state
  view: "loading", // loading | list | empty | error
};

/***********************
 * Helpers
 ***********************/
function safeStr(v) {
  if (v === null || v === undefined) return "";
  return String(v);
}

function normalizeIdFromEntityId(entityId) {
  if (!entityId) return null;
  if (Array.isArray(entityId)) return entityId[0] ? String(entityId[0]) : null;
  return String(entityId);
}

function getUrlRecordId() {
  try {
    const u = new URL(window.location.href);
    const v = u.searchParams.get("recordId") || u.searchParams.get("RecordID");
    return v ? String(v) : null;
  } catch (_) {
    return null;
  }
}

function setBanner(type, msg) {
  el.banner.classList.remove("info", "ok", "warn", "danger", "show");
  el.banner.classList.add(type, "show");
  el.bannerMsg.textContent = msg;
}

function clearBanner() {
  el.banner.classList.remove("show");
  el.bannerMsg.textContent = "";
}

function openModal({ title, bodyHtml, actions }) {
  el.modalTitle.textContent = title || "";
  el.modalBody.innerHTML = bodyHtml || "";
  el.modalActions.innerHTML = "";
  (actions || []).forEach((a) => {
    const btn = document.createElement("button");
    btn.className = `btn ${a.variant || ""}`.trim();
    btn.textContent = a.label;
    btn.addEventListener("click", () => a.onClick && a.onClick());
    el.modalActions.appendChild(btn);
  });
  el.modalBackdrop.classList.add("show");
  el.modalBackdrop.setAttribute("aria-hidden", "false");
  resizeForUiState();
}

function closeModal() {
  el.modalBackdrop.classList.remove("show");
  el.modalBackdrop.setAttribute("aria-hidden", "true");
  el.modalTitle.textContent = "";
  el.modalBody.innerHTML = "";
  el.modalActions.innerHTML = "";
  resizeForUiState();
}

function confirmModal({
  title,
  message,
  confirmText,
  cancelText,
  variant,
  onConfirm,
  onCancel,
}) {
  openModal({
    title,
    bodyHtml: `<div>${message}</div>`,
    actions: [
      {
        label: cancelText || "ביטול",
        onClick: () => {
          closeModal();
          onCancel && onCancel();
        },
      },
      {
        label: confirmText || "אישור",
        variant: variant || "primary",
        onClick: async () => {
          closeModal();
          onConfirm && (await onConfirm());
        },
      },
    ],
  });
}

function infoModal({ title, html, okText }) {
  openModal({
    title,
    bodyHtml: html,
    actions: [
      {
        label: okText || "סגור",
        variant: "primary",
        onClick: () => closeModal(),
      },
    ],
  });
}

function isZohoReady() {
  return !!(window.ZOHO && ZOHO.embeddedApp && ZOHO.CRM && ZOHO.CRM.API);
}

function resize(height) {
  try {
    if (ZOHO && ZOHO.CRM && ZOHO.CRM.UI && ZOHO.CRM.UI.Resize) {
      return ZOHO.CRM.UI.Resize({ height });
    }
  } catch (_) {}
  return Promise.resolve();
}

function computeDesiredHeight() {
  // יותר גבוה כשיש עמודות פיצול / מודאל פתוח
  const base = state.view === "loading" ? 520 : 980;

  const extraForSplit =
    (state.splitName ? 120 : 0) + (state.splitAddr ? 220 : 0);
  const extraForModal = el.modalBackdrop.classList.contains("show") ? 120 : 0;

  const h = base + extraForSplit + extraForModal;
  return Math.max(520, Math.min(h, 1200));
}

function resizeOpen() {
  return resize(1000);
}

function resizeAfterRender() {
  const h = computeDesiredHeight();
  return resize(h);
}

function resizeForUiState() {
  // קטן ב-loading, גדול ב-list
  const h = computeDesiredHeight();
  return resize(h);
}

function setDirty(on) {
  state.isDirty = !!on;
  el.btnSave.disabled = !state.isDirty;
  el.dirtyHint.textContent = state.isDirty ? "יש שינויים שלא נשמרו" : "";
}

function markDirty() {
  if (!state.isDirty) setDirty(true);
}

function getProjectField(apiName) {
  return state.project ? state.project[apiName] : null;
}

function projectAddressLine() {
  const street = safeStr(getProjectField(PROJECT_STREET_API));
  const number = safeStr(getProjectField(PROJECT_NUMBER_API));
  const gush = safeStr(getProjectField(PROJECT_GUSH_API));
  const helka = safeStr(getProjectField(PROJECT_HELKA_API));
  const migrash = safeStr(getProjectField(PROJECT_MIGRASH_API));

  const parts = [];
  if (street || number)
    parts.push(`רחוב ${street} ${number}`.replace(/\s+/g, " ").trim());
  const ghm = [];
  if (gush) ghm.push(`גוש ${gush}`);
  if (helka) ghm.push(`חלקה ${helka}`);
  if (migrash) ghm.push(`מגרש ${migrash}`);
  if (ghm.length) parts.push(ghm.join(" | "));

  return parts.length ? parts.join(" | ") : "—";
}

function modeLabel() {
  if (state.splitName && state.splitAddr) return "פיצול שם + כתובת";
  if (state.splitName) return "פיצול שם";
  if (state.splitAddr) return "פיצול כתובת";
  return "ללא פיצול";
}

/***********************
 * Data mapping
 ***********************/
function createRowFromRecord(rec) {
  const row = {
    id: String(rec.id),
    isNew: false,
    pendingDelete: false,
    selected: false,

    fields: {
      [SHELTER_NAME_API]: safeStr(rec[SHELTER_NAME_API]),
      [SHELTER_LOCATION_API]: safeStr(rec[SHELTER_LOCATION_API]),
      [SHELTER_ENTRANCE_API]: safeStr(rec[SHELTER_ENTRANCE_API]),
      [SHELTER_FLOOR_API]: safeStr(rec[SHELTER_FLOOR_API]),
      [SHELTER_APARTMENT_API]: safeStr(rec[SHELTER_APARTMENT_API]),
      [SHELTER_REMARKS_API]: safeStr(rec[SHELTER_REMARKS_API]),

      [SHELTER_OWNER_NAME_API]: safeStr(rec[SHELTER_OWNER_NAME_API]),

      [SHELTER_STREET_API]: safeStr(rec[SHELTER_STREET_API]),
      [SHELTER_NUMBER_API]: safeStr(rec[SHELTER_NUMBER_API]),
      [SHELTER_GUSH_API]: safeStr(rec[SHELTER_GUSH_API]),
      [SHELTER_HELKA_API]: safeStr(rec[SHELTER_HELKA_API]),
      [SHELTER_MIGRASH_API]: safeStr(rec[SHELTER_MIGRASH_API]),
    },

    // For Zoho-like behavior: field stays as blue input if dirty
    dirtyFields: new Set(),
    invalid: false,
  };

  return row;
}

function createNewRow() {
  const row = {
    id: `tmp-${state.tmpCounter++}`,
    isNew: true,
    pendingDelete: false,
    selected: false,
    fields: {
      [SHELTER_NAME_API]: "",
      [SHELTER_LOCATION_API]: "",
      [SHELTER_ENTRANCE_API]: "",
      [SHELTER_FLOOR_API]: "",
      [SHELTER_APARTMENT_API]: "",
      [SHELTER_REMARKS_API]: "",

      [SHELTER_OWNER_NAME_API]: "",

      [SHELTER_STREET_API]: "",
      [SHELTER_NUMBER_API]: "",
      [SHELTER_GUSH_API]: "",
      [SHELTER_HELKA_API]: "",
      [SHELTER_MIGRASH_API]: "",
    },
    dirtyFields: new Set([SHELTER_NAME_API, SHELTER_FLOOR_API]), // כדי שיראו input כחול ישר
    invalid: false,
  };

  // אם פיצול כתובת כבוי בזמן יצירה, עדיין נשמור בפרטי הרשומה על בסיס כתובת פרויקט בעת שמירה
  // אם פיצול כתובת דלוק, אפשר למלא לפי כפתור Fill.

  // אם פיצול שם כבוי, owner יידרס בעת שמירה; אם דלוק – המשתמש יכניס.
  return row;
}

function findRow(rowId) {
  return state.shelters.find((r) => r.id === rowId);
}

/***********************
 * Zoho API calls
 ***********************/
async function zohoGetRecord(moduleApi, recordId) {
  return ZOHO.CRM.API.getRecord({ Entity: moduleApi, RecordID: recordId });
}

async function zohoSearchAll(moduleApi, criteria, perPage = 200) {
  const all = [];
  let page = 1;
  while (true) {
    const res = await ZOHO.CRM.API.searchRecord({
      Entity: moduleApi,
      Type: "criteria",
      Query: criteria,
      page,
      per_page: perPage,
    });

    const data = res && res.data ? res.data : [];
    all.push(...data);

    const more = res && res.info && res.info.more_records;
    if (!more) break;
    page += 1;
  }
  return all;
}

async function zohoUpdateRecord(moduleApi, apiData) {
  return ZOHO.CRM.API.updateRecord({ Entity: moduleApi, APIData: apiData });
}

async function zohoInsertRecord(moduleApi, apiData) {
  return ZOHO.CRM.API.insertRecord({ Entity: moduleApi, APIData: apiData });
}

async function zohoDeleteRecord(moduleApi, recordId) {
  return ZOHO.CRM.API.deleteRecord({ Entity: moduleApi, RecordID: recordId });
}

/***********************
 * Load
 ***********************/
async function loadAll() {
  state.view = "loading";
  render();
  resizeForUiState();

  try {
    // Project
    const pr = await zohoGetRecord(PROJECTS_MODULE_API, state.projectId);
    const projectRec = pr && pr.data && pr.data[0] ? pr.data[0] : null;
    if (!projectRec) throw new Error("Project not found");

    state.project = projectRec;

    // split flags from CRM
    state.originalSplitName = !!projectRec[PROJECT_SPLIT_NAME_FIELD_API];
    state.originalSplitAddr = !!projectRec[PROJECT_SPLIT_ADDR_FIELD_API];
    state.splitName = state.originalSplitName;
    state.splitAddr = state.originalSplitAddr;

    // Shelters by criteria (lookup)
    const criteria = `(${SHELTER_PROJECT_LOOKUP_API}:equals:${state.projectId})`;
    const shelters = await zohoSearchAll(SHELTERS_MODULE_API, criteria, 200);

    state.shelters = shelters.map(createRowFromRecord);
    state.deleted = [];

    // reset dirty
    setDirty(false);
    state.activeCell = null;

    state.view = state.shelters.length ? "list" : "empty";
    clearBanner();
  } catch (err) {
    state.view = "error";
    setBanner(
      "danger",
      `שגיאה בטעינה: ${safeStr(err && err.message ? err.message : err)}`,
    );
  }

  render();
  resizeAfterRender();
}

/***********************
 * Render
 ***********************/
function setCenter(text) {
  el.centerState.textContent = text;
  el.centerState.style.display = "block";
  el.grid.style.display = "none";
}

function showGrid() {
  el.centerState.style.display = "none";
  el.grid.style.display = "table";
}

function renderHeader() {
  const projectName = safeStr(getProjectField(PROJECT_NAME_FIELD_API)) || "—";
  const city = safeStr(getProjectField(PROJECT_CITY_API)) || "—";

  el.headerTitle.textContent = `[${projectName}]`;
  el.headerSubtitle.textContent = `[כתובת הפרויקט]`;

  el.metaCity.textContent = `עיר: ${city}`;
  el.metaAddr.textContent = `כתובת פרויקט: ${projectAddressLine()}`;
  el.modeLabel.textContent = modeLabel();

  // toggles
  el.toggleSplitName.checked = !!state.splitName;
  el.toggleSplitAddr.checked = !!state.splitAddr;

  // fill buttons
  el.btnFillName.style.display = state.splitName ? "inline-block" : "none";
  el.btnFillAddr.style.display = state.splitAddr ? "inline-block" : "none";
}

function th(label, extraClass = "") {
  return `<th class="${extraClass}">${label}</th>`;
}

function renderHead() {
  // order like your sketch (checkbox at far right)
  const cols = [];

  cols.push(th("בחירה", "col-select"));

  cols.push(th("מיקום ממד"));
  cols.push(th("כניסה"));
  cols.push(th(`קומה <span class="req">*</span>`));
  cols.push(th("דירה"));
  cols.push(th(`שם <span class="req">*</span>`)); // Shelter Name

  if (state.splitName) cols.push(th(`שם בעל היתר <span class="req">*</span>`));

  if (state.splitAddr) cols.push(th("כתובת"));

  cols.push(th("הערות"));

  el.gridHead.innerHTML = `<tr>${cols.join("")}</tr>`;
}

function isFieldEditable(fieldApi) {
  // תמיד ניתן לערוך בעמודות הבסיס
  // split columns editable רק כשהפיצול דלוק
  if (fieldApi === SHELTER_OWNER_NAME_API) return !!state.splitName;
  if (
    fieldApi === SHELTER_STREET_API ||
    fieldApi === SHELTER_NUMBER_API ||
    fieldApi === SHELTER_GUSH_API ||
    fieldApi === SHELTER_HELKA_API ||
    fieldApi === SHELTER_MIGRASH_API
  )
    return !!state.splitAddr;

  return true;
}

function shouldShowInput(row, fieldApi) {
  if (!isFieldEditable(fieldApi)) return false; // hidden anyway
  if (row.isNew) return true; // new rows are always editable in blue
  if (row.dirtyFields.has(fieldApi)) return true; // keep blue input until save
  if (
    state.activeCell &&
    state.activeCell.rowId === row.id &&
    state.activeCell.field === fieldApi
  )
    return true;
  return false;
}

function cellEditable(row, fieldApi, placeholder = "") {
  const val = safeStr(row.fields[fieldApi]);
  const editable = isFieldEditable(fieldApi);
  const showInput = editable && shouldShowInput(row, fieldApi);

  if (!editable) {
    // not used currently (we hide split columns when off), but keep safe
    return `<div class="cell-text muted" title="נלקח מהפרויקט">נלקח מהפרויקט</div>`;
  }

  if (showInput) {
    return `<input class="z-input" data-row="${row.id}" data-field="${fieldApi}" value="${escapeHtml(val)}" placeholder="${escapeHtml(
      placeholder,
    )}" />`;
  }

  const text = val || "—";
  const muted = val ? "" : " muted";
  return `<div class="cell-text${muted}" data-activate="1" data-row="${row.id}" data-field="${fieldApi}" title="לחץ לעריכה">${escapeHtml(
    text,
  )}</div>`;
}

function escapeHtml(str) {
  return safeStr(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderAddressCell(row) {
  const city = safeStr(getProjectField(PROJECT_CITY_API)) || "—";

  // address fields are editable only when splitAddr is ON (and this column appears only then)
  const street = cellEditable(row, SHELTER_STREET_API, "רחוב");
  const number = cellEditable(row, SHELTER_NUMBER_API, "מספר");
  const gush = cellEditable(row, SHELTER_GUSH_API, "גוש");
  const helka = cellEditable(row, SHELTER_HELKA_API, "חלקה");
  const migrash = cellEditable(row, SHELTER_MIGRASH_API, "מגרש");

  return `
    <div class="addr-box">
      <div class="addr-row">
        <div class="addr-label">רחוב</div>
        ${street}
      </div>
      <div class="addr-row">
        <div class="addr-label">עיר (מתוך הפרויקט)</div>
        <div class="addr-ro">${escapeHtml(city)}</div>
      </div>
      <div class="addr-row">
        <div class="addr-label">מספר</div>
        ${number}
      </div>
      <div class="addr-row">
        <div class="addr-label">גוש</div>
        ${gush}
      </div>
      <div class="addr-row">
        <div class="addr-label">חלקה</div>
        ${helka}
      </div>
      <div class="addr-row">
        <div class="addr-label">מגרש</div>
        ${migrash}
      </div>
    </div>
  `;
}

function renderBody() {
  const rowsHtml = state.shelters
    .filter((r) => !r.pendingDelete)
    .map((row) => {
      const cols = [];

      cols.push(`
        <td class="col-select">
          <input type="checkbox" data-select="1" data-row="${row.id}" ${row.selected ? "checked" : ""} />
        </td>
      `);

      cols.push(`<td>${cellEditable(row, SHELTER_LOCATION_API, "מיקום")}</td>`);
      cols.push(`<td>${cellEditable(row, SHELTER_ENTRANCE_API, "כניסה")}</td>`);
      cols.push(`<td>${cellEditable(row, SHELTER_FLOOR_API, "קומה")}</td>`);
      cols.push(`<td>${cellEditable(row, SHELTER_APARTMENT_API, "דירה")}</td>`);
      cols.push(`<td>${cellEditable(row, SHELTER_NAME_API, "שם")}</td>`);

      if (state.splitName)
        cols.push(
          `<td>${cellEditable(row, SHELTER_OWNER_NAME_API, "שם בעל היתר")}</td>`,
        );
      if (state.splitAddr) cols.push(`<td>${renderAddressCell(row)}</td>`);

      cols.push(`<td>${cellEditable(row, SHELTER_REMARKS_API, "הערות")}</td>`);

      const trClass = row.invalid ? "row-invalid" : "";
      return `<tr class="${trClass}" data-row-tr="${row.id}">${cols.join("")}</tr>`;
    })
    .join("");

  el.gridBody.innerHTML = rowsHtml || "";
}

function render() {
  renderHeader();

  if (state.view === "loading") {
    setCenter("טוען...");
    el.btnDelete.style.display = "none";
    resizeForUiState();
    return;
  }

  if (state.view === "error") {
    setCenter("אירעה שגיאה. בדוק הודעה למעלה.");
    el.btnDelete.style.display = "none";
    resizeForUiState();
    return;
  }

  if (state.view === "empty") {
    renderHead();
    setCenter("אין ממדים לפרויקט.");
    el.btnDelete.style.display = "none";
    resizeForUiState();
    return;
  }

  // list
  renderHead();
  showGrid();
  renderBody();

  // delete button show/hide
  const selectedCount = state.shelters.filter(
    (r) => r.selected && !r.pendingDelete,
  ).length;
  el.btnDelete.style.display = selectedCount > 0 ? "inline-flex" : "none";

  // focus active input if exists
  if (state.activeCell) {
    const q = `input[data-row="${CSS.escape(state.activeCell.rowId)}"][data-field="${CSS.escape(state.activeCell.field)}"]`;
    const input = document.querySelector(q);
    if (input) {
      input.focus();
      input.select();
    }
  }

  resizeAfterRender();
}

/***********************
 * Validation (before save)
 ***********************/
function validateRows() {
  const problems = [];

  // reset invalid
  state.shelters.forEach((r) => (r.invalid = false));

  const visible = state.shelters.filter((r) => !r.pendingDelete);

  for (const row of visible) {
    const rowProblems = [];

    // Required now: only Floor + Name (and owner name if splitName ON)
    const nameVal = safeStr(row.fields[SHELTER_NAME_API]).trim();
    const floorVal = safeStr(row.fields[SHELTER_FLOOR_API]).trim();

    if (!nameVal) rowProblems.push("שם חסר");
    if (!floorVal) rowProblems.push("קומה חסרה");

    if (state.splitName) {
      const ownerVal = safeStr(row.fields[SHELTER_OWNER_NAME_API]).trim();
      if (!ownerVal) rowProblems.push("שם בעל היתר חסר");
    }

    if (rowProblems.length) {
      row.invalid = true;
      problems.push({ row, issues: rowProblems });
    }
  }

  return problems;
}

/***********************
 * Split logic (UI)
 ***********************/
function onToggleSplitName(newVal) {
  const was = state.splitName;
  state.splitName = !!newVal;

  // אם עוברים OFF -> ON: לפי הבקשה שלך, העמודה נפתחת "ריקה" וחייבים למלא
  if (!was && state.splitName) {
    state.shelters.forEach((r) => {
      if (r.pendingDelete) return;
      r.fields[SHELTER_OWNER_NAME_API] = "";
      r.dirtyFields.add(SHELTER_OWNER_NAME_API);
    });
    markDirty();
  }

  // אם עוברים ON -> OFF: לא מוחקים כלום עכשיו. הדריסה תקרה רק ב-Save (כמו שביקשת)
  if (was && !state.splitName) {
    // אין צורך לסמן dirty לכל שורה עכשיו; מספיק שמצב הפרויקט השתנה
    markDirty();
  }

  render();
}

function onToggleSplitAddr(newVal) {
  const was = state.splitAddr;
  state.splitAddr = !!newVal;

  // אם עוברים OFF -> ON: נפתח כתובת עם ערכי הפרויקט כברירת מחדל (כדי לא להתחיל מ-null)
  if (!was && state.splitAddr) {
    const pStreet = safeStr(getProjectField(PROJECT_STREET_API));
    const pNumber = safeStr(getProjectField(PROJECT_NUMBER_API));
    const pGush = safeStr(getProjectField(PROJECT_GUSH_API));
    const pHelka = safeStr(getProjectField(PROJECT_HELKA_API));
    const pMigrash = safeStr(getProjectField(PROJECT_MIGRASH_API));

    state.shelters.forEach((r) => {
      if (r.pendingDelete) return;

      // רק אם ריק – למלא מהפרויקט (כדי לא לדרוס אם כבר היה פיצול בעבר)
      if (!safeStr(r.fields[SHELTER_STREET_API]).trim())
        r.fields[SHELTER_STREET_API] = pStreet;
      if (!safeStr(r.fields[SHELTER_NUMBER_API]).trim())
        r.fields[SHELTER_NUMBER_API] = pNumber;
      if (!safeStr(r.fields[SHELTER_GUSH_API]).trim())
        r.fields[SHELTER_GUSH_API] = pGush;
      if (!safeStr(r.fields[SHELTER_HELKA_API]).trim())
        r.fields[SHELTER_HELKA_API] = pHelka;
      if (!safeStr(r.fields[SHELTER_MIGRASH_API]).trim())
        r.fields[SHELTER_MIGRASH_API] = pMigrash;

      // לא מסמנים dirty אוטומטית כאן (כדי שלא יהפוך הכל לכחול ישר),
      // רק כשהמשתמש משנה בפועל.
    });

    markDirty();
  }

  // ON -> OFF: הדריסה תקרה רק ב-Save
  if (was && !state.splitAddr) {
    markDirty();
  }

  render();
}

/***********************
 * Fill buttons
 ***********************/
function fillNamesFromProject() {
  const projectName = safeStr(getProjectField(PROJECT_NAME_FIELD_API)).trim();
  state.shelters.forEach((r) => {
    if (r.pendingDelete) return;
    r.fields[SHELTER_OWNER_NAME_API] = projectName;
    r.dirtyFields.add(SHELTER_OWNER_NAME_API);
  });
  markDirty();
  render();
}

function fillAddrFromProject() {
  const pStreet = safeStr(getProjectField(PROJECT_STREET_API));
  const pNumber = safeStr(getProjectField(PROJECT_NUMBER_API));
  const pGush = safeStr(getProjectField(PROJECT_GUSH_API));
  const pHelka = safeStr(getProjectField(PROJECT_HELKA_API));
  const pMigrash = safeStr(getProjectField(PROJECT_MIGRASH_API));

  state.shelters.forEach((r) => {
    if (r.pendingDelete) return;
    r.fields[SHELTER_STREET_API] = pStreet;
    r.fields[SHELTER_NUMBER_API] = pNumber;
    r.fields[SHELTER_GUSH_API] = pGush;
    r.fields[SHELTER_HELKA_API] = pHelka;
    r.fields[SHELTER_MIGRASH_API] = pMigrash;

    r.dirtyFields.add(SHELTER_STREET_API);
    r.dirtyFields.add(SHELTER_NUMBER_API);
    r.dirtyFields.add(SHELTER_GUSH_API);
    r.dirtyFields.add(SHELTER_HELKA_API);
    r.dirtyFields.add(SHELTER_MIGRASH_API);
  });

  markDirty();
  render();
}

/***********************
 * CRUD (draft)
 ***********************/
function addRowDraft() {
  state.shelters.unshift(createNewRow());
  markDirty();
  state.view = "list";
  render();
  setBanner("info", "נוסף ממד חדש (טיוטה). הוא ייווצר רק בעת שמירה.");
}

function deleteSelectedDraft() {
  const selected = state.shelters.filter((r) => r.selected && !r.pendingDelete);
  if (!selected.length) return;

  confirmModal({
    title: "מחיקת ממדים",
    message: `בטוח למחוק ${selected.length} ממד(ים)?<br/><span style="color:#6b7280">המחיקה האמיתית תתבצע רק לאחר שמירה.</span>`,
    confirmText: "כן, למחוק (טיוטה)",
    cancelText: "ביטול",
    variant: "danger",
    onConfirm: () => {
      selected.forEach((r) => {
        r.pendingDelete = true;
        r.selected = false;
        if (!r.isNew) state.deleted.push(r);
      });
      markDirty();
      render();
      setBanner(
        "warn",
        `סומנו למחיקה ${selected.length} ממד(ים). אל תשכח לשמור כדי לבצע מחיקה בפועל.`,
      );
    },
  });
}

/***********************
 * Save (real)
 ***********************/
function buildProjectUpdatePayloadIfNeeded() {
  const needs =
    state.splitName !== state.originalSplitName ||
    state.splitAddr !== state.originalSplitAddr;

  if (!needs) return null;

  return {
    id: state.projectId,
    [PROJECT_SPLIT_NAME_FIELD_API]: !!state.splitName,
    [PROJECT_SPLIT_ADDR_FIELD_API]: !!state.splitAddr,
  };
}

function buildShelterPayload(row) {
  const apiData = { id: row.id };

  // always allow updating these if dirty (or if forced by split off)
  const setIfDirty = (fieldApi) => {
    if (row.dirtyFields.has(fieldApi))
      apiData[fieldApi] = safeStr(row.fields[fieldApi]);
  };

  setIfDirty(SHELTER_NAME_API);
  setIfDirty(SHELTER_LOCATION_API);
  setIfDirty(SHELTER_ENTRANCE_API);
  setIfDirty(SHELTER_FLOOR_API);
  setIfDirty(SHELTER_APARTMENT_API);
  setIfDirty(SHELTER_REMARKS_API);

  // splitName ON: update if dirty
  if (state.splitName) {
    setIfDirty(SHELTER_OWNER_NAME_API);
  } else {
    // splitName OFF: force owner name = project name
    apiData[SHELTER_OWNER_NAME_API] = safeStr(
      getProjectField(PROJECT_NAME_FIELD_API),
    );
  }

  // splitAddr ON: update address fields only if dirty
  if (state.splitAddr) {
    setIfDirty(SHELTER_STREET_API);
    setIfDirty(SHELTER_NUMBER_API);
    setIfDirty(SHELTER_GUSH_API);
    setIfDirty(SHELTER_HELKA_API);
    setIfDirty(SHELTER_MIGRASH_API);
  } else {
    // splitAddr OFF: force address fields = project values
    apiData[SHELTER_STREET_API] = safeStr(getProjectField(PROJECT_STREET_API));
    apiData[SHELTER_NUMBER_API] = safeStr(getProjectField(PROJECT_NUMBER_API));
    apiData[SHELTER_GUSH_API] = safeStr(getProjectField(PROJECT_GUSH_API));
    apiData[SHELTER_HELKA_API] = safeStr(getProjectField(PROJECT_HELKA_API));
    apiData[SHELTER_MIGRASH_API] = safeStr(
      getProjectField(PROJECT_MIGRASH_API),
    );
  }

  return apiData;
}

function buildShelterInsertPayload(row) {
  const apiData = {};

  // lookup to project
  apiData[SHELTER_PROJECT_LOOKUP_API] = { id: state.projectId };

  // required by your current validation
  apiData[SHELTER_NAME_API] = safeStr(row.fields[SHELTER_NAME_API]);
  apiData[SHELTER_FLOOR_API] = safeStr(row.fields[SHELTER_FLOOR_API]);

  // optional
  apiData[SHELTER_LOCATION_API] = safeStr(row.fields[SHELTER_LOCATION_API]);
  apiData[SHELTER_ENTRANCE_API] = safeStr(row.fields[SHELTER_ENTRANCE_API]);
  apiData[SHELTER_APARTMENT_API] = safeStr(row.fields[SHELTER_APARTMENT_API]);
  apiData[SHELTER_REMARKS_API] = safeStr(row.fields[SHELTER_REMARKS_API]);

  // split policy
  if (state.splitName)
    apiData[SHELTER_OWNER_NAME_API] = safeStr(
      row.fields[SHELTER_OWNER_NAME_API],
    );
  else
    apiData[SHELTER_OWNER_NAME_API] = safeStr(
      getProjectField(PROJECT_NAME_FIELD_API),
    );

  if (state.splitAddr) {
    apiData[SHELTER_STREET_API] = safeStr(row.fields[SHELTER_STREET_API]);
    apiData[SHELTER_NUMBER_API] = safeStr(row.fields[SHELTER_NUMBER_API]);
    apiData[SHELTER_GUSH_API] = safeStr(row.fields[SHELTER_GUSH_API]);
    apiData[SHELTER_HELKA_API] = safeStr(row.fields[SHELTER_HELKA_API]);
    apiData[SHELTER_MIGRASH_API] = safeStr(row.fields[SHELTER_MIGRASH_API]);
  } else {
    apiData[SHELTER_STREET_API] = safeStr(getProjectField(PROJECT_STREET_API));
    apiData[SHELTER_NUMBER_API] = safeStr(getProjectField(PROJECT_NUMBER_API));
    apiData[SHELTER_GUSH_API] = safeStr(getProjectField(PROJECT_GUSH_API));
    apiData[SHELTER_HELKA_API] = safeStr(getProjectField(PROJECT_HELKA_API));
    apiData[SHELTER_MIGRASH_API] = safeStr(
      getProjectField(PROJECT_MIGRASH_API),
    );
  }

  return apiData;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function batchRun(items, batchSize, runner, onProgress) {
  const batches = chunk(items, batchSize);
  let done = 0;
  const total = items.length;

  for (const b of batches) {
    const results = await Promise.allSettled(b.map((x) => runner(x)));
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      done += 1;
      onProgress && onProgress(done, total);

      if (r.status === "rejected") {
        throw r.reason || new Error("Batch failed");
      }
    }
  }
}

async function saveAll() {
  const problems = validateRows();
  if (problems.length) {
    const lines = problems
      .map((p) => {
        const n = safeStr(p.row.fields[SHELTER_NAME_API]).trim() || p.row.id;
        return `• <b>${escapeHtml(n)}</b>: ${escapeHtml(p.issues.join(", "))}`;
      })
      .join("<br/>");

    infoModal({
      title: "לא ניתן לשמור",
      html: `<div style="margin-bottom:8px;color:#b42318;font-weight:800;">יש ממדים לא חוקיים.</div><div>${lines}</div>`,
      okText: "חזרה לעריכה",
    });

    render();
    return;
  }

  const newRows = state.shelters.filter((r) => r.isNew && !r.pendingDelete);
  const delRows = state.deleted.slice(); // existing only
  const updRows = state.shelters.filter(
    (r) =>
      !r.isNew &&
      !r.pendingDelete &&
      (r.dirtyFields.size > 0 || !state.splitName || !state.splitAddr),
  );

  const projectUpd = buildProjectUpdatePayloadIfNeeded();

  confirmModal({
    title: "שמירה",
    message: `בטוח לשמור?<br/><div style="margin-top:8px;color:#6b7280">
      יצירה: <b>${newRows.length}</b> | עדכון: <b>${updRows.length}</b> | מחיקה: <b>${delRows.length}</b>
    </div>`,
    confirmText: "כן, לשמור",
    cancelText: "ביטול",
    variant: "primary",
    onConfirm: async () => {
      try {
        setBanner("info", "שומר...");
        resizeForUiState();

        // Update Project flags (if needed)
        if (projectUpd) {
          await zohoUpdateRecord(PROJECTS_MODULE_API, projectUpd);
        }

        // Inserts
        if (newRows.length) {
          await batchRun(
            newRows,
            50,
            async (row) => {
              const apiData = buildShelterInsertPayload(row);
              return zohoInsertRecord(SHELTERS_MODULE_API, apiData);
            },
            (d, t) => setBanner("info", `שומר... (יצירה ${d}/${t})`),
          );
        }

        // Updates (only if something to update)
        if (updRows.length) {
          await batchRun(
            updRows,
            50,
            async (row) => {
              const apiData = buildShelterPayload(row);
              return zohoUpdateRecord(SHELTERS_MODULE_API, apiData);
            },
            (d, t) => setBanner("info", `שומר... (עדכון ${d}/${t})`),
          );
        }

        // Deletes
        if (delRows.length) {
          await batchRun(
            delRows,
            50,
            async (row) => zohoDeleteRecord(SHELTERS_MODULE_API, row.id),
            (d, t) => setBanner("info", `שומר... (מחיקה ${d}/${t})`),
          );
        }

        setBanner("ok", "נשמר בהצלחה. סוגר...");
        setDirty(false);

        // close popup (button-invoked widget)
        await tryCloseWidget();
      } catch (err) {
        setBanner(
          "danger",
          `שמירה נכשלה: ${safeStr(err && err.message ? err.message : err)}`,
        );
        render();
      } finally {
        resizeAfterRender();
      }
    },
    onCancel: () => {
      // stay on edit
    },
  });
}

async function tryCloseWidget() {
  try {
    if (
      ZOHO &&
      ZOHO.CRM &&
      ZOHO.CRM.UI &&
      ZOHO.CRM.UI.Popup &&
      typeof ZOHO.CRM.UI.Popup.close === "function"
    ) {
      await ZOHO.CRM.UI.Popup.close();
      return;
    }
  } catch (_) {}

  try {
    if (
      ZOHO &&
      ZOHO.embeddedApp &&
      typeof ZOHO.embeddedApp.close === "function"
    ) {
      await ZOHO.embeddedApp.close();
      return;
    }
  } catch (_) {}

  // fallback: reload close
  try {
    if (
      ZOHO &&
      ZOHO.CRM &&
      ZOHO.CRM.UI &&
      ZOHO.CRM.UI.Popup &&
      typeof ZOHO.CRM.UI.Popup.closeReload === "function"
    ) {
      await ZOHO.CRM.UI.Popup.closeReload();
    }
  } catch (_) {}
}

/***********************
 * Events
 ***********************/
el.bannerClose.addEventListener("click", () => clearBanner());
el.modalX.addEventListener("click", () => closeModal());
el.modalBackdrop.addEventListener("click", (e) => {
  if (e.target === el.modalBackdrop) closeModal();
});

el.btnRefresh.addEventListener("click", () => {
  if (state.isDirty) {
    confirmModal({
      title: "רענון",
      message: "לרענן? שינויים שביצעת לא ישמרו.",
      confirmText: "כן, לרענן",
      cancelText: "ביטול",
      variant: "primary",
      onConfirm: async () => {
        clearBanner();
        await loadAll();
      },
    });
  } else {
    loadAll();
  }
});

el.btnAdd.addEventListener("click", () => addRowDraft());

el.btnDelete.addEventListener("click", () => deleteSelectedDraft());

el.btnSave.addEventListener("click", () => {
  if (el.btnSave.disabled) return;
  saveAll();
});

el.toggleSplitName.addEventListener("change", (e) =>
  onToggleSplitName(e.target.checked),
);
el.toggleSplitAddr.addEventListener("change", (e) =>
  onToggleSplitAddr(e.target.checked),
);

el.btnFillName.addEventListener("click", () => {
  confirmModal({
    title: "מילוי שמות",
    message: "זה ידרוס את כל שמות הממדים. בטוח?",
    confirmText: "כן, לדרוס",
    cancelText: "ביטול",
    variant: "danger",
    onConfirm: () => fillNamesFromProject(),
  });
});

el.btnFillAddr.addEventListener("click", () => {
  confirmModal({
    title: "מילוי כתובות",
    message: "זה ידרוס את כל כתובות הממדים (ללא עיר). בטוח?",
    confirmText: "כן, לדרוס",
    cancelText: "ביטול",
    variant: "danger",
    onConfirm: () => fillAddrFromProject(),
  });
});

// Delegated events for table (click to edit, selection, input changes)
document.addEventListener("click", async (e) => {
  const t = e.target;

  // selection checkbox
  if (t && t.matches && t.matches('input[type="checkbox"][data-select="1"]')) {
    const rowId = t.getAttribute("data-row");
    const row = findRow(rowId);
    if (!row) return;
    row.selected = !!t.checked;
    render();
    return;
  }

  // click-to-edit on cell-text
  if (t && t.getAttribute) {
    const activate = t.getAttribute("data-activate");
    if (activate === "1") {
      const rowId = t.getAttribute("data-row");
      const field = t.getAttribute("data-field");
      const row = findRow(rowId);
      if (!row) return;
      if (!isFieldEditable(field)) return;

      state.activeCell = { rowId, field };
      render();
      return;
    }
  }
});

document.addEventListener("input", (e) => {
  const t = e.target;
  if (!(t && t.matches && t.matches("input.z-input[data-row][data-field]")))
    return;

  const rowId = t.getAttribute("data-row");
  const field = t.getAttribute("data-field");
  const row = findRow(rowId);
  if (!row) return;

  row.fields[field] = t.value;
  row.dirtyFields.add(field);
  markDirty();
});

document.addEventListener("focusout", (e) => {
  const t = e.target;
  if (!(t && t.matches && t.matches("input.z-input[data-row][data-field]")))
    return;

  const rowId = t.getAttribute("data-row");
  const field = t.getAttribute("data-field");
  if (
    state.activeCell &&
    state.activeCell.rowId === rowId &&
    state.activeCell.field === field
  ) {
    // אם השדה לא dirty ולא חדש, חוזר לתצוגה רגילה
    const row = findRow(rowId);
    if (row && !row.isNew && !row.dirtyFields.has(field)) {
      state.activeCell = null;
      render();
    } else {
      // להשאיר כחול אם dirty/new
      state.activeCell = null;
    }
  }
});

/***********************
 * Init
 ***********************/
function showMissingIdError() {
  state.view = "error";
  setBanner("danger", "לא התקבל מזהה פרויקט (recordId) מהכפתור");
  render();
  resizeForUiState();
}

function startLoadOnce() {
  if (state.loadStarted) return;
  state.loadStarted = true;

  resizeOpen();
  loadAll();
}

(function init() {
  // Basic SDK check
  if (!window.ZOHO || !ZOHO.embeddedApp) {
    setBanner("danger", "Zoho SDK לא נטען. הפעל את הווידג׳ט מתוך Zoho CRM.");
    state.view = "error";
    render();
    return;
  }

  // Listen PageLoad (button / related list / detail view)
  ZOHO.embeddedApp.on("PageLoad", function (data) {
    const id = normalizeIdFromEntityId(data && data.EntityId);
    if (id && !state.projectId) {
      state.projectId = id;
      startLoadOnce();
    }
  });

  ZOHO.embeddedApp
    .init()
    .then(() => {
      // URL param support
      const urlId = getUrlRecordId();
      if (urlId && !state.projectId) {
        state.projectId = urlId;
      }

      // If we already have ID, load now
      if (state.projectId) {
        startLoadOnce();
        return;
      }

      // Wait a bit for PageLoad (some contexts fire slightly later)
      setTimeout(() => {
        if (!state.projectId) showMissingIdError();
      }, 900);

      resizeOpen();
    })
    .catch(() => {
      setBanner("danger", "שגיאת init מול Zoho. נסה לרענן את הדף.");
      state.view = "error";
      render();
    });
})();
