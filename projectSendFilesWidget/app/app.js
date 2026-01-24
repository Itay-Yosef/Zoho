/* global ZOHO, zrc */

/***********************
 * CONFIG (update only if your API names differ)
 ***********************/
const CFG = {
  // MUST be the exact "Link Name" of your WorkDrive connection in Zoho CRM
  // (Use the one that works for your attachments: in your v2 it was "zohoworkdrive")
  WORKDRIVE_CONNECTION: "zohoworkdrive",

  // Project fields (API Names)
  PROJECT_EMAIL_FIELD: "projectEmail",
  PROJECT_FOLDERID_FIELD: "projectFolderId",
  PROJECT_FOLDERURL_FIELD: "projectFolderUrl",

  DEFAULT_ENTITY: "Projects", // usually "Projects" in CRM; if yours is "projects", change it
};

// WorkDrive API base (JSON)
const WD_API_BASE = "https://www.zohoapis.com/workdrive/api/v1";
// Fallback download origin (binary)
const WD_DEFAULT_DOWNLOAD_ORIGIN = "https://download.zoho.com";

// Zoho send_mail total attachments limit (practically 10MB)
const SENDMAIL_ATTACH_TOTAL_LIMIT = 10 * 1024 * 1024;

/***********************
 * State
 ***********************/
const state = {
  entity: null,
  recordId: null,

  projectEmail: "",
  projectName: "",
  projectFolderId: null,
  projectFolderUrl: "",

  currentUser: null,
  fromAddresses: null, // cache allowed senders

  // attachments: uploaded into CRM Files (/crm/v8/files)
  // send_mail wants: [{id:<zfsId>}]
  attachments: [], // { workdriveId, name, size, zfsId }

  picker: {
    stack: [],
    currentFolderId: null,
    selected: new Map(), // fileId -> {id,name,size}
  },
};

/***********************
 * DOM
 ***********************/
const dom = {
  toInput: document.getElementById("toInput"),
  ccInput: document.getElementById("ccInput"),
  bccInput: document.getElementById("bccInput"),
  subjectInput: document.getElementById("subjectInput"),
  bodyInput: document.getElementById("bodyInput"),
  attachBtn: document.getElementById("attachBtn"),
  sendBtn: document.getElementById("sendBtn"),
  alert: document.getElementById("alert"),
  stateBar: document.getElementById("state"),
  attachmentsList: document.getElementById("attachmentsList"),
  folderInfo: document.getElementById("folderInfo"),
  fromChip: document.getElementById("fromChip"),

  pickerBackdrop: document.getElementById("pickerBackdrop"),
  pickerCrumbs: document.getElementById("pickerCrumbs"),
  pickerFolderLabel: document.getElementById("pickerFolderLabel"),
  pickerTableBody: document.getElementById("pickerTableBody"),
  pickerCancel: document.getElementById("pickerCancel"),
  pickerAttach: document.getElementById("pickerAttach"),
};

/***********************
 * Helpers
 ***********************/
function safeParse(resp) {
  if (!resp) return null;
  const d = resp.data ?? resp;
  if (typeof d === "string") {
    try {
      return JSON.parse(d);
    } catch (_) {
      return null;
    }
  }
  return d ?? null;
}

function setAlert(type, msg) {
  if (!dom.alert) return;
  if (!msg) {
    dom.alert.style.display = "none";
    dom.alert.textContent = "";
    dom.alert.className = "status-bar";
    return;
  }
  dom.alert.className = `status-bar ${type || "info"}`;
  dom.alert.textContent = msg;
  dom.alert.style.display = "block";
}

function setState(msg, type = "info") {
  if (!dom.stateBar) return;
  if (!msg) {
    dom.stateBar.style.display = "none";
    dom.stateBar.textContent = "";
    dom.stateBar.className = "status-bar";
    return;
  }
  dom.stateBar.className = `status-bar ${type}`;
  dom.stateBar.textContent = msg;
  dom.stateBar.style.display = "block";
}

function disableUi(flag) {
  dom.sendBtn && (dom.sendBtn.disabled = flag);
  dom.attachBtn && (dom.attachBtn.disabled = flag);
  dom.pickerAttach && (dom.pickerAttach.disabled = flag);
}

function parseEmails(str) {
  if (!str) return [];
  return String(str)
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((email) => ({ email }));
}

function defaultSubject() {
  return state.projectName
    ? `Update on ${state.projectName}`
    : "Project update";
}

function defaultBodyHtml() {
  const proj = state.projectName || "your project";
  const user =
    state.currentUser?.full_name ||
    state.currentUser?.user_name ||
    state.currentUser?.display_name ||
    "our team";
  return `
    <p>Hi,</p>
    <p>Please find the latest files for <b>${proj}</b> attached from WorkDrive.</p>
    <p>Let me know if you need anything else.</p>
    <p>Thanks,<br/>${user}</p>
  `;
}

function setFromChip(text) {
  if (!dom.fromChip) return;
  dom.fromChip.textContent = text || "From: —";
}

function formatBytes(n) {
  if (!n || n < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function currentAttachTotalBytes() {
  return state.attachments.reduce((sum, a) => sum + (Number(a.size) || 0), 0);
}

function renderAttachments() {
  if (!dom.attachmentsList) return;
  dom.attachmentsList.innerHTML = "";

  state.attachments.forEach((att) => {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = att.name || "file";

    const remove = document.createElement("button");
    remove.className = "remove";
    remove.type = "button";
    remove.textContent = "×";
    remove.title = "Remove";
    remove.onclick = () => {
      state.attachments = state.attachments.filter(
        (a) => a.zfsId !== att.zfsId,
      );
      renderAttachments();
      forceResize();
    };

    pill.appendChild(remove);
    dom.attachmentsList.appendChild(pill);
  });

  forceResize();
}

/***********************
 * Resize
 ***********************/
function forceResize() {
  if (!window.ZOHO?.CRM?.UI?.Resize) return;
  const h = Math.max(document.documentElement.scrollHeight + 24, 720);
  window.ZOHO.CRM.UI.Resize({ width: "100%", height: h });
}

function startResizeObserver() {
  if ("ResizeObserver" in window) {
    const ro = new ResizeObserver(() => forceResize());
    ro.observe(document.body);
  } else {
    window.addEventListener("resize", forceResize);
  }
}

/***********************
 * WorkDrive clients (v2 reliable download flow)
 ***********************/
let wdApi = null;
const wdDownloadClients = new Map(); // origin -> zrc instance

async function ensureWorkDriveApi() {
  if (wdApi) return;
  wdApi = zrc.createInstance({
    baseUrl: WD_API_BASE,
    connection: CFG.WORKDRIVE_CONNECTION,
  });
}

function ensureWorkDriveDownloadClient(origin) {
  if (wdDownloadClients.has(origin)) return wdDownloadClients.get(origin);

  const client = zrc.createInstance({
    baseUrl: origin,
    connection: CFG.WORKDRIVE_CONNECTION,
  });
  wdDownloadClients.set(origin, client);
  return client;
}

async function listFolderItems(folderId) {
  await ensureWorkDriveApi();
  const resp = await wdApi.get(`/files/${folderId}/files`, {
    headers: { Accept: "application/vnd.api+json" },
  });
  const data = safeParse(resp);
  return Array.isArray(data?.data) ? data.data : [];
}

async function getFileInfo(fileId) {
  await ensureWorkDriveApi();
  const resp = await wdApi.get(`/files/${fileId}`, {
    headers: { Accept: "application/vnd.api+json" },
  });
  const data = safeParse(resp);
  return data?.data || null;
}

function pickDownloadUrl(fileInfo, fileId) {
  const attrs = fileInfo?.attributes || {};
  const direct =
    attrs.download_url ||
    attrs.downloadUrl ||
    attrs.download_link ||
    attrs.downloadLink ||
    null;

  if (direct && typeof direct === "string") return direct;

  // fallback: standard WorkDrive download endpoint
  return `${WD_DEFAULT_DOWNLOAD_ORIGIN}/v1/workdrive/download/${fileId}`;
}

function normalizeToBlob(anyData, fallbackType = "application/octet-stream") {
  if (!anyData) return null;
  if (anyData instanceof Blob) return anyData;
  if (anyData instanceof ArrayBuffer)
    return new Blob([anyData], { type: fallbackType });
  if (anyData?.data instanceof Blob) return anyData.data;
  if (anyData?.data instanceof ArrayBuffer)
    return new Blob([anyData.data], { type: fallbackType });
  return null;
}

async function downloadWorkDriveFile(fileInfo) {
  const fileId = fileInfo?.id;
  const name = fileInfo?.attributes?.name || "file";
  const mime = fileInfo?.attributes?.mime_type || "application/octet-stream";

  const dlUrl = pickDownloadUrl(fileInfo, fileId);
  const u = new URL(dlUrl);
  const dlClient = ensureWorkDriveDownloadClient(u.origin);
  const path = `${u.pathname}${u.search || ""}`;

  // try blob, fallback arraybuffer
  try {
    const resp = await dlClient.get(path, { responseType: "blob" });
    const blob = normalizeToBlob(resp?.data ?? resp, mime);
    if (!blob) throw new Error("Empty download (blob)");
    return { blob, name };
  } catch (_) {
    const resp2 = await dlClient.get(path, { responseType: "arraybuffer" });
    const blob2 = normalizeToBlob(resp2?.data ?? resp2, mime);
    if (!blob2) throw new Error("Empty download (arraybuffer)");
    return { blob: blob2, name };
  }
}

/***********************
 * Upload to CRM Files API (ZFS) - POST /crm/v8/files
 ***********************/
function toFile(blob, fileName) {
  try {
    if (blob instanceof File) return blob;
    return new File([blob], fileName, {
      type: blob.type || "application/octet-stream",
      lastModified: Date.now(),
    });
  } catch (_) {
    return blob; // fallback
  }
}

async function uploadToZFS(blob, fileName) {
  const fd = new FormData();
  fd.append("file", toFile(blob, fileName), fileName);

  const resp = await zrc.post("/crm/v8/files", fd);
  const data = safeParse(resp);
  const first = data?.data?.[0];

  if (first?.code === "SUCCESS" && first?.details?.id) return first.details.id;

  throw new Error(
    first?.message || data?.message || "Upload to CRM files failed",
  );
}

/***********************
 * Allowed FROM addresses (v1 working send_mail logic)
 ***********************/
async function fetchAllowedFromAddresses() {
  if (Array.isArray(state.fromAddresses) && state.fromAddresses.length)
    return state.fromAddresses;

  const resp = await zrc.get("/crm/v8/settings/emails/actions/from_addresses");
  const data = safeParse(resp);
  const arr = data?.from_addresses;

  state.fromAddresses = Array.isArray(arr) ? arr : [];
  return state.fromAddresses;
}

function pickBestFromAddress(list) {
  if (!Array.isArray(list) || !list.length) return null;

  const currentEmail = String(
    state.currentUser?.email ||
      state.currentUser?.email_id ||
      state.currentUser?.mail ||
      state.currentUser?.mailid ||
      "",
  )
    .trim()
    .toLowerCase();

  if (currentEmail) {
    const exact = list.find(
      (x) =>
        String(x?.email || "")
          .trim()
          .toLowerCase() === currentEmail,
    );
    if (exact) return exact;
  }

  return (
    list.find((x) => x?.type === "primary") ||
    list.find((x) => x?.type === "org_email") ||
    list[0]
  );
}

/***********************
 * Picker UI
 ***********************/
function clearPickerSelection() {
  state.picker.selected.clear();
}

function renderBreadcrumbs() {
  if (!dom.pickerCrumbs) return;
  dom.pickerCrumbs.innerHTML = "";
  state.picker.stack.forEach((crumb, idx) => {
    const span = document.createElement("span");
    span.className = `crumb${idx === state.picker.stack.length - 1 ? " current" : ""}`;
    span.textContent = crumb.name || "Folder";
    span.title = crumb.name || "";
    if (idx !== state.picker.stack.length - 1) {
      span.onclick = async () => {
        state.picker.stack = state.picker.stack.slice(0, idx + 1);
        const id = state.picker.stack[state.picker.stack.length - 1].id;
        await loadPickerFolder(id, false);
      };
    }
    dom.pickerCrumbs.appendChild(span);
  });
}

function toggleSelection(item, shouldSelect) {
  const attrs = item.attributes || {};
  if (shouldSelect) {
    state.picker.selected.set(item.id, {
      id: item.id,
      name: attrs.name || "file",
      size: attrs.size_in_bytes || attrs.file_size || 0,
    });
  } else {
    state.picker.selected.delete(item.id);
  }
}

function showPickerLoader() {
  if (!dom.pickerTableBody) return;
  dom.pickerTableBody.innerHTML = "";
  for (let i = 0; i < 6; i += 1) {
    const tr = document.createElement("tr");
    ["46px", "auto", "140px", "180px"].forEach((w) => {
      const td = document.createElement("td");
      td.innerHTML = `<div class="skeleton" style="height:12px; width:${w};"></div>`;
      tr.appendChild(td);
    });
    dom.pickerTableBody.appendChild(tr);
  }
}

function renderPickerRows(items) {
  if (!dom.pickerTableBody) return;
  dom.pickerTableBody.innerHTML = "";

  if (!items || items.length === 0) {
    dom.pickerTableBody.innerHTML =
      '<tr><td colspan="4" style="padding:16px;color:#6b7280;font-weight:800;">No files in this folder.</td></tr>';
    return;
  }

  const sorted = [...items].sort((a, b) => {
    const af = a?.attributes?.is_folder === true;
    const bf = b?.attributes?.is_folder === true;
    if (af !== bf) return af ? -1 : 1;
    return (a?.attributes?.name || "").localeCompare(
      b?.attributes?.name || "",
      "en",
    );
  });

  sorted.forEach((item) => {
    const attrs = item.attributes || {};
    const isFolder = attrs.is_folder === true;
    const name = attrs.name || "";
    const ext = isFolder
      ? "Folder"
      : attrs.extn || name.split(".").pop() || "FILE";

    const tr = document.createElement("tr");
    tr.className = "file-row";

    const tdCheck = document.createElement("td");
    if (!isFolder) {
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = state.picker.selected.has(item.id);
      cb.onchange = (e) => {
        e.stopPropagation();
        toggleSelection(item, cb.checked);
      };
      tdCheck.appendChild(cb);
    }
    tr.appendChild(tdCheck);

    const tdName = document.createElement("td");
    tdName.textContent = name;
    tr.appendChild(tdName);

    const tdType = document.createElement("td");
    tdType.textContent = ext || (isFolder ? "Folder" : "File");
    tr.appendChild(tdType);

    const tdDate = document.createElement("td");
    tdDate.textContent = attrs.modified_time || "";
    tr.appendChild(tdDate);

    tr.onclick = async () => {
      if (isFolder) {
        state.picker.stack.push({ id: item.id, name });
        await loadPickerFolder(item.id, false);
      } else {
        const next = !state.picker.selected.has(item.id);
        toggleSelection(item, next);
        renderPickerRows(items);
      }
    };

    dom.pickerTableBody.appendChild(tr);
  });
}

async function loadPickerFolder(folderId, resetStack) {
  if (!folderId) return;
  showPickerLoader();
  state.picker.currentFolderId = folderId;

  try {
    const items = await listFolderItems(folderId);
    if (resetStack) {
      state.picker.stack = [{ id: folderId, name: "Project folder" }];
    }
    renderBreadcrumbs();
    renderPickerRows(items);
    dom.pickerFolderLabel &&
      (dom.pickerFolderLabel.textContent = `Folder ID: ${folderId}`);
  } catch (e) {
    console.error("loadPickerFolder", e);
    dom.pickerTableBody.innerHTML =
      '<tr><td colspan="4" style="padding:16px;color:#b91c1c;font-weight:800;">Unable to load WorkDrive items (check connection/scopes).</td></tr>';
  }
}

function openPicker() {
  if (!state.projectFolderId) {
    setAlert("error", "No WorkDrive folder found on this project.");
    return;
  }
  clearPickerSelection();
  dom.pickerBackdrop.style.display = "flex";
  state.picker.stack = [{ id: state.projectFolderId, name: "Project folder" }];
  loadPickerFolder(state.projectFolderId, true);
}

function closePicker() {
  dom.pickerBackdrop.style.display = "none";
}

/***********************
 * Attach flow
 ***********************/
async function attachSelectedFiles() {
  const selected = Array.from(state.picker.selected.values());
  if (!selected.length) {
    setAlert("info", "Select at least one file to attach.");
    return;
  }

  disableUi(true);
  setAlert("", "");
  setState(`Attaching ${selected.length} file(s)...`);

  try {
    for (const file of selected) {
      try {
        const info = await getFileInfo(file.id);

        const name = info?.attributes?.name || file.name || "file";
        const size = Number(info?.attributes?.size_in_bytes || file.size || 0);

        const nextTotal = currentAttachTotalBytes() + (size || 0);
        if (size && nextTotal > SENDMAIL_ATTACH_TOTAL_LIMIT) {
          throw new Error(
            `Total attachments would exceed 10MB (current: ${formatBytes(
              currentAttachTotalBytes(),
            )}, adding: ${formatBytes(size)}).`,
          );
        }

        const dl = await downloadWorkDriveFile(info);
        const zfsId = await uploadToZFS(dl.blob, dl.name || name);

        const already = state.attachments.some(
          (a) => a.workdriveId === file.id || a.zfsId === zfsId,
        );
        if (!already)
          state.attachments.push({
            workdriveId: file.id,
            name: dl.name || name,
            size,
            zfsId,
          });
      } catch (errOne) {
        console.error("attach one file error", errOne);
        setAlert(
          "error",
          `Could not attach ${file.name || "file"}: ${errOne?.message || errOne}`,
        );
      }
    }

    renderAttachments();
    closePicker();
    setState("");
  } finally {
    disableUi(false);
    forceResize();
  }
}

/***********************
 * Send mail (v1 working)
 ***********************/
async function sendMail() {
  const to = parseEmails(dom.toInput?.value);
  const cc = parseEmails(dom.ccInput?.value);
  const bcc = parseEmails(dom.bccInput?.value);
  const subject = (dom.subjectInput?.value || "").trim();
  const contentHtml = dom.bodyInput?.innerHTML || "";

  if (!to.length) {
    setAlert("error", "Recipient (To) is required.");
    return;
  }
  if (!subject) {
    setAlert("error", "Subject is required.");
    return;
  }

  disableUi(true);
  setAlert("", "");
  setState("Preparing sender...");

  try {
    const allowed = await fetchAllowedFromAddresses();
    const chosen = pickBestFromAddress(allowed);

    if (!chosen?.email) {
      throw new Error(
        `No allowed "From" address found. Make sure email sending is configured for your CRM user/org.`,
      );
    }

    setFromChip(`From: ${chosen.user_name || "Sender"} (${chosen.email})`);

    const payload = {
      data: [
        {
          from: {
            email: chosen.email,
            user_name:
              chosen.user_name ||
              state.currentUser?.full_name ||
              state.currentUser?.user_name ||
              state.currentUser?.display_name ||
              "Sender",
          },
          to,
          cc,
          bcc,
          subject,
          content: contentHtml,
          mail_format: "html",
          ...(state.attachments.length
            ? {
                attachments: state.attachments
                  .filter((a) => a.zfsId)
                  .map((a) => ({ id: a.zfsId })),
              }
            : {}),
        },
      ],
    };

    setState("Sending email...");

    const url = `/crm/v8/${state.entity}/${state.recordId}/actions/send_mail`;
    const resp = await zrc.post(url, payload, {
      headers: { "Content-Type": "application/json" },
    });

    const data = safeParse(resp);
    const first = data?.data?.[0];

    if (first?.code === "SUCCESS") {
      setAlert("success", "Email sent successfully.");
      setState("");
      return;
    }

    throw new Error(first?.message || data?.message || "Send failed");
  } catch (err) {
    console.error("sendMail", err);
    setAlert("error", err?.message || "Failed to send email.");
    setState("");
  } finally {
    disableUi(false);
    forceResize();
  }
}

/***********************
 * Fetch project + user
 ***********************/
function extractFolderIdFromUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/");
    return parts[parts.length - 1] || "";
  } catch (_) {
    return "";
  }
}

async function fetchCurrentUser() {
  try {
    const cfg = await ZOHO.CRM.CONFIG.getCurrentUser();
    state.currentUser = cfg?.users?.[0] || cfg?.data?.[0] || cfg?.user || null;

    const guessEmail =
      state.currentUser?.email ||
      state.currentUser?.email_id ||
      state.currentUser?.mail ||
      state.currentUser?.mailid ||
      "";
    setFromChip(guessEmail ? `From: ${guessEmail}` : "From: —");
  } catch (e) {
    console.warn("Current user fetch failed", e);
  }
}

async function fetchProjectDetails() {
  if (!state.entity || !state.recordId) return;

  const resp = await ZOHO.CRM.API.getRecord({
    Entity: state.entity,
    RecordID: state.recordId,
    approved: "both",
  });

  const row = resp?.data?.[0] || {};

  state.projectEmail =
    row[CFG.PROJECT_EMAIL_FIELD] || row.projectEmail || row.ProjectEmail || "";
  state.projectName = row.Project_Name || row.Name || row.projectName || "";

  const directId =
    row[CFG.PROJECT_FOLDERID_FIELD] ||
    row.projectFolderId ||
    row.ProjectFolderId;
  const urlField =
    row[CFG.PROJECT_FOLDERURL_FIELD] ||
    row.projectFolderUrl ||
    row.ProjectFolderUrl;

  state.projectFolderId = directId || extractFolderIdFromUrl(urlField);
  state.projectFolderUrl = urlField || "";

  if (dom.folderInfo) {
    dom.folderInfo.textContent = state.projectFolderId
      ? `WorkDrive folder: ${state.projectFolderId}`
      : "WorkDrive folder: —";
  }

  if (dom.toInput && state.projectEmail) dom.toInput.value = state.projectEmail;
  if (dom.subjectInput && !dom.subjectInput.value)
    dom.subjectInput.value = defaultSubject();
  if (dom.bodyInput && !dom.bodyInput.innerHTML.trim())
    dom.bodyInput.innerHTML = defaultBodyHtml();
}

/***********************
 * Context parsing (helps in Canvas/detail view)
 ***********************/
function parseRecordIdFromUrl() {
  try {
    const qs = new URLSearchParams(window.location.search || "");
    const ids = [
      qs.get("EntityId"),
      qs.get("entityId"),
      qs.get("recordId"),
      qs.get("id"),
    ].filter(Boolean);
    if (ids.length) return String(ids[0]);

    const hash = (window.location.hash || "").replace(/^#/, "");
    if (hash.includes("=")) {
      const hs = new URLSearchParams(hash);
      const hid = [
        hs.get("EntityId"),
        hs.get("entityId"),
        hs.get("recordId"),
        hs.get("id"),
      ].filter(Boolean);
      if (hid.length) return String(hid[0]);
    }
    return null;
  } catch (_) {
    return null;
  }
}

function applyContext(data) {
  state.entity =
    data?.Entity || data?.entity || state.entity || CFG.DEFAULT_ENTITY;
  state.recordId =
    data?.EntityId ||
    data?.EntityID ||
    data?.entityId ||
    data?.recordId ||
    state.recordId ||
    null;

  if (!state.recordId) state.recordId = parseRecordIdFromUrl();
}

/***********************
 * Boot
 ***********************/
function wireEvents() {
  dom.attachBtn?.addEventListener("click", openPicker);
  dom.pickerCancel?.addEventListener("click", closePicker);
  dom.pickerAttach?.addEventListener("click", attachSelectedFiles);
  dom.sendBtn?.addEventListener("click", sendMail);

  // editor toolbar
  document.querySelectorAll(".tool-btn[data-cmd]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cmd = btn.getAttribute("data-cmd");
      if (!cmd) return;
      document.execCommand(cmd, false, null);
      dom.bodyInput?.focus();
    });
  });
}

async function boot() {
  wireEvents();
  startResizeObserver();

  ZOHO.embeddedApp.on("PageLoad", async function (data) {
    setState("Loading project details...");
    setAlert("", "");

    // reset per load
    wdApi = null;
    wdDownloadClients.clear();
    state.fromAddresses = null;
    state.attachments = [];
    renderAttachments();

    applyContext(data);

    await fetchCurrentUser();
    await fetchProjectDetails();

    if (dom.subjectInput && !dom.subjectInput.value)
      dom.subjectInput.value = defaultSubject();
    if (dom.bodyInput && !dom.bodyInput.innerHTML.trim())
      dom.bodyInput.innerHTML = defaultBodyHtml();

    setState("");
    forceResize();
  });

  await ZOHO.embeddedApp.init();

  // fallback in case PageLoad didn’t fire immediately
  try {
    applyContext({});
    await fetchCurrentUser();
    await fetchProjectDetails();
    forceResize();
  } catch (_) {}
}

boot();
