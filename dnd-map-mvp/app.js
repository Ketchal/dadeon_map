const SVG_NS = "http://www.w3.org/2000/svg";

const state = {
  mode: "master",
  selection: null,
  tool: null,
  svg: null,
  svgRoot: null,
  zoom: {
    baseViewBox: null,
    current: 1,
    min: 0.5,
    max: 4,
    step: 1.2,
  },
  interaction: {
    isDragging: false,
    draggedType: null,
    draggedId: null,
    movedDuringDrag: false,
  },
  layers: {
    characters: true,
    markers: true,
  },
  data: {
    kingdoms: [],
    provinces: [],
    characters: [],
    markers: [],
  },
};

const refs = {
  mapContainer: document.getElementById("map-container"),
  modeSelect: document.getElementById("mode-select"),
  selectionPanel: document.getElementById("selection-panel"),
  kingdomList: document.getElementById("kingdom-list"),
  kingdomForm: document.getElementById("kingdom-form"),
  kingdomName: document.getElementById("kingdom-name"),
  kingdomRuler: document.getElementById("kingdom-ruler"),
  kingdomColor: document.getElementById("kingdom-color"),
  kingdomVisibility: document.getElementById("kingdom-visibility"),
  addCharacterButton: document.getElementById("add-character-button"),
  addMarkerButton: document.getElementById("add-marker-button"),
  zoomInButton: document.getElementById("zoom-in-button"),
  zoomOutButton: document.getElementById("zoom-out-button"),
  zoomResetButton: document.getElementById("zoom-reset-button"),
  zoomValue: document.getElementById("zoom-value"),
  toolbarHint: document.getElementById("toolbar-hint"),
  exportButton: document.getElementById("export-button"),
  toggleCharacters: document.getElementById("toggle-characters"),
  toggleMarkers: document.getElementById("toggle-markers"),
};

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Не удалось загрузить ${path}`);
  return response.json();
}

async function loadSvg() {
  const response = await fetch("./assets/world-map.svg");
  const svgText = await response.text();
  refs.mapContainer.innerHTML = svgText;
  const svg = refs.mapContainer.querySelector("svg");

  const width = Number(svg.getAttribute("width")) || 1366;
  const height = Number(svg.getAttribute("height")) || 610;
  if (!svg.getAttribute("viewBox")) {
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  const [minX, minY, vbWidth, vbHeight] = svg
    .getAttribute("viewBox")
    .split(/\s+/)
    .map(Number);

  state.zoom.baseViewBox = { minX, minY, width: vbWidth, height: vbHeight };
  state.svgRoot = svg;
  applyZoom();
  return svg;
}

function applyZoom(focusPoint = null) {
  if (!state.svgRoot || !state.zoom.baseViewBox) return;

  const base = state.zoom.baseViewBox;
  const prevMinX = base.currentMinX ?? base.minX;
  const prevMinY = base.currentMinY ?? base.minY;
  const prevWidth = base.currentWidth ?? base.width;
  const prevHeight = base.currentHeight ?? base.height;
  const zoom = state.zoom.current;
  const nextWidth = base.width / zoom;
  const nextHeight = base.height / zoom;

  let nextMinX;
  let nextMinY;

  if (focusPoint) {
    const relativeX = (focusPoint.x - prevMinX) / prevWidth;
    const relativeY = (focusPoint.y - prevMinY) / prevHeight;
    nextMinX = focusPoint.x - relativeX * nextWidth;
    nextMinY = focusPoint.y - relativeY * nextHeight;
  } else {
    const centerX = prevMinX + prevWidth / 2;
    const centerY = prevMinY + prevHeight / 2;
    nextMinX = centerX - nextWidth / 2;
    nextMinY = centerY - nextHeight / 2;
  }

  const maxMinX = base.minX + base.width - nextWidth;
  const maxMinY = base.minY + base.height - nextHeight;
  nextMinX = Math.min(Math.max(nextMinX, base.minX), maxMinX);
  nextMinY = Math.min(Math.max(nextMinY, base.minY), maxMinY);

  base.currentMinX = nextMinX;
  base.currentMinY = nextMinY;
  base.currentWidth = nextWidth;
  base.currentHeight = nextHeight;

  state.svgRoot.setAttribute(
    "viewBox",
    `${nextMinX} ${nextMinY} ${nextWidth} ${nextHeight}`,
  );

  if (refs.zoomValue) {
    refs.zoomValue.textContent = `${Math.round(zoom * 100)}%`;
  }
}

function setZoom(nextZoom, focusPoint = null) {
  const clamped = Math.max(state.zoom.min, Math.min(state.zoom.max, nextZoom));
  state.zoom.current = Number(clamped.toFixed(2));
  applyZoom(focusPoint);
}

function zoomIn(focusPoint = null) {
  setZoom(state.zoom.current * state.zoom.step, focusPoint);
}

function zoomOut(focusPoint = null) {
  setZoom(state.zoom.current / state.zoom.step, focusPoint);
}

function resetZoom() {
  state.zoom.baseViewBox.currentMinX = state.zoom.baseViewBox.minX;
  state.zoom.baseViewBox.currentMinY = state.zoom.baseViewBox.minY;
  state.zoom.baseViewBox.currentWidth = state.zoom.baseViewBox.width;
  state.zoom.baseViewBox.currentHeight = state.zoom.baseViewBox.height;
  setZoom(1);
}

function getKingdomById(id) {
  return state.data.kingdoms.find((item) => item.id === id) ?? null;
}
function getProvinceElement(provinceId) {
  return state.svgRoot.getElementById(provinceId) || state.svgRoot.querySelector(`#${provinceId}`);
}

function getProvinceGapElement(provinceId) {
  const gapId = provinceId.replace(/^state/, "state-gap");
  return state.svgRoot.getElementById(gapId) || state.svgRoot.querySelector(`#${gapId}`);
}

function getEntityBySelection(selection) {
  if (!selection) return null;
  if (selection.type === "character") {
    return state.data.characters.find((item) => item.id === selection.id) ?? null;
  }
  if (selection.type === "marker") {
    return state.data.markers.find((item) => item.id === selection.id) ?? null;
  }
  return null;
}

function updateEntityPosition(type, id, x, y) {
  const collection = type === "character" ? state.data.characters : state.data.markers;
  const entity = collection.find((item) => item.id === id);
  if (!entity) return;
  entity.x = x;
  entity.y = y;
  if (type === "character") {
    const provinceId = getProvinceIdByCoordinates(x, y);
    if (provinceId) {
      entity.provinceId = provinceId;
    }
  }
}

function getProvinceIdByCoordinates(x, y) {
  const provinceElements = state.data.provinces
    .map((province) => ({ provinceId: province.id, element: getProvinceElement(province.id) }))
    .filter((entry) => entry.element && typeof entry.element.isPointInFill === "function");

  for (const entry of provinceElements) {
    const point = state.svgRoot.createSVGPoint();
    point.x = x;
    point.y = y;
    if (entry.element.isPointInFill(point)) {
      return entry.provinceId;
    }
  }

  return null;
}

function beginEntityDrag(type, id, event) {
  if (state.mode !== "master") return;
  state.interaction.isDragging = true;
  state.interaction.draggedType = type;
  state.interaction.draggedId = id;
  state.interaction.movedDuringDrag = false;
  event.stopPropagation();
}

function handlePointerMove(event) {
  if (!state.interaction.isDragging || !state.interaction.draggedType || !state.interaction.draggedId) return;

  const { x, y } = toSvgPoint(event);
  state.interaction.movedDuringDrag = true;
  updateEntityPosition(state.interaction.draggedType, state.interaction.draggedId, x, y);

  if (state.interaction.draggedType === "character") {
    renderCharacters();
  } else if (state.interaction.draggedType === "marker") {
    renderMarkers();
  }

  if (state.selection?.type === state.interaction.draggedType && state.selection.id === state.interaction.draggedId) {
    renderSelectionPanel();
  }
}

function endEntityDrag() {
  if (!state.interaction.isDragging) return;
  state.interaction.isDragging = false;
  state.interaction.draggedType = null;
  state.interaction.draggedId = null;
  requestAnimationFrame(() => {
    state.interaction.movedDuringDrag = false;
  });
}


function isVisible(entity) {
  return state.mode === "master" || entity.visibility !== "master";
}

function setTool(nextTool) {
  state.tool = state.tool === nextTool ? null : nextTool;
  renderAll();
}

function clearSelection() {
  state.selection = null;
  renderAll();
}

function setupProvinceInteractions() {
  state.data.provinces.forEach((province) => {
    const element = getProvinceElement(province.id);
    if (!element) return;

    element.style.pointerEvents = "all";
    element.style.cursor = "pointer";
    element.dataset.entityType = "province";
    element.dataset.entityId = province.id;

    element.addEventListener("mouseenter", () => {
      if (state.selection?.type !== "province" || state.selection.id !== province.id) {
        element.style.filter = "brightness(1.12)";
      }
    });

    element.addEventListener("mouseleave", () => {
      if (state.selection?.type !== "province" || state.selection.id !== province.id) {
        element.style.filter = "";
      }
    });

    element.addEventListener("click", (event) => {
      event.stopPropagation();
      selectProvince(province.id);
    });
  });

  state.svgRoot.addEventListener("click", handleMapClick);
  refs.mapContainer.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const focusPoint = toSvgPoint(event);
      if (event.deltaY < 0) {
        zoomIn(focusPoint);
      } else {
        zoomOut(focusPoint);
      }
    },
    { passive: false },
  );

  refs.mapContainer.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", endEntityDrag);
}

function applyProvinceStyles() {
  state.data.provinces.forEach((province) => {
    const element = getProvinceElement(province.id);
    if (!element) return;

    const gapElement = getProvinceGapElement(province.id);
    const kingdom = getKingdomById(province.kingdomId);
    const baseColor = kingdom?.color ?? "#666666";
    const isSelected = state.selection?.type === "province" && state.selection.id === province.id;
    element.setAttribute("fill", baseColor);
    element.setAttribute("fill-opacity", isVisible(province) ? "0.5" : "0.14");
    element.style.stroke = isSelected ? "#fff3d2" : "rgba(0,0,0,.25)";
    element.style.strokeWidth = isSelected ? "3" : "1";
    element.classList.toggle("is-hidden-for-player", state.mode === "player" && province.visibility === "master");

    if (gapElement) {
      gapElement.setAttribute("stroke", baseColor);
      gapElement.setAttribute("stroke-opacity", isVisible(province) ? "0.75" : "0.2");
      gapElement.setAttribute("stroke-width", isSelected ? "4" : "3");
      gapElement.classList.toggle("is-hidden-for-player", state.mode === "player" && province.visibility === "master");
    }
  });
}

function ensureOverlayLayer(id) {
  let layer = state.svgRoot.querySelector(`#${id}`);
  if (!layer) {
    layer = document.createElementNS(SVG_NS, "g");
    layer.setAttribute("id", id);
    state.svgRoot.appendChild(layer);
  }
  layer.innerHTML = "";
  return layer;
}

function renderCharacters() {
  const layer = ensureOverlayLayer("characters-overlay");
  if (!state.layers.characters) return;

  state.data.characters.forEach((character) => {
    if (!isVisible(character)) return;

    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", String(character.x));
    circle.setAttribute("cy", String(character.y));
    circle.setAttribute("r", "7");
    circle.setAttribute("fill", state.selection?.type === "character" && state.selection.id === character.id ? "#ffe9a6" : "#f1f1f1");
    circle.setAttribute("class", "map-character");
    circle.dataset.entityType = "character";
    circle.dataset.entityId = character.id;
    circle.addEventListener("pointerdown", (event) => {
      beginEntityDrag("character", character.id, event);
    });
    circle.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.interaction.movedDuringDrag) return;
      state.selection = { type: "character", id: character.id };
      renderSelectionPanel();
      applyProvinceStyles();
      renderCharacters();
      renderMarkers();
    });
    layer.appendChild(circle);
  });
}

function markerColor(type) {
  switch (type) {
    case "ruins": return "#d6b26e";
    case "battle": return "#c85c5c";
    case "quest": return "#7bc5ff";
    case "secret": return "#aa7aff";
    default: return "#9cd38f";
  }
}

function renderMarkers() {
  const layer = ensureOverlayLayer("markers-overlay");
  if (!state.layers.markers) return;

  state.data.markers.forEach((marker) => {
    if (!isVisible(marker)) return;

    const group = document.createElementNS(SVG_NS, "g");
    group.dataset.entityType = "marker";
    group.dataset.entityId = marker.id;
    group.addEventListener("pointerdown", (event) => {
      beginEntityDrag("marker", marker.id, event);
    });
    group.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.interaction.movedDuringDrag) return;
      state.selection = { type: "marker", id: marker.id };
      renderSelectionPanel();
      applyProvinceStyles();
      renderMarkers();
    });

    const diamond = document.createElementNS(SVG_NS, "rect");
    diamond.setAttribute("x", String(marker.x - 6));
    diamond.setAttribute("y", String(marker.y - 6));
    diamond.setAttribute("width", "12");
    diamond.setAttribute("height", "12");
    diamond.setAttribute("fill", state.selection?.type === "marker" && state.selection.id === marker.id ? "#ffe9a6" : markerColor(marker.type));
    diamond.setAttribute("transform", `rotate(45 ${marker.x} ${marker.y})`);
    diamond.setAttribute("class", "map-marker");

    group.appendChild(diamond);
    layer.appendChild(group);
  });
}

function selectProvince(id) {
  state.selection = { type: "province", id };
  renderSelectionPanel();
  applyProvinceStyles();
  renderCharacters();
  renderMarkers();
}

function provinceTemplate(province) {
  const kingdom = getKingdomById(province.kingdomId);
  const ownerOptions = state.data.kingdoms.map((item) => `
    <option value="${item.id}" ${item.id === province.kingdomId ? "selected" : ""}>${item.name}</option>
  `).join("");

  const masterTools = state.mode === "master" ? `
    <hr />
    <div class="stack compact-form">
      <label>Владелец
        <select id="province-owner-select">${ownerOptions}</select>
      </label>
      <label>Видимость
        <select id="province-visibility-select">
          <option value="player" ${province.visibility === "player" ? "selected" : ""}>Видно игрокам</option>
          <option value="master" ${province.visibility === "master" ? "selected" : ""}>Только мастеру</option>
        </select>
      </label>
      <label>Описание
        <textarea id="province-description-input">${province.description}</textarea>
      </label>
      <button id="save-province-button">Сохранить провинцию</button>
    </div>
  ` : "";

  return `
    <h3 class="selection-title">${province.name}</h3>
    <div class="badges">
      <span class="badge">Провинция</span>
      <span class="badge">${province.capital ? "Столичный регион" : "Обычная провинция"}</span>
      <span class="badge">${province.visibility === "player" ? "Открыта" : "Скрыта"}</span>
    </div>
    <p><strong>Владелец:</strong> ${kingdom ? kingdom.name : "Неизвестно"}</p>
    <p><strong>Правитель:</strong> ${kingdom?.ruler ?? "—"}</p>
    <p>${province.description}</p>
    ${masterTools}
  `;
}

function getProvinceName(id) {
  return state.data.provinces.find((item) => item.id === id)?.name ?? id;
}

function characterTemplate(character) {
  const editForm = state.mode === "master" ? `
    <hr />
    <div class="stack compact-form">
      <label>Имя
        <input id="character-name-input" type="text" value="${character.name}" />
      </label>
      <label>Статус
        <input id="character-status-input" type="text" value="${character.status}" />
      </label>
      <label>Провинция
        <select id="character-province-select">
          ${state.data.provinces.map((province) => `<option value="${province.id}" ${province.id === character.provinceId ? "selected" : ""}>${province.name}</option>`).join("")}
        </select>
      </label>
      <label>Видимость
        <select id="character-visibility-select">
          <option value="player" ${character.visibility === "player" ? "selected" : ""}>Видно игрокам</option>
          <option value="master" ${character.visibility === "master" ? "selected" : ""}>Только мастеру</option>
        </select>
      </label>
      <label>Описание
        <textarea id="character-summary-input">${character.summary}</textarea>
      </label>
      <div class="selection-actions">
        <button id="save-character-button">Сохранить персонажа</button>
        <button id="delete-character-button" class="danger-button" type="button">Удалить персонажа</button>
      </div>
    </div>
  ` : "";

  return `
    <h3 class="selection-title">${character.name}</h3>
    <div class="badges">
      <span class="badge">Персонаж</span>
      <span class="badge">${character.visibility === "player" ? "Открыт" : "Скрыт"}</span>
    </div>
    <p><strong>Статус:</strong> ${character.status}</p>
    <p><strong>Провинция:</strong> ${getProvinceName(character.provinceId)}</p>
    <p><strong>Координаты:</strong> ${character.x}, ${character.y}</p>
    <p>${character.summary}</p>
    ${editForm}
  `;
}

function markerTemplate(marker) {
  const editForm = state.mode === "master" ? `
    <hr />
    <div class="stack compact-form">
      <label>Название
        <input id="marker-title-input" type="text" value="${marker.title}" />
      </label>
      <label>Тип
        <select id="marker-type-select">
          <option value="quest" ${marker.type === "quest" ? "selected" : ""}>Квест</option>
          <option value="ruins" ${marker.type === "ruins" ? "selected" : ""}>Руины</option>
          <option value="battle" ${marker.type === "battle" ? "selected" : ""}>Битва</option>
          <option value="secret" ${marker.type === "secret" ? "selected" : ""}>Тайна</option>
          <option value="generic" ${marker.type === "generic" ? "selected" : ""}>Обычная точка</option>
        </select>
      </label>
      <label>Видимость
        <select id="marker-visibility-select">
          <option value="player" ${marker.visibility === "player" ? "selected" : ""}>Видно игрокам</option>
          <option value="master" ${marker.visibility === "master" ? "selected" : ""}>Только мастеру</option>
        </select>
      </label>
      <label>Описание
        <textarea id="marker-text-input">${marker.text}</textarea>
      </label>
      <div class="selection-actions">
        <button id="save-marker-button">Сохранить маркер</button>
        <button id="delete-marker-button" class="danger-button" type="button">Удалить маркер</button>
      </div>
    </div>
  ` : "";

  return `
    <h3 class="selection-title">${marker.title}</h3>
    <div class="badges">
      <span class="badge">Маркер</span>
      <span class="badge">${marker.type}</span>
      <span class="badge">${marker.visibility === "player" ? "Открыт" : "Скрыт"}</span>
    </div>
    <p>${marker.text || "Без описания."}</p>
    <p class="small">Координаты: ${marker.x}, ${marker.y}</p>
    ${editForm}
  `;
}

function renderSelectionPanel() {
  if (!state.selection) {
    refs.selectionPanel.innerHTML = "<p>Ничего не выбрано.</p>";
    return;
  }

  if (state.selection.type === "province") {
    const province = state.data.provinces.find((item) => item.id === state.selection.id);
    refs.selectionPanel.innerHTML = province ? provinceTemplate(province) : "<p>Провинция не найдена.</p>";
    if (province && state.mode === "master") {
      document.getElementById("save-province-button")?.addEventListener("click", () => saveProvinceChanges(province.id));
    }
    return;
  }

  if (state.selection.type === "character") {
    const character = state.data.characters.find((item) => item.id === state.selection.id);
    refs.selectionPanel.innerHTML = character ? characterTemplate(character) : "<p>Персонаж не найден.</p>";
    if (character && state.mode === "master") {
      document.getElementById("save-character-button")?.addEventListener("click", () => saveCharacterChanges(character.id));
      document.getElementById("delete-character-button")?.addEventListener("click", () => deleteCharacter(character.id));
    }
    return;
  }

  if (state.selection.type === "marker") {
    const marker = state.data.markers.find((item) => item.id === state.selection.id);
    refs.selectionPanel.innerHTML = marker ? markerTemplate(marker) : "<p>Маркер не найден.</p>";
    if (marker && state.mode === "master") {
      document.getElementById("save-marker-button")?.addEventListener("click", () => saveMarkerChanges(marker.id));
      document.getElementById("delete-marker-button")?.addEventListener("click", () => deleteMarker(marker.id));
    }
  }
}

function saveProvinceChanges(provinceId) {
  const province = state.data.provinces.find((item) => item.id === provinceId);
  if (!province) return;

  province.kingdomId = document.getElementById("province-owner-select")?.value ?? province.kingdomId;
  province.visibility = document.getElementById("province-visibility-select")?.value ?? province.visibility;
  province.description = document.getElementById("province-description-input")?.value ?? province.description;

  renderAll();
}

function saveCharacterChanges(characterId) {
  const character = state.data.characters.find((item) => item.id === characterId);
  if (!character) return;

  character.name = document.getElementById("character-name-input")?.value.trim() || character.name;
  character.status = document.getElementById("character-status-input")?.value.trim() || "Без статуса";
  character.provinceId = document.getElementById("character-province-select")?.value || character.provinceId;
  character.visibility = document.getElementById("character-visibility-select")?.value || character.visibility;
  character.summary = document.getElementById("character-summary-input")?.value.trim() || "";

  renderAll();
}

function deleteCharacter(characterId) {
  const character = state.data.characters.find((item) => item.id === characterId);
  if (!character) return;

  const shouldDelete = window.confirm(`Удалить персонажа "${character.name}"?`);
  if (!shouldDelete) return;

  state.data.characters = state.data.characters.filter((item) => item.id !== characterId);
  state.selection = null;
  renderAll();
}

function saveMarkerChanges(markerId) {
  const marker = state.data.markers.find((item) => item.id === markerId);
  if (!marker) return;

  marker.title = document.getElementById("marker-title-input")?.value.trim() || marker.title;
  marker.type = document.getElementById("marker-type-select")?.value || marker.type;
  marker.visibility = document.getElementById("marker-visibility-select")?.value || marker.visibility;
  marker.text = document.getElementById("marker-text-input")?.value.trim() || "";

  renderAll();
}

function deleteMarker(markerId) {
  const marker = state.data.markers.find((item) => item.id === markerId);
  if (!marker) return;

  const shouldDelete = window.confirm(`Удалить маркер "${marker.title}"?`);
  if (!shouldDelete) return;

  state.data.markers = state.data.markers.filter((item) => item.id !== markerId);
  state.selection = null;
  renderAll();
}

function renderKingdomList() {
  refs.kingdomList.innerHTML = "";
  state.data.kingdoms
    .filter((kingdom) => isVisible(kingdom))
    .forEach((kingdom) => {
      const provinceCount = state.data.provinces.filter((province) => province.kingdomId === kingdom.id).length;
      const card = document.createElement("div");
      card.className = "kingdom-card";
      card.innerHTML = `
        <div class="inline-row"><span class="color-chip" style="background:${kingdom.color}"></span><strong>${kingdom.name}</strong></div>
        <div class="small">Правитель: ${kingdom.ruler || "—"}</div>
        <div class="small">Провинций: ${provinceCount}</div>
        <div class="small ${kingdom.visibility === "master" ? "status-danger" : "status-ok"}">
          ${kingdom.visibility === "master" ? "Скрыто от игроков" : "Видно игрокам"}
        </div>
      `;
      refs.kingdomList.appendChild(card);
    });
}

function getProvinceIdAtPoint(target) {
  const provinceElement = target.closest?.("[data-entity-type='province'], [id^='state']");
  if (!provinceElement) return null;
  return provinceElement.dataset.entityId || provinceElement.id || null;
}

function createCharacterAt(x, y, provinceId = null) {
  const character = {
    id: `char-${crypto.randomUUID().slice(0, 8)}`,
    name: "Новый персонаж",
    provinceId: provinceId || state.data.provinces[0]?.id || "",
    x,
    y,
    status: "Без статуса",
    summary: "",
    visibility: "player",
  };

  state.data.characters.push(character);
  state.selection = { type: "character", id: character.id };
  state.tool = null;
  renderAll();
}

function createMarkerAt(x, y) {
  const marker = {
    id: `marker-${crypto.randomUUID().slice(0, 8)}`,
    type: "quest",
    title: "Новый маркер",
    text: "",
    x,
    y,
    visibility: "player",
  };

  state.data.markers.push(marker);
  state.selection = { type: "marker", id: marker.id };
  state.tool = null;
  renderAll();
}

function renderAll() {
  applyProvinceStyles();
  renderCharacters();
  renderMarkers();
  renderSelectionPanel();
  renderKingdomList();

  refs.addCharacterButton.classList.toggle("active-tool", state.tool === "add-character");
  refs.addMarkerButton.classList.toggle("active-tool", state.tool === "add-marker");

  refs.toolbarHint.textContent = state.tool === "add-character"
    ? "Кликните по карте, чтобы поставить нового персонажа."
    : state.tool === "add-marker"
      ? "Кликните по карте, чтобы поставить новый маркер."
      : state.mode === "master"
        ? "Выберите объект на карте. Персонажей и маркеры можно перетаскивать мышью."
        : "Режим игрока: скрытые объекты не отображаются. Колесо мыши меняет масштаб.";
}

function createKingdom(event) {
  event.preventDefault();
  const name = refs.kingdomName.value.trim();
  if (!name) return;

  const id = `kingdom-${crypto.randomUUID().slice(0, 8)}`;
  state.data.kingdoms.push({
    id,
    name,
    ruler: refs.kingdomRuler.value.trim(),
    color: refs.kingdomColor.value,
    visibility: refs.kingdomVisibility.value,
  });

  refs.kingdomForm.reset();
  refs.kingdomColor.value = "#7a3cff";
  renderAll();
}

function toSvgPoint(event) {
  const point = state.svgRoot.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const transformed = point.matrixTransform(state.svgRoot.getScreenCTM().inverse());
  return { x: Math.round(transformed.x), y: Math.round(transformed.y) };
}

function handleMapClick(event) {
  if (state.interaction.movedDuringDrag) return;
  if (state.mode !== "master") return;

  const { x, y } = toSvgPoint(event);

  if (state.tool === "add-character") {
    const provinceId = getProvinceIdAtPoint(event.target);
    createCharacterAt(x, y, provinceId);
    return;
  }

  if (state.tool === "add-marker") {
    createMarkerAt(x, y);
    return;
  }

  if (!(event.target instanceof SVGElement) || event.target === state.svgRoot) {
    clearSelection();
  }
}

function exportState() {
  const payload = JSON.stringify(state.data, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "world-state.json";
  link.click();
  URL.revokeObjectURL(url);
}

function bindEvents() {
  refs.modeSelect.addEventListener("change", (event) => {
    state.mode = event.target.value;
    if (state.mode === "player") state.tool = null;
    renderAll();
  });

  refs.kingdomForm.addEventListener("submit", createKingdom);

  refs.addCharacterButton.addEventListener("click", () => {
    if (state.mode !== "master") return;
    setTool("add-character");
  });

  refs.addMarkerButton.addEventListener("click", () => {
    if (state.mode !== "master") return;
    setTool("add-marker");
  });

  refs.zoomInButton.addEventListener("click", zoomIn);
  refs.zoomOutButton.addEventListener("click", zoomOut);
  refs.zoomResetButton.addEventListener("click", resetZoom);
  refs.exportButton.addEventListener("click", exportState);

  refs.toggleCharacters.addEventListener("change", (event) => {
    state.layers.characters = event.target.checked;
    renderAll();
  });

  refs.toggleMarkers.addEventListener("change", (event) => {
    state.layers.markers = event.target.checked;
    renderAll();
  });
}

async function init() {
  try {
    const [kingdoms, provinces, characters, markers] = await Promise.all([
      loadJson("./data/kingdoms.json"),
      loadJson("./data/provinces.json"),
      loadJson("./data/characters.json"),
      loadJson("./data/markers.json"),
    ]);

    state.data.kingdoms = kingdoms;
    state.data.provinces = provinces;
    state.data.characters = characters;
    state.data.markers = markers;

    await loadSvg();
    setupProvinceInteractions();
    bindEvents();
    renderAll();
  } catch (error) {
    console.error(error);
    refs.mapContainer.innerHTML = `<div style="padding:20px;color:#ffb5b5;">Ошибка запуска: ${error.message}</div>`;
  }
}

init();
