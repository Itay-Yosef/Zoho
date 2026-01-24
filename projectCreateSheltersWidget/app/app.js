/***********************
 * CONFIG (שלך)
 ***********************/
const MODULE_SHELTERS = "shelters"; // API name אצלך
const FIELD_NAME = "Name";
const FIELD_LOCATION = "shelterLocation";
const FIELD_ENTRANCE = "shelterEntrance";
const FIELD_APARTMENT = "shelterApartment";
const FIELD_FLOOR = "shelterFloor";
const FIELD_REMARKS = "shelterRemarks";
const FIELD_PROJECT = "shelterProject"; // lookup ל-Projects

/***********************
 * STATE
 ***********************/
let currentProjectId = null;
let resolvedEntity = null;
let sheltersModuleApiName = MODULE_SHELTERS; // נעדכן לפי META אם נצליח
let resizeRaf = null;
let pageLoadData = null;

/***********************
 * DOM
 ***********************/
const rowsContainer = document.getElementById("rowsContainer");
const addRowBtn = document.getElementById("addRow");
const saveBtn = document.getElementById("saveBtn");
const alertEl = document.getElementById("alert");
const stateEl = document.getElementById("state");

/***********************
 * UI helpers
 ***********************/
function setAlert(type, message) {
  if (!alertEl) return;
  if (!message) {
    alertEl.style.display = "none";
    alertEl.textContent = "";
    alertEl.className = "alert";
    return;
  }
  alertEl.className = `alert ${type || "info"}`;
  alertEl.textContent = message;
  alertEl.style.display = "block";
}

function setState(message) {
  if (!stateEl) return;
  if (!message) {
    stateEl.style.display = "none";
    stateEl.textContent = "";
    return;
  }
  stateEl.style.display = "block";
  stateEl.textContent = message;
}

function disableUi(isDisabled) {
  if (addRowBtn) addRowBtn.disabled = isDisabled;
  if (saveBtn) saveBtn.disabled = isDisabled;

  if (!rowsContainer) return;
  rowsContainer.querySelectorAll("input, button.remove-btn").forEach((el) => {
    el.disabled = isDisabled;
  });
}

/***********************
 * Row management
 ***********************/
let rowCounter = 0;

function buildInput(
  labelTxt,
  placeholder,
  fieldKey,
  value = "",
  type = "text",
) {
  const wrap = document.createElement("div");
  wrap.className = "field";

  const input = document.createElement("input");
  input.type = type;
  input.placeholder = placeholder || labelTxt || "";
  input.dataset.field = fieldKey;
  input.value = value || "";
  input.autocomplete = "off";
  input.dir = "rtl";

  wrap.appendChild(input);
  return wrap;
}

function readRow(rowEl) {
  const getVal = (key) =>
    (rowEl.querySelector(`[data-field="${key}"]`)?.value || "").trim();

  return {
    floor: getVal("floor"),
    apartment: getVal("apartment"),
    entrance: getVal("entrance"),
    location: getVal("location"),
    remarks: getVal("remarks"),
  };
}

function rowHasCore(data) {
  return !!(data.floor || data.apartment || data.entrance || data.location);
}

function clearRowInputs(rowEl) {
  rowEl.querySelectorAll("input").forEach((el) => (el.value = ""));
}

function addRow(initial = {}) {
  if (!rowsContainer) return;

  const rows = Array.from(rowsContainer.querySelectorAll(".shelter-row"));
  const last = rows[rows.length - 1];
  if (last) {
    const data = readRow(last);
    if (!rowHasCore(data) && !data.remarks) {
      setAlert(
        "error",
        "מלא לפחות קומה/דירה/כניסה/מיקום לפני הוספת שורה חדשה.",
      );
      return;
    }
  }

  rowCounter += 1;

  const row = document.createElement("div");
  row.className = "shelter-row";
  row.dataset.rowId = String(rowCounter);

  const grid = document.createElement("div");
  grid.className = "row-grid";

  grid.appendChild(
    buildInput(
      "מיקום",
      "לדוגמה: לובי / חניון / חצר",
      "location",
      initial.location || "",
    ),
  );
  grid.appendChild(
    buildInput("כניסה", "לדוגמה: ב", "entrance", initial.entrance || ""),
  );
  grid.appendChild(
    buildInput("דירה", "לדוגמה: 12", "apartment", initial.apartment || ""),
  );
  grid.appendChild(
    buildInput("קומה", "לדוגמה: 3", "floor", initial.floor || ""),
  );
  grid.appendChild(
    buildInput("הערות", "דגשים מיוחדים", "remarks", initial.remarks || ""),
  );

  const deleteCell = document.createElement("div");
  deleteCell.className = "delete-cell";

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "icon-btn remove-btn";
  removeBtn.title = "מחק שורה";
  removeBtn.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 7h14" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
      <path d="M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7" />
    </svg>
  `;

  removeBtn.addEventListener("click", () => {
    if (rowsContainer.children.length <= 1) {
      clearRowInputs(row);
      return;
    }
    row.remove();
    forceResizeBurst();
  });

  deleteCell.appendChild(removeBtn);
  grid.appendChild(deleteCell);
  row.appendChild(grid);
  rowsContainer.appendChild(row);

  forceResizeBurst();
}

function collectRows() {
  if (!rowsContainer) return [];
  const out = [];
  const rows = Array.from(rowsContainer.querySelectorAll(".shelter-row"));
  for (const row of rows) {
    const data = readRow(row);
    if (!rowHasCore(data) && !data.remarks) continue;
    out.push(data);
  }
  return out;
}

function resetForm() {
  if (!rowsContainer) return;
  rowsContainer.innerHTML = "";
  addRow();
}

/***********************
 * Context (Record ID)
 ***********************/
function asIdArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.map((x) => String(x)).filter(Boolean);
  if (typeof val === "string" || typeof val === "number") return [String(val)];
  if (typeof val === "object" && val.id) return [String(val.id)];
  return [];
}

function pickFirstId(ids) {
  const arr = asIdArray(ids);
  return arr.length ? arr[0] : null;
}

function parseRecordIdFromUrl() {
  try {
    const qs = new URLSearchParams(window.location.search || "");
    const candidates = [
      qs.get("EntityId"),
      qs.get("EntityID"),
      qs.get("entityId"),
      qs.get("recordId"),
      qs.get("RecordID"),
      qs.get("id"),
    ].filter(Boolean);

    if (candidates.length) return String(candidates[0]);

    // לפעמים זה מגיע אחרי # (hash)
    const hash = (window.location.hash || "").replace(/^#/, "");
    if (hash.includes("=")) {
      const hs = new URLSearchParams(hash);
      const hc = [
        hs.get("EntityId"),
        hs.get("EntityID"),
        hs.get("entityId"),
        hs.get("recordId"),
        hs.get("RecordID"),
        hs.get("id"),
      ].filter(Boolean);
      if (hc.length) return String(hc[0]);
    }

    return null;
  } catch (_) {
    return null;
  }
}

function applyContext(data) {
  // שומרים raw למקרה דיבוג/פולבאק
  pageLoadData = data || pageLoadData;

  const entity = data?.Entity || data?.entity || null;
  const ids =
    asIdArray(data?.EntityId) ||
    asIdArray(data?.EntityID) ||
    asIdArray(data?.entityId);

  const picked = pickFirstId(ids);

  resolvedEntity = entity || resolvedEntity;
  currentProjectId = picked || currentProjectId;

  // fallback אם אין כלום מהאירוע
  if (!currentProjectId) {
    currentProjectId = parseRecordIdFromUrl();
  }

  return { entity: resolvedEntity, recordId: currentProjectId };
}

/***********************
 * META: לוודא API name של Shelters
 ***********************/
async function resolveSheltersModuleApiName() {
  try {
    const res = await ZOHO.CRM.META.getModules();
    const modules = res?.modules || res?.data || [];
    const match = modules.find((m) => {
      const api = String(m?.api_name || m?.apiName || "").trim();
      return api.toLowerCase() === MODULE_SHELTERS.toLowerCase();
    });

    if (match?.api_name) {
      sheltersModuleApiName = match.api_name;
      return;
    }

    // אם לא מצאנו לפי api_name (כי אצלך אולי כתבת lowercase),
    // נחפש גם לפי singular/plural label
    const match2 = modules.find((m) => {
      const options = [
        m?.api_name,
        m?.module_name,
        m?.singular_label,
        m?.plural_label,
      ]
        .map((x) =>
          String(x || "")
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean);

      return options.includes(MODULE_SHELTERS.toLowerCase());
    });

    if (match2?.api_name) sheltersModuleApiName = match2.api_name;
  } catch (_) {
    sheltersModuleApiName = MODULE_SHELTERS;
  }
}

/***********************
 * Resize
 ***********************/
function resizeNow() {
  const zoho = window.ZOHO;
  if (!zoho?.CRM?.UI?.Resize) return;

  // חובה height > 0 לפי הדוקו :contentReference[oaicite:1]{index=1}
  const contentHeight = Math.max(
    700,
    document.documentElement.scrollHeight + 40,
  );

  if (resizeRaf) cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = null;

    // width:0 מומלץ כדי לא להילחם בקונטיינר; גובה כן נמתח
    zoho.CRM.UI.Resize({ width: 0, height: contentHeight });
  });
}

function forceResizeBurst() {
  resizeNow();
  setTimeout(resizeNow, 120);
  setTimeout(resizeNow, 400);
  setTimeout(resizeNow, 900);
  setTimeout(resizeNow, 1500);
}

function startResizeObserver() {
  if ("ResizeObserver" in window) {
    const ro = new ResizeObserver(() => resizeNow());
    ro.observe(document.body);
  } else {
    window.addEventListener("resize", resizeNow);
  }
}

/***********************
 * Build payload + insert
 ***********************/
function buildName(row, idx) {
  const tokens = [row.location, row.entrance, row.apartment, row.floor]
    .map((t) => String(t || "").trim())
    .filter(Boolean);

  return tokens.length ? tokens.join(" | ") : `Shelter ${idx + 1}`;
}

function buildPayload(row, idx) {
  const payload = {
    [FIELD_NAME]: buildName(row, idx),
    [FIELD_LOCATION]: row.location || "",
    [FIELD_ENTRANCE]: row.entrance || "",
    [FIELD_APARTMENT]: row.apartment || "",
    [FIELD_FLOOR]: row.floor || "",
    [FIELD_PROJECT]: { id: currentProjectId },
  };

  if (row.remarks) payload[FIELD_REMARKS] = row.remarks;
  return payload;
}

async function insertShelter(payload) {
  const res = await ZOHO.CRM.API.insertRecord({
    Entity: sheltersModuleApiName,
    APIData: payload,
    Trigger: [],
  });

  const first = res?.data?.[0];
  if (first?.code === "SUCCESS") {
    return { id: first?.details?.id };
  }

  throw new Error(first?.message || "שגיאה בשמירה");
}

/***********************
 * Actions
 ***********************/
async function handleSave() {
  if (!currentProjectId) {
    setAlert(
      "error",
      "לא אותר מזהה פרויקט. ודא שהווידג'ט נפתח מתוך כרטיס Project (Detail View).",
    );
    return;
  }

  const rows = collectRows();
  if (!rows.length) {
    setAlert(
      "error",
      "מלא לפחות שדה אחד (קומה / דירה / כניסה / מיקום) לפני שמירה.",
    );
    return;
  }

  const invalid = rows.some((r) => !rowHasCore(r));
  if (invalid) {
    setAlert(
      "error",
      "כל שורה חייבת להכיל לפחות אחד: קומה / דירה / כניסה / מיקום.",
    );
    return;
  }

  disableUi(true);
  setAlert("", "");
  setState("שומר Shelters...");

  const successes = [];
  const failures = [];

  for (let i = 0; i < rows.length; i += 1) {
    try {
      const payload = buildPayload(rows[i], i);
      const r = await insertShelter(payload);
      successes.push(r.id || i);
    } catch (err) {
      failures.push({ index: i, error: err });
    }
  }

  if (successes.length) {
    setAlert("success", `נוצרו ${successes.length} Shelters בהצלחה.`);
    resetForm();
  }

  if (failures.length) {
    const first = failures[0];
    setAlert(
      "error",
      `חלק מהשורות לא נשמרו (${failures.length}/${rows.length}). ${first.error?.message || first.error}`,
    );
  }

  setState("");
  disableUi(false);
  forceResizeBurst();
}

/***********************
 * Init
 ***********************/
function initUi() {
  addRow();
  addRowBtn?.addEventListener("click", () => addRow());
  saveBtn?.addEventListener("click", handleSave);
}

function hookZohoEvents() {
  if (!window.ZOHO?.embeddedApp?.on) return;

  // PageLoad מומלץ כדי לקבל Entity + EntityId :contentReference[oaicite:2]{index=2}
  ZOHO.embeddedApp.on("PageLoad", async function (data) {
    setState("טוען הקשר (Project)...");
    setAlert("", "");

    applyContext(data);

    if (!currentProjectId) {
      setState("");
      setAlert(
        "error",
        "לא הצלחתי להביא Project ID מה־PageLoad. מנסה לקחת מה־URL, ואם גם זה ריק – בדוק שהכפתור באמת מוגדר על Projects > Detail View.",
      );
      forceResizeBurst();
      return;
    }

    await resolveSheltersModuleApiName();

    setState("");
    setAlert(
      "info",
      `מקושר לפרויקט הנוכחי (ID: ${currentProjectId}). הוסף שורות ושמור.`,
    );
    forceResizeBurst();
  });
}

async function boot() {
  initUi();
  startResizeObserver();
  hookZohoEvents();

  if (!window.ZOHO?.embeddedApp?.init) {
    setAlert("error", "ספריית Zoho לא זמינה. ודא שהווידג'ט רץ מתוך Zoho CRM.");
    return;
  }

  // init מחזיר Promise; אחרי init ננסה fallback מיידי גם בלי PageLoad
  await ZOHO.embeddedApp.init();

  // fallback (במקרים ש-PageLoad לא נורה בכפתור)
  applyContext(pageLoadData);
  if (!currentProjectId) currentProjectId = parseRecordIdFromUrl();

  if (currentProjectId) {
    await resolveSheltersModuleApiName();
    setAlert("info", `מקושר לפרויקט הנוכחי (ID: ${currentProjectId}).`);
  } else {
    setAlert(
      "error",
      "אין Project ID. אם זה נפתח מכפתור – בדוק בהגדרת הכפתור שהוא על Projects > Record Details ומפעיל Widget.",
    );
  }

  forceResizeBurst();
  window.addEventListener("load", forceResizeBurst);
}

boot();
