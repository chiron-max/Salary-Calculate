/* 月度工作时长统计
 * 核心能力：
 * - 月视图
 * - 多日期选择
 * - 时间 package（segment）增删改
 * - 跨天/夜班/碎片化工时
 * - 月统计
 * - JSON/CSV 导出
 * - localStorage 持久化
 */

const STORAGE_KEY = "monthly-work-hours-v1";

const DEFAULT_PROFILES = [
  {
    id: "day-shift",
    name: "白班 09:00-17:00",
    expectedMinutes: 480,
    nightStart: 1320, // 22:00
    nightEnd: 360,    // 06:00
    presetStart: "09:00",
    presetEnd: "17:00",
    defaultType: "normal"
  },
  {
    id: "night-shift",
    name: "夜班 20:00-08:00",
    expectedMinutes: 720,
    nightStart: 1320,
    nightEnd: 360,
    presetStart: "20:00",
    presetEnd: "08:00",
    defaultType: "night"
  },
  {
    id: "half-day",
    name: "半天班 09:00-13:00",
    expectedMinutes: 240,
    nightStart: 1320,
    nightEnd: 360,
    presetStart: "09:00",
    presetEnd: "13:00",
    defaultType: "normal"
  },
  {
    id: "overtime",
    name: "加班 18:00-22:00",
    expectedMinutes: 240,
    nightStart: 1320,
    nightEnd: 360,
    presetStart: "18:00",
    presetEnd: "22:00",
    defaultType: "overtime"
  },
  {
    id: "custom",
    name: "自定义",
    expectedMinutes: 0,
    nightStart: 1320,
    nightEnd: 360,
    presetStart: "09:00",
    presetEnd: "18:00",
    defaultType: "custom"
  }
];

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

const state = {
  currentMonth: formatMonthKey(new Date()),
  selectedDate: toDateKey(new Date()),
  selectedDates: new Set(),
  multiSelectMode: false,
  editing: null, // { dateKey, segmentId }
  data: null
};

const els = {
  monthLabel: document.getElementById("monthLabel"),
  prevMonthBtn: document.getElementById("prevMonthBtn"),
  nextMonthBtn: document.getElementById("nextMonthBtn"),
  todayBtn: document.getElementById("todayBtn"),
  multiSelectBtn: document.getElementById("multiSelectBtn"),
  exportJsonBtn: document.getElementById("exportJsonBtn"),
  exportCsvBtn: document.getElementById("exportCsvBtn"),
  weekdayRow: document.getElementById("weekdayRow"),
  calendarGrid: document.getElementById("calendarGrid"),
  summaryGrid: document.getElementById("summaryGrid"),
  inspectorTitle: document.getElementById("inspectorTitle"),
  inspectorMeta: document.getElementById("inspectorMeta"),
  selectionBadge: document.getElementById("selectionBadge"),
  selectedDatesChips: document.getElementById("selectedDatesChips"),
  daySegments: document.getElementById("daySegments"),
  segmentForm: document.getElementById("segmentForm"),
  profileSelect: document.getElementById("profileSelect"),
  submitBtn: document.getElementById("submitBtn"),
  cancelEditBtn: document.getElementById("cancelEditBtn"),
  formHint: document.getElementById("formHint"),
  toast: document.getElementById("toast")
};

init();

function init() {
  state.data = loadData();
  ensureMonth(state.currentMonth);

  renderWeekdays();
  renderProfileOptions();
  bindEvents();
  syncFormDefaults();
  render();
}

function bindEvents() {
  els.prevMonthBtn.addEventListener("click", () => {
    state.currentMonth = shiftMonth(state.currentMonth, -1);
    onMonthChanged();
  });

  els.nextMonthBtn.addEventListener("click", () => {
    state.currentMonth = shiftMonth(state.currentMonth, 1);
    onMonthChanged();
  });

  els.todayBtn.addEventListener("click", () => {
    state.currentMonth = formatMonthKey(new Date());
    state.selectedDate = toDateKey(new Date());
    state.selectedDates.clear();
    state.multiSelectMode = false;
    onMonthChanged(true);
    showToast("已切换到今天");
  });

  els.multiSelectBtn.addEventListener("click", () => {
    state.multiSelectMode = !state.multiSelectMode;
    if (!state.multiSelectMode) state.selectedDates.clear();
    updateMultiSelectButton();
    render();
    showToast(state.multiSelectMode ? "已开启多选日期" : "已关闭多选日期");
  });

  els.exportJsonBtn.addEventListener("click", exportJSON);
  els.exportCsvBtn.addEventListener("click", exportCSV);

  els.profileSelect.addEventListener("change", () => {
    const profile = getProfileById(els.profileSelect.value);
    if (!profile) return;
    if (!state.editing) {
      const start = els.segmentForm.elements.start;
      const end = els.segmentForm.elements.end;
      start.value = profile.presetStart;
      end.value = profile.presetEnd;
      els.segmentForm.elements.segmentType.value = profile.defaultType;
    }
  });

  els.cancelEditBtn.addEventListener("click", () => {
    state.editing = null;
    syncFormDefaults();
    renderInspector();
    showToast("已取消编辑");
  });

  els.segmentForm.addEventListener("submit", handleFormSubmit);

  els.calendarGrid.addEventListener("click", (e) => {
    const cell = e.target.closest("[data-date]");
    if (!cell) return;
    const dateKey = cell.dataset.date;

    if (state.multiSelectMode) {
      if (state.selectedDates.has(dateKey)) state.selectedDates.delete(dateKey);
      else state.selectedDates.add(dateKey);
      state.selectedDate = dateKey;
      render();
      return;
    }

    state.selectedDate = dateKey;
    state.selectedDates.clear();
    render();
  });

  els.daySegments.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;

    const { action, date, segmentId } = btn.dataset;

    if (action === "edit") {
      startEdit(date, segmentId);
    }

    if (action === "delete") {
      if (confirm("确认删除这个时间 package？")) {
        deleteSegment(date, segmentId);
        showToast("已删除");
      }
    }
  });
}

function onMonthChanged(resetSelection = false) {
  ensureMonth(state.currentMonth);
  if (resetSelection) {
    const days = getDaysInMonth(state.currentMonth);
    state.selectedDate = days[0] || state.selectedDate;
    state.selectedDates.clear();
    state.multiSelectMode = false;
  } else {
    const days = getDaysInMonth(state.currentMonth);
    if (!days.includes(state.selectedDate)) state.selectedDate = days[0] || state.selectedDate;
    if (state.selectedDates.size) {
      state.selectedDates = new Set([...state.selectedDates].filter(d => d.startsWith(state.currentMonth)));
    }
  }
  updateMultiSelectButton();
  syncFormDefaults();
  render();
}

function render() {
  els.monthLabel.textContent = formatMonthLabel(state.currentMonth);
  updateMultiSelectButton();
  renderSummary();
  renderCalendar();
  renderInspector();
}

function renderWeekdays() {
  els.weekdayRow.innerHTML = WEEKDAYS.map(d => `<div>${d}</div>`).join("");
}

function renderProfileOptions() {
  els.profileSelect.innerHTML = DEFAULT_PROFILES.map(p => `
    <option value="${p.id}">${escapeHTML(p.name)}</option>
  `).join("");
}

function renderSummary() {
  const stats = computeMonthStats(state.currentMonth);
  const cards = [
    { label: "总工时", value: formatHours(stats.totalMinutes), sub: `${stats.dayCount} 天有记录` },
    { label: "正常工时", value: formatHours(stats.normalMinutes), sub: "按模板预期值计算" },
    { label: "加班工时", value: formatHours(stats.overtimeMinutes), sub: "超出模板时长的部分" },
    { label: "夜班工时", value: formatHours(stats.nightMinutes), sub: "按夜间窗口自动统计" },
    { label: "工作天数", value: String(stats.workingDays), sub: "至少包含一个 package 的日期" }
  ];

  els.summaryGrid.innerHTML = cards.map(card => `
    <article class="stat-card">
      <div class="label">${card.label}</div>
      <div class="value">${card.value}</div>
      <div class="sub">${card.sub}</div>
    </article>
  `).join("");
}

function renderCalendar() {
  const month = getMonthData(state.currentMonth);
  const days = buildMonthGrid(state.currentMonth);

  els.calendarGrid.innerHTML = days.map(day => {
    if (!day.dateKey) {
      return `<div class="day-cell empty" aria-hidden="true"></div>`;
    }

    const dayData = month.days[day.dateKey] || { segments: [] };
    const isToday = day.dateKey === toDateKey(new Date());
    const isSelected = day.dateKey === state.selectedDate;
    const isMulti = state.selectedDates.has(day.dateKey);

    const totalMinutes = dayData.segments.reduce((sum, seg) => sum + getSegmentDuration(seg), 0);
    const totalText = totalMinutes > 0 ? formatHours(totalMinutes) : "—";
    const segCount = dayData.segments.length;

    const visiblePieces = dayData.segments.flatMap(seg => renderSegmentPieces(seg));
    const tags = dayData.segments.slice(0, 2).map(seg => {
      const profile = getProfileById(seg.profileId);
      return `<span class="segment-tag">${escapeHTML(profile?.name || seg.profileId)} · ${formatRange(seg.startMinute, seg.endMinute)}</span>`;
    });

    return `
      <button class="day-cell ${isToday ? "today" : ""} ${isSelected ? "selected" : ""} ${isMulti ? "multiselected" : ""}" data-date="${day.dateKey}">
        <div class="day-top">
          <div class="day-num">
            <strong>${day.dayNumber}</strong>
            <small>${day.weekday}</small>
          </div>
          <div class="day-total">
            <strong>${totalText}</strong>
            <small>${segCount ? `${segCount} 个 package` : "无记录"}</small>
          </div>
        </div>

        <div class="timeline" aria-hidden="true">
          ${visiblePieces.join("")}
        </div>

        <div class="segment-tags">
          ${tags.join("")}
        </div>

        <div class="day-footer">
          <span>${day.isCurrentMonth ? day.dateKey : ""}</span>
          <span>${isToday ? "今天" : ""}</span>
        </div>
      </button>
    `;
  }).join("");
}

function renderInspector() {
  const month = getMonthData(state.currentMonth);
  const dayData = month.days[state.selectedDate] || { segments: [] };
  const selectedCount = state.multiSelectMode ? state.selectedDates.size : 0;

  els.selectionBadge.textContent = state.multiSelectMode
    ? `${selectedCount} 选中`
    : "单选模式";

  els.selectedDatesChips.innerHTML = state.multiSelectMode && selectedCount
    ? [...state.selectedDates].sort().map(d => `<span class="chip">${d}</span>`).join("")
    : "";

  const segments = dayData.segments || [];
  const totalMinutes = segments.reduce((sum, seg) => sum + getSegmentDuration(seg), 0);

  els.inspectorTitle.textContent = state.selectedDate || "请选择日期";
  els.inspectorMeta.textContent = segments.length
    ? `该日共 ${segments.length} 个 package，合计 ${formatHours(totalMinutes)}`
    : "该日暂无记录，可直接添加一个时间 package";

  if (!segments.length) {
    els.daySegments.innerHTML = `
      <div class="segment-item">
        <div class="title">空状态</div>
        <div class="meta">
          当前日期没有任何时间 package。你可以在下方直接新增，或者开启多选后一次性应用到多个日期。
        </div>
      </div>
    `;
  } else {
    els.daySegments.innerHTML = segments.map(seg => {
      const profile = getProfileById(seg.profileId);
      const duration = getSegmentDuration(seg);
      return `
        <div class="segment-item">
          <div class="row">
            <div>
              <div class="title">${escapeHTML(profile?.name || seg.profileId)} · ${formatRange(seg.startMinute, seg.endMinute)}</div>
              <div class="meta">
                类型：${labelSegmentType(seg.segmentType)} · 时长：${formatHours(duration)}<br/>
                ${seg.note ? `备注：${escapeHTML(seg.note)}<br/>` : ""}
                模板ID：${escapeHTML(seg.profileId)}
              </div>
            </div>
            <div class="segment-actions">
              <button type="button" data-action="edit" data-date="${state.selectedDate}" data-segment-id="${seg.id}">编辑</button>
              <button type="button" data-action="delete" data-date="${state.selectedDate}" data-segment-id="${seg.id}">删除</button>
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  if (state.editing) {
    els.submitBtn.textContent = "保存修改";
    els.cancelEditBtn.hidden = false;
    els.formHint.textContent = `正在编辑 ${state.editing.dateKey} 的一个 package。保存后会同步更新本地数据。`;
  } else {
    els.submitBtn.textContent = state.multiSelectMode && state.selectedDates.size > 1
      ? `批量添加到 ${state.selectedDates.size} 天`
      : "添加时间 package";
    els.cancelEditBtn.hidden = true;
    els.formHint.textContent = state.multiSelectMode && state.selectedDates.size > 1
      ? `将添加到当前选中的 ${state.selectedDates.size} 个日期。`
      : "当前会优先应用到已选日期；未开启多选时，作用于当前日期。";
  }
}

function handleFormSubmit(e) {
  e.preventDefault();

  const fd = new FormData(els.segmentForm);
  const profileId = String(fd.get("profileId") || "custom");
  const profile = getProfileById(profileId);

  const startRaw = String(fd.get("start") || "");
  const endRaw = String(fd.get("end") || "");
  const segmentType = String(fd.get("segmentType") || profile?.defaultType || "custom");
  const note = String(fd.get("note") || "").trim();

  const startMinute = parseTimeToMinute(startRaw);
  let endMinute = parseTimeToMinute(endRaw);

  if (Number.isNaN(startMinute) || Number.isNaN(endMinute)) {
    showToast("开始时间或结束时间无效");
    return;
  }

  if (startMinute === endMinute) {
    showToast("开始与结束不能相同");
    return;
  }

  if (endMinute <= startMinute) {
    endMinute += 1440; // 自动视为跨天
  }

  const targetDates = resolveTargetDates();

  if (!targetDates.length) {
    showToast("没有可应用的日期");
    return;
  }

  if (state.editing) {
    const { dateKey, segmentId } = state.editing;
    updateSegment(dateKey, segmentId, {
      profileId,
      segmentType,
      startMinute,
      endMinute,
      note
    });
    state.editing = null;
    showToast("已保存修改");
  } else {
    targetDates.forEach(dateKey => {
      addSegment(dateKey, {
        profileId,
        segmentType,
        startMinute,
        endMinute,
        note
      });
    });
    showToast(targetDates.length > 1 ? `已批量添加到 ${targetDates.length} 天` : "已添加");
  }

  syncFormDefaults();
  render();
}

function resolveTargetDates() {
  if (state.editing) return [state.editing.dateKey];

  if (state.multiSelectMode && state.selectedDates.size) {
    return [...state.selectedDates].sort();
  }

  return state.selectedDate ? [state.selectedDate] : [];
}

function startEdit(dateKey, segmentId) {
  const month = getMonthData(state.currentMonth);
  const seg = (month.days[dateKey]?.segments || []).find(s => s.id === segmentId);
  if (!seg) return;

  state.selectedDate = dateKey;
  state.selectedDates.clear();
  state.multiSelectMode = false;
  state.editing = { dateKey, segmentId };

  els.segmentForm.elements.segmentId.value = segmentId;
  els.segmentForm.elements.profileId.value = seg.profileId;
  els.segmentForm.elements.start.value = minuteToTime(seg.startMinute);
  els.segmentForm.elements.end.value = minuteToTime(seg.endMinute % 1440);
  els.segmentForm.elements.segmentType.value = seg.segmentType || "custom";
  els.segmentForm.elements.note.value = seg.note || "";

  updateMultiSelectButton();
  render();
  showToast("已进入编辑状态");
}

function syncFormDefaults() {
  if (state.editing) return;

  const profile = getProfileById(els.profileSelect.value) || DEFAULT_PROFILES[0];
  els.segmentForm.reset();
  els.segmentForm.elements.profileId.value = profile.id;
  els.segmentForm.elements.start.value = profile.presetStart;
  els.segmentForm.elements.end.value = profile.presetEnd;
  els.segmentForm.elements.segmentType.value = profile.defaultType;
  els.segmentForm.elements.note.value = "";
  els.segmentForm.elements.segmentId.value = "";
}

function addSegment(dateKey, segment) {
  const month = getMonthData(monthKeyFromDateKey(dateKey));
  ensureDay(month.month, dateKey);

  month.days[dateKey].segments.push({
    id: cryptoId(),
    profileId: segment.profileId,
    segmentType: segment.segmentType,
    startMinute: segment.startMinute,
    endMinute: segment.endMinute,
    note: segment.note || "",
    createdAt: new Date().toISOString()
  });

  saveData(state.data);
}

function updateSegment(dateKey, segmentId, updates) {
  const month = getMonthData(monthKeyFromDateKey(dateKey));
  const day = month.days[dateKey];
  if (!day) return;

  const idx = day.segments.findIndex(s => s.id === segmentId);
  if (idx === -1) return;

  day.segments[idx] = {
    ...day.segments[idx],
    ...updates,
    updatedAt: new Date().toISOString()
  };

  saveData(state.data);
}

function deleteSegment(dateKey, segmentId) {
  const month = getMonthData(monthKeyFromDateKey(dateKey));
  const day = month.days[dateKey];
  if (!day) return;

  day.segments = day.segments.filter(s => s.id !== segmentId);

  if (state.editing && state.editing.dateKey === dateKey && state.editing.segmentId === segmentId) {
    state.editing = null;
    syncFormDefaults();
  }

  saveData(state.data);
  render();
}

function computeMonthStats(monthKey) {
  const month = getMonthData(monthKey);

  let totalMinutes = 0;
  let normalMinutes = 0;
  let overtimeMinutes = 0;
  let nightMinutes = 0;
  let workingDays = 0;
  let dayCount = 0;

  for (const [dateKey, day] of Object.entries(month.days)) {
    if (!day.segments?.length) continue;
    dayCount += 1;
    workingDays += 1;

    for (const seg of day.segments) {
      const duration = getSegmentDuration(seg);
      totalMinutes += duration;

      const profile = getProfileById(seg.profileId) || DEFAULT_PROFILES[0];
      const expected = Math.max(0, profile.expectedMinutes || 0);

      normalMinutes += Math.min(duration, expected);
      overtimeMinutes += Math.max(duration - expected, 0);

      nightMinutes += computeNightOverlap(seg.startMinute, seg.endMinute, profile.nightStart, profile.nightEnd);
    }
  }

  return {
    totalMinutes,
    normalMinutes,
    overtimeMinutes,
    nightMinutes,
    workingDays,
    dayCount
  };
}

function computeNightOverlap(start, end, nightStart = 1320, nightEnd = 360) {
  // 使用两天窗口来覆盖跨天段
  let total = 0;
  const segStart = start;
  const segEnd = end;

  const firstBase = Math.floor(segStart / 1440) * 1440 - 1440;
  const lastBase = Math.floor(segEnd / 1440) * 1440 + 1440;

  for (let base = firstBase; base <= lastBase; base += 1440) {
    if (nightStart < nightEnd) {
      total += overlap(segStart, segEnd, base + nightStart, base + nightEnd);
    } else {
      total += overlap(segStart, segEnd, base + nightStart, base + 1440);
      total += overlap(segStart, segEnd, base, base + nightEnd);
    }
  }

  return total;
}

function overlap(aStart, aEnd, bStart, bEnd) {
  const s = Math.max(aStart, bStart);
  const e = Math.min(aEnd, bEnd);
  return Math.max(0, e - s);
}

function getSegmentDuration(seg) {
  return Math.max(0, seg.endMinute - seg.startMinute);
}

function renderSegmentPieces(seg) {
  const start = seg.startMinute;
  const end = seg.endMinute;
  const typeClass = seg.segmentType || "custom";

  if (end <= 1440) {
    return [pieceMarkup(start, end, typeClass)];
  }

  const pieces = [];
  pieces.push(pieceMarkup(start, 1440, typeClass));
  const nextDayEnd = end - 1440;
  if (nextDayEnd > 0) {
    pieces.push(pieceMarkup(0, nextDayEnd, typeClass));
  }
  return pieces;
}

function pieceMarkup(startMinute, endMinute, typeClass) {
  const left = (startMinute / 1440) * 100;
  const width = Math.max(1.5, ((endMinute - startMinute) / 1440) * 100);
  return `<span class="segment-piece ${typeClass}" style="left:${left}%; width:${width}%"></span>`;
}

function buildMonthGrid(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  const startIndex = (first.getDay() + 6) % 7; // Monday-based
  const daysInMonth = new Date(year, month, 0).getDate();

  const grid = [];
  for (let i = 0; i < startIndex; i++) {
    grid.push({ dateKey: null });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month - 1, d);
    const dateKey = toDateKey(date);
    grid.push({
      dateKey,
      dayNumber: d,
      weekday: WEEKDAYS[(date.getDay() + 6) % 7],
      isCurrentMonth: true
    });
  }

  while (grid.length % 7 !== 0) {
    grid.push({ dateKey: null });
  }

  return grid;
}

function ensureMonth(monthKey) {
  if (!state.data.months[monthKey]) {
    state.data.months[monthKey] = {
      month: monthKey,
      days: {}
    };
    saveData(state.data);
  }
  return state.data.months[monthKey];
}

function ensureDay(monthKey, dateKey) {
  const month = ensureMonth(monthKey);
  if (!month.days[dateKey]) {
    month.days[dateKey] = { date: dateKey, segments: [] };
  }
  return month.days[dateKey];
}

function getMonthData(monthKey) {
  return ensureMonth(monthKey);
}

function getProfileById(profileId) {
  return state.data.profiles.find(p => p.id === profileId) || DEFAULT_PROFILES.find(p => p.id === profileId) || null;
}

function updateMultiSelectButton() {
  els.multiSelectBtn.textContent = state.multiSelectMode
    ? `多选日期 · ${state.selectedDates.size}`
    : "多选日期";
}

function exportJSON() {
  const payload = JSON.stringify(state.data, null, 2);
  downloadFile(`work-hours-${state.currentMonth}.json`, payload, "application/json;charset=utf-8");
  showToast("已导出 JSON");
}

function exportCSV() {
  const month = getMonthData(state.currentMonth);
  const rows = [
    ["month", "day", "segmentId", "profileId", "profileName", "segmentType", "start", "end", "durationMinutes", "note"]
  ];

  Object.entries(month.days).forEach(([dateKey, day]) => {
    day.segments.forEach(seg => {
      const profile = getProfileById(seg.profileId);
      rows.push([
        state.currentMonth,
        dateKey,
        seg.id,
        seg.profileId,
        profile?.name || seg.profileId,
        seg.segmentType,
        minuteToTime(seg.startMinute),
        minuteToTime(seg.endMinute % 1440),
        getSegmentDuration(seg),
        (seg.note || "").replaceAll('"', '""')
      ]);
    });
  });

  const csv = rows.map(row =>
    row.map(cell => {
      const value = String(cell ?? "");
      return /[",\n]/.test(value) ? `"${value}"` : value;
    }).join(",")
  ).join("\n");

  downloadFile(`work-hours-${state.currentMonth}.csv`, csv, "text/csv;charset=utf-8");
  showToast("已导出 CSV");
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {
      version: 1,
      profiles: structuredClone(DEFAULT_PROFILES),
      months: {}
    };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      version: 1,
      profiles: Array.isArray(parsed.profiles) && parsed.profiles.length ? parsed.profiles : structuredClone(DEFAULT_PROFILES),
      months: parsed.months || {}
    };
  } catch {
    return {
      version: 1,
      profiles: structuredClone(DEFAULT_PROFILES),
      months: {}
    };
  }
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function formatMonthKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function formatMonthLabel(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const date = new Date(y, m - 1, 1);
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(date);
}

function shiftMonth(monthKey, delta) {
  const [y, m] = monthKey.split("-").map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return formatMonthKey(date);
}

function monthKeyFromDateKey(dateKey) {
  return dateKey.slice(0, 7);
}

function getDaysInMonth(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();
  return Array.from({ length: days }, (_, i) => `${monthKey}-${String(i + 1).padStart(2, "0")}`);
}

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseTimeToMinute(value) {
  const [h, m] = value.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return Number.NaN;
  return h * 60 + m;
}

function minuteToTime(minute) {
  const total = ((minute % 1440) + 1440) % 1440;
  const h = String(Math.floor(total / 60)).padStart(2, "0");
  const m = String(total % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function formatRange(startMinute, endMinute) {
  const start = minuteToTime(startMinute);
  const end = minuteToTime(endMinute);
  return endMinute > 1440 ? `${start} → 次日${end}` : `${start} → ${end}`;
}

function formatHours(minutes) {
  const h = minutes / 60;
  if (!Number.isFinite(h) || h < 0) return "0h";
  const value = h.toFixed(1).replace(/\.0$/, "");
  return `${value}h`;
}

function labelSegmentType(type) {
  switch (type) {
    case "normal": return "正常";
    case "overtime": return "加班";
    case "night": return "夜班";
    default: return "自定义";
  }
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    els.toast.classList.remove("show");
  }, 2200);
}

function cryptoId() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return `id_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

function escapeHTML(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}