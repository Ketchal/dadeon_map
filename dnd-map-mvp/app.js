const SVG_PATH = "./assets/world-map.svg";
const SVG_NS = "http://www.w3.org/2000/svg";

const state = {
  svgRoot: null,
  selectedRegionId: null,
  selectedSettlementId: null,
  hoveredRegionId: null,
  regions: [],
  tool: null,
  interaction: {
    settlementPointerDown: null,
    isDraggingSettlement: false,
    draggedSettlementId: null,
    pointerId: null,
    movedDuringDrag: false,
  },
  measurement: {
    start: null,
    end: null,
  },
  data: {
    kingdoms: [],
    provinces: [],
    settlements: [],
  },
  zoom: {
    baseViewBox: null,
    current: 1,
    min: 1,
    max: 6,
    step: 1.2,
  },
  pan: {
    active: false,
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    startMinX: 0,
    startMinY: 0,
    moved: false,
  },
};

const MAP_UNIT_LABEL = "км";
const MAP_UNITS_TO_WORLD = 800 / 202; // ≈ 3.9604

const refs = {
  mapContainer: document.getElementById("map-container"),
  selectionPanel: document.getElementById("selection-panel"),
  zoomInButton: document.getElementById("zoom-in-button"),
  zoomOutButton: document.getElementById("zoom-out-button"),
  zoomResetButton: document.getElementById("zoom-reset-button"),
  zoomValue: document.getElementById("zoom-value"),
  toolbarHint: document.getElementById("toolbar-hint"),
  addSettlementButton: document.getElementById("add-settlement-button"),
  exportSettlementsButton: document.getElementById("export-settlements-button"),
  measureToolButton: document.getElementById("measure-tool-button"),
};

const STATE_LABEL_OVERRIDES = {
  deya: {
    scale: 2.5,
  },
  "marginal-forest": {
    scale: 1.5,
  },
  "khukbadus-clans": {
    scale: 0.75,
  },
  "dominion-of-eatein": {
    scale: 0.65,
  },
};

function setHint(text) {
  if (refs.toolbarHint) refs.toolbarHint.textContent = text;
}

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Не удалось загрузить JSON: ${path}`);
  }
  return response.json();
}

async function loadSvg() {
  const response = await fetch(SVG_PATH);
  if (!response.ok) {
    throw new Error(`Не удалось загрузить SVG: ${SVG_PATH}`);
  }

  const svgText = await response.text();
  refs.mapContainer.innerHTML = svgText;

  const svg = refs.mapContainer.querySelector("svg");
  if (!svg) {
    throw new Error("В загруженном файле не найден тег <svg>.");
  }

  const width = Number(svg.getAttribute("width")) || 1366;
  const height = Number(svg.getAttribute("height")) || 768;

  if (!svg.getAttribute("viewBox")) {
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }

  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  const [minX, minY, vbWidth, vbHeight] = svg
    .getAttribute("viewBox")
    .split(/\s+/)
    .map(Number);

  state.zoom.baseViewBox = {
    minX,
    minY,
    width: vbWidth,
    height: vbHeight,
    currentMinX: minX,
    currentMinY: minY,
    currentWidth: vbWidth,
    currentHeight: vbHeight,
  };

  state.svgRoot = svg;
  applyZoom();

  return svg;
}

function formatDistance(mapUnits) {
  const worldValue = mapUnits * MAP_UNITS_TO_WORLD;

  if (worldValue >= 100) return `${Math.round(worldValue)} ${MAP_UNIT_LABEL}`;
  if (worldValue >= 10) return `${worldValue.toFixed(1)} ${MAP_UNIT_LABEL}`;
  return `${worldValue.toFixed(2)} ${MAP_UNIT_LABEL}`;
}

function getRegionElements() {
  if (!state.svgRoot) return [];
  return Array.from(state.svgRoot.querySelectorAll('path[id^="reg"]'));
}

function buildRegions() {
  const elements = getRegionElements();

  state.regions = elements.map((el) => ({
    id: el.id,
    element: el,
  }));

  if (!state.regions.length) {
    throw new Error('В SVG не найдено ни одного региона вида path[id^="reg"].');
  }
}

function getProvinceById(id) {
  return state.data.provinces.find((item) => item.id === id) ?? null;
}

function getKingdomById(id) {
  return state.data.kingdoms.find((item) => item.id === id) ?? null;
}

function getSettlementById(id) {
  return state.data.settlements.find((item) => item.id === id) ?? null;
}

function getProvinceElement(id) {
  return state.svgRoot.getElementById(id) || state.svgRoot.querySelector(`#${id}`);
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

function shouldShowStateLabels() {
  return state.zoom.current <= 1.6;
}

function shouldShowSettlementLabel(type) {
  const zoom = state.zoom.current;

  if (type === "capital") return zoom >= 1.4;
  if (type === "city") return zoom >= 1.8;
  if (type === "fort") return zoom >= 2.0;
  if (type === "village") return zoom >= 2.6;

  return zoom >= 2.0;
}

function getProvinceBounds(provinceId) {
  const el = getProvinceElement(provinceId);
  if (!el) return null;

  const box = el.getBBox();
  return {
    id: provinceId,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    cx: box.x + box.width / 2,
    cy: box.y + box.height / 2,
  };
}

function areBoundsTouching(a, b, gap = 8) {
  return !(
    a.x + a.width < b.x - gap ||
    b.x + b.width < a.x - gap ||
    a.y + a.height < b.y - gap ||
    b.y + b.height < a.y - gap
  );
}

function buildProvinceClusters(provinceIds) {
  const boundsList = provinceIds.map(getProvinceBounds).filter(Boolean);

  const visited = new Set();
  const clusters = [];

  for (const item of boundsList) {
    if (visited.has(item.id)) continue;

    const queue = [item];
    const cluster = [];
    visited.add(item.id);

    while (queue.length) {
      const current = queue.shift();
      cluster.push(current);

      for (const candidate of boundsList) {
        if (visited.has(candidate.id)) continue;
        if (areBoundsTouching(current, candidate)) {
          visited.add(candidate.id);
          queue.push(candidate);
        }
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

function getClusterBounds(cluster) {
  const minX = Math.min(...cluster.map((item) => item.x));
  const minY = Math.min(...cluster.map((item) => item.y));
  const maxX = Math.max(...cluster.map((item) => item.x + item.width));
  const maxY = Math.max(...cluster.map((item) => item.y + item.height));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    cx: minX + (maxX - minX) / 2,
    cy: minY + (maxY - minY) / 2,
  };
}

function shouldRenderStateLabelForBounds(bounds) {
  return bounds.width >= 70 && bounds.height >= 28;
}

function getStateLabelPlacement(cluster) {
  const bounds = getClusterBounds(cluster);
  if (!shouldRenderStateLabelForBounds(bounds)) return null;

  const paddingX = 10;
  const paddingY = 8;

  const usableWidth = Math.max(10, bounds.width - paddingX * 2);
  const usableHeight = Math.max(10, bounds.height - paddingY * 2);

  const rawFontSize = Math.min(usableWidth / 9.5, usableHeight / 1.9);
  const fontSize = Math.max(6, Math.min(rawFontSize, 22));

  return {
    bounds,
    x: bounds.cx,
    y: bounds.cy,
    fontSize,
  };
}

function getKingdomLabelPlacements(kingdomId) {
  const provinceIds = state.data.provinces
    .filter((p) => p.kingdomId === kingdomId)
    .map((p) => p.id);

  const clusters = buildProvinceClusters(provinceIds);

  return clusters
    .map((cluster) => {
      const placement = getStateLabelPlacement(cluster);
      if (!placement) return null;

      const bounds = getClusterBounds(cluster);
      const area = bounds.width * bounds.height;

      return {
        ...placement,
        provinceIds: cluster.map((item) => item.id),
        clusterSize: cluster.length,
        clusterArea: area,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.clusterSize !== a.clusterSize) {
        return b.clusterSize - a.clusterSize;
      }
      return b.clusterArea - a.clusterArea;
    });
}

function applyRegionStyles() {
  state.regions.forEach((region) => {
    const el = region.element;
    const province = getProvinceById(region.id);
    const kingdom = province ? getKingdomById(province.kingdomId) : null;

    const baseColor = kingdom?.color ?? "#666666";
    const isSelected = state.selectedRegionId === region.id;
    const isHovered = state.hoveredRegionId === region.id;

    el.style.pointerEvents = "all";
    el.style.cursor = state.tool === "add-settlement" || state.tool === "measure" ? "crosshair" : "pointer";
    el.style.transition =
      "filter 0.12s ease, opacity 0.12s ease, stroke 0.12s ease, stroke-width 0.12s ease";
    el.style.vectorEffect = "non-scaling-stroke";
    el.style.strokeLinejoin = "round";
    el.style.strokeLinecap = "round";

    el.style.fill = baseColor;
    el.style.fillOpacity = isSelected ? "0.72" : isHovered ? "0.58" : "0.45";
    el.style.stroke = isSelected ? "#fff3d2" : "rgba(0,0,0,0.35)";
    el.style.strokeWidth = isSelected ? "2.5px" : "1px";
    el.style.filter = isSelected ? "brightness(1.12)" : isHovered ? "brightness(1.06)" : "";
  });
}

function settlementRadius(type) {
  switch (type) {
    case "capital":
      return 4;
    case "city":
      return 2.5;
    case "village":
      return 1;
    case "fort":
      return 3;
    default:
      return 4;
  }
}

function settlementFill(type) {
  switch (type) {
    case "capital":
      return "#f3d27a";
    case "city":
      return "#e8e8e8";
    case "village":
      return "#d8c9a2";
    case "fort":
      return "#b9c7d6";
    default:
      return "#ffffff";
  }
}

function settlementLabelSize(type) {
  switch (type) {
    case "capital":
      return 4;
    case "city":
      return 3;
    case "village":
      return 2;
    case "fort":
      return 3;
    default:
      return 12;
  }
}

function settlementLabelOffset(type) {
  switch (type) {
    case "capital":
      return 8;
    case "city":
      return 5;
    case "village":
      return 3;
    case "fort":
      return 5;
    default:
      return 14;
  }
}

function renderSettlements() {
  const layer = ensureOverlayLayer("settlements-overlay");

  state.data.settlements.forEach((settlement) => {
    const isSelected = state.selectedSettlementId === settlement.id;

    const group = document.createElementNS(SVG_NS, "g");
    group.dataset.entityType = "settlement";
    group.dataset.entityId = settlement.id;
    group.style.cursor = state.tool === "add-settlement" || state.tool === "measure" ? "default" : "pointer";

    const commonStroke = isSelected ? "#fff3d2" : "#2b2b2b";
    const commonStrokeWidth = isSelected ? "2" : "1";

    if (settlement.type === "fort") {
      const size = settlementRadius(settlement.type) * 2;
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("x", String(settlement.x - size / 2));
      rect.setAttribute("y", String(settlement.y - size / 2));
      rect.setAttribute("width", String(size));
      rect.setAttribute("height", String(size));
      rect.setAttribute("fill", settlementFill(settlement.type));
      rect.setAttribute("stroke", commonStroke);
      rect.setAttribute("stroke-width", commonStrokeWidth);
      group.appendChild(rect);
    } else {
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("cx", String(settlement.x));
      circle.setAttribute("cy", String(settlement.y));
      circle.setAttribute("r", String(settlementRadius(settlement.type)));
      circle.setAttribute("fill", settlementFill(settlement.type));
      circle.setAttribute("stroke", commonStroke);
      circle.setAttribute("stroke-width", commonStrokeWidth);
      group.appendChild(circle);
    }

    if (shouldShowSettlementLabel(settlement.type)) {
      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("x", String(settlement.x));
      label.setAttribute("y", String(settlement.y - settlementLabelOffset(settlement.type)));
      label.setAttribute("font-size", String(settlementLabelSize(settlement.type)));
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("dominant-baseline", "middle");
      label.setAttribute("fill", "#f3f1ea");
      label.setAttribute("paint-order", "stroke");
      label.setAttribute("stroke", "rgba(0,0,0,0.65)");
      label.setAttribute("stroke-width", "2");
      label.style.userSelect = "none";
      label.style.pointerEvents = "none";
      label.textContent = settlement.name;
      group.appendChild(label);
    }

    group.addEventListener("pointerdown", (event) => {
      beginSettlementPointerDown(settlement.id, event);
    });

    layer.appendChild(group);
  });
}

function renderStateLabels() {
  const layer = ensureOverlayLayer("state-labels-overlay");

  if (!shouldShowStateLabels()) return;

  state.data.kingdoms.forEach((kingdom) => {
    const placements = getKingdomLabelPlacements(kingdom.id);
    const override = STATE_LABEL_OVERRIDES[kingdom.id] ?? {};

    placements.forEach((placement, index) => {
      const isEnclave = index > 0;
      const scale = isEnclave ? (override.enclaveScale ?? 0.5) : (override.scale ?? 1.0);

      const fontSize = Math.max(5, Math.round(placement.fontSize * scale));
      const dx = override.dx ?? 0;
      const dy = override.dy ?? 0;

      const text = document.createElementNS(SVG_NS, "text");
      text.setAttribute("x", String(Math.round(placement.x + dx)));
      text.setAttribute("y", String(Math.round(placement.y + dy)));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "middle");
      text.setAttribute("font-size", String(fontSize));
      text.setAttribute("font-weight", "700");
      text.setAttribute("letter-spacing", fontSize >= 16 ? "0.8" : "0.2");
      text.setAttribute("fill", "rgba(243, 241, 234, 0.92)");
      text.setAttribute("paint-order", "stroke");
      text.setAttribute("stroke", "rgba(0,0,0,0.55)");
      text.setAttribute("stroke-width", fontSize >= 16 ? "2.5" : "1.5");
      text.style.pointerEvents = "none";
      text.style.userSelect = "none";
      text.textContent = override.text ?? kingdom.name;

      layer.appendChild(text);
    });
  });
}

function distanceBetweenPoints(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function renderMeasurement() {
  const layer = ensureOverlayLayer("measurement-overlay");

  if (!state.measurement.start) return;

  const start = state.measurement.start;
  const end = state.measurement.end ?? state.measurement.start;

  const line = document.createElementNS(SVG_NS, "line");
  line.setAttribute("x1", String(start.x));
  line.setAttribute("y1", String(start.y));
  line.setAttribute("x2", String(end.x));
  line.setAttribute("y2", String(end.y));
  line.setAttribute("stroke", "#fff3d2");
  line.setAttribute("stroke-width", "2");
  line.setAttribute("stroke-dasharray", "6 4");
  line.setAttribute("vector-effect", "non-scaling-stroke");
  layer.appendChild(line);

  const startCircle = document.createElementNS(SVG_NS, "circle");
  startCircle.setAttribute("cx", String(start.x));
  startCircle.setAttribute("cy", String(start.y));
  startCircle.setAttribute("r", "3");
  startCircle.setAttribute("fill", "#fff3d2");
  layer.appendChild(startCircle);

  const endCircle = document.createElementNS(SVG_NS, "circle");
  endCircle.setAttribute("cx", String(end.x));
  endCircle.setAttribute("cy", String(end.y));
  endCircle.setAttribute("r", "3");
  endCircle.setAttribute("fill", "#fff3d2");
  layer.appendChild(endCircle);

  if (state.measurement.end) {
    const distance = distanceBetweenPoints(start, end);
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;

    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("x", String(midX));
    label.setAttribute("y", String(midY - 8));
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dominant-baseline", "middle");
    label.setAttribute("font-size", "12");
    label.setAttribute("fill", "#f3f1ea");
    label.setAttribute("paint-order", "stroke");
    label.setAttribute("stroke", "rgba(0,0,0,0.7)");
    label.setAttribute("stroke-width", "2");
    label.style.pointerEvents = "none";
    label.style.userSelect = "none";
    label.textContent = formatDistance(distance);
    layer.appendChild(label);
  }
}

function renderSelectionPanel() {
  if (!refs.selectionPanel) return;

  if (state.selectedSettlementId) {
    const settlement = getSettlementById(state.selectedSettlementId);
    const province = settlement ? getProvinceById(settlement.provinceId) : null;
    const kingdom = province ? getKingdomById(province.kingdomId) : null;

    if (!settlement) {
      refs.selectionPanel.innerHTML = "<p>Поселение не найдено.</p>";
      return;
    }

    refs.selectionPanel.innerHTML = `
      <h3 class="selection-title">${settlement.name}</h3>
      <div class="badges">
        <span class="badge">Поселение</span>
        <span class="badge">${settlement.type}</span>
      </div>

      <div class="stack compact-form">
        <label>Название
          <input id="settlement-name-input" type="text" value="${escapeHtml(settlement.name)}" />
        </label>

        <label>Тип
          <select id="settlement-type-select">
            <option value="capital" ${settlement.type === "capital" ? "selected" : ""}>Столица</option>
            <option value="city" ${settlement.type === "city" ? "selected" : ""}>Город</option>
            <option value="village" ${settlement.type === "village" ? "selected" : ""}>Поселение</option>
            <option value="fort" ${settlement.type === "fort" ? "selected" : ""}>Крепость</option>
          </select>
        </label>

        <label>Провинция
          <select id="settlement-province-select">
            ${state.data.provinces
              .map(
                (item) =>
                  `<option value="${item.id}" ${item.id === settlement.provinceId ? "selected" : ""}>${escapeHtml(item.name)}</option>`,
              )
              .join("")}
          </select>
        </label>

        <label>Видимость
          <select id="settlement-visibility-select">
            <option value="player" ${settlement.visibility === "player" ? "selected" : ""}>Видно игрокам</option>
            <option value="master" ${settlement.visibility === "master" ? "selected" : ""}>Только мастеру</option>
          </select>
        </label>

        <label>X
          <input id="settlement-x-input" type="number" value="${settlement.x}" />
        </label>

        <label>Y
          <input id="settlement-y-input" type="number" value="${settlement.y}" />
        </label>
      </div>

      <p><strong>Государство:</strong> ${kingdom?.name ?? "—"}</p>
      <p><strong>Император:</strong> ${kingdom?.ruler ?? "—"}</p>

      <div class="selection-actions">
        <button id="save-settlement-button" type="button">Сохранить</button>
        <button id="delete-settlement-button" class="danger-button" type="button">Удалить</button>
      </div>
    `;

    document
      .getElementById("save-settlement-button")
      ?.addEventListener("click", () => saveSettlementChanges(settlement.id));

    document
      .getElementById("delete-settlement-button")
      ?.addEventListener("click", () => deleteSettlement(settlement.id));

    return;
  }

  if (!state.selectedRegionId) {
    refs.selectionPanel.innerHTML = `
      <p>Ничего не выбрано.</p>
      <p class="small">Кликни по региону или поселению.</p>
    `;
    return;
  }

  const region = state.regions.find((item) => item.id === state.selectedRegionId);
  const province = getProvinceById(state.selectedRegionId);
  const kingdom = province ? getKingdomById(province.kingdomId) : null;

  if (!region || !province) {
    refs.selectionPanel.innerHTML = "<p>Выбранный регион не найден.</p>";
    return;
  }

  refs.selectionPanel.innerHTML = `
    <h3 class="selection-title">${province.name || region.id}</h3>
    <div class="badges">
      <span class="badge">Регион</span>
      <span class="badge">${kingdom?.name ?? "Без государства"}</span>
    </div>
    <p><strong>ID:</strong> ${region.id}</p>
    <p><strong>Государство:</strong> ${kingdom?.name ?? "—"}</p>
    <p><strong>Император:</strong> ${kingdom?.ruler ?? "—"}</p>
    <p>${province.description || "Без описания."}</p>
  `;
}

function saveSettlementChanges(settlementId) {
  const settlement = getSettlementById(settlementId);
  if (!settlement) return;

  settlement.name =
    document.getElementById("settlement-name-input")?.value.trim() || settlement.name;
  settlement.type =
    document.getElementById("settlement-type-select")?.value || settlement.type;
  settlement.provinceId =
    document.getElementById("settlement-province-select")?.value || settlement.provinceId;
  settlement.visibility =
    document.getElementById("settlement-visibility-select")?.value || settlement.visibility;

  const nextX = Number(document.getElementById("settlement-x-input")?.value);
  const nextY = Number(document.getElementById("settlement-y-input")?.value);

  if (!Number.isNaN(nextX)) settlement.x = Math.round(nextX);
  if (!Number.isNaN(nextY)) settlement.y = Math.round(nextY);

  renderAll();
}

function deleteSettlement(settlementId) {
  const settlement = getSettlementById(settlementId);
  if (!settlement) return;

  const shouldDelete = window.confirm(`Удалить поселение "${settlement.name}"?`);
  if (!shouldDelete) return;

  state.data.settlements = state.data.settlements.filter((item) => item.id !== settlementId);
  state.selectedSettlementId = null;
  renderAll();
}

function selectRegion(regionId) {
  state.selectedRegionId = regionId;
  state.selectedSettlementId = null;
  renderAll();
}

function selectSettlement(settlementId) {
  state.selectedSettlementId = settlementId;
  state.selectedRegionId = null;
  renderAll();
}

function clearSelection() {
  state.selectedRegionId = null;
  state.selectedSettlementId = null;
  renderAll();
}

function createSettlementAt(x, y) {
  const provinceId = getProvinceIdByCoordinates(x, y);
  const nextIndex = state.data.settlements.length + 1;

  const settlement = {
    id: `settlement${nextIndex}`,
    name: `Новое поселение ${nextIndex}`,
    type: "city",
    x: Math.round(x),
    y: Math.round(y),
    provinceId,
    visibility: "player",
  };

  state.data.settlements.push(settlement);
  state.selectedSettlementId = settlement.id;
  state.selectedRegionId = null;
  state.tool = null;

  resetSettlementInteraction();
  renderAll();
}

function beginSettlementPointerDown(settlementId, event) {
  if (state.tool === "add-settlement" || state.tool === "measure") return;

  state.interaction.settlementPointerDown = {
    settlementId,
    pointerId: event.pointerId ?? null,
    startClientX: event.clientX,
    startClientY: event.clientY,
  };
  state.interaction.pointerId = event.pointerId ?? null;
  state.interaction.movedDuringDrag = false;

  state.pan.active = false;
  state.pan.pointerId = null;
  refs.mapContainer.classList.remove("is-panning-map");

  event.preventDefault();
  event.stopPropagation();
}

function maybeStartSettlementDrag(event) {
  const down = state.interaction.settlementPointerDown;
  if (!down) return false;
  if (state.tool === "add-settlement" || state.tool === "measure") return false;
  if (down.pointerId !== null && event.pointerId !== down.pointerId) return false;

  const dx = event.clientX - down.startClientX;
  const dy = event.clientY - down.startClientY;
  const distance = Math.hypot(dx, dy);

  if (distance < 4) return false;

  state.interaction.isDraggingSettlement = true;
  state.interaction.draggedSettlementId = down.settlementId;
  state.interaction.movedDuringDrag = true;
  return true;
}

function handleSettlementDrag(event) {
  if (!state.interaction.isDraggingSettlement) {
    maybeStartSettlementDrag(event);
  }

  if (!state.interaction.isDraggingSettlement) return;
  if (state.tool === "add-settlement" || state.tool === "measure") return;
  if (state.interaction.pointerId !== null && event.pointerId !== state.interaction.pointerId) {
    return;
  }

  const settlement = getSettlementById(state.interaction.draggedSettlementId);
  if (!settlement) return;

  const point = toSvgPoint(event);
  settlement.x = Math.round(point.x);
  settlement.y = Math.round(point.y);

  const provinceId = getProvinceIdByCoordinates(settlement.x, settlement.y);
  if (provinceId) {
    settlement.provinceId = provinceId;
  }

  if (state.selectedSettlementId === settlement.id) {
    renderAll();
  } else {
    renderSettlements();
  }
}

function handleGlobalPointerUp(event) {
  const down = state.interaction.settlementPointerDown;

  if (
    down &&
    !state.interaction.isDraggingSettlement &&
    (down.pointerId === null || down.pointerId === event.pointerId)
  ) {
    selectSettlement(down.settlementId);
  }

  resetSettlementInteraction();
  endPan(event);
}

function resetSettlementInteraction() {
  state.interaction.settlementPointerDown = null;
  state.interaction.isDraggingSettlement = false;
  state.interaction.draggedSettlementId = null;
  state.interaction.pointerId = null;

  requestAnimationFrame(() => {
    state.interaction.movedDuringDrag = false;
  });
}



function handleMeasurePoint(point) {
  if (!state.measurement.start || state.measurement.end) {
    state.measurement.start = point;
    state.measurement.end = null;
  } else {
    state.measurement.end = point;
  }
  renderAll();
}

function bindRegionEvents() {
  state.regions.forEach((region) => {
    const el = region.element;

    el.addEventListener("mouseenter", () => {
      state.hoveredRegionId = region.id;
      applyRegionStyles();
    });

    el.addEventListener("mouseleave", () => {
      state.hoveredRegionId = null;
      applyRegionStyles();
    });

    el.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.interaction.movedDuringDrag || state.pan.moved) return;

      if (state.tool === "add-settlement") {
        const point = toSvgPoint(event);
        createSettlementAt(point.x, point.y);
        return;
      }

      if (state.tool === "measure") {
        const point = toSvgPoint(event);
        handleMeasurePoint(point);
        return;
      }

      selectRegion(region.id);
    });
  });

  refs.mapContainer.addEventListener("click", (event) => {
    if (state.interaction.movedDuringDrag || state.pan.moved) return;

    if ((state.tool === "add-settlement" || state.tool === "measure") && event.target === state.svgRoot) {
      const point = toSvgPoint(event);

      if (state.tool === "add-settlement") {
        createSettlementAt(point.x, point.y);
      } else {
        handleMeasurePoint(point);
      }
      return;
    }

    if (event.target === state.svgRoot || event.target === refs.mapContainer) {
      clearSelection();
    }
  });
}

function toSvgPoint(event) {
  const point = state.svgRoot.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const transformed = point.matrixTransform(state.svgRoot.getScreenCTM().inverse());
  return { x: transformed.x, y: transformed.y };
}





function applyZoom(focusPoint = null) {
  if (!state.svgRoot || !state.zoom.baseViewBox) return;

  const base = state.zoom.baseViewBox;
  const prevMinX = base.currentMinX;
  const prevMinY = base.currentMinY;
  const prevWidth = base.currentWidth;
  const prevHeight = base.currentHeight;

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

  state.svgRoot.setAttribute("viewBox", `${nextMinX} ${nextMinY} ${nextWidth} ${nextHeight}`);

  if (refs.zoomValue) {
    refs.zoomValue.textContent = `${Math.round(zoom * 100)}%`;
  }

  renderSettlements();
  renderStateLabels();
  renderMeasurement();
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
  const base = state.zoom.baseViewBox;
  base.currentMinX = base.minX;
  base.currentMinY = base.minY;
  base.currentWidth = base.width;
  base.currentHeight = base.height;
  setZoom(1);
}

function beginPan(event) {
  if (state.interaction.settlementPointerDown) return;
  if (!(event.target instanceof SVGElement)) return;

  const clickedSettlement = event.target.closest?.('[data-entity-type="settlement"]');
  if (clickedSettlement) return;
  if (state.tool === "measure") return;

  state.pan.active = true;
  state.pan.pointerId = event.pointerId ?? null;
  state.pan.startClientX = event.clientX;
  state.pan.startClientY = event.clientY;
  state.pan.startMinX = state.zoom.baseViewBox.currentMinX;
  state.pan.startMinY = state.zoom.baseViewBox.currentMinY;
  state.pan.moved = false;

  refs.mapContainer.classList.add("is-panning-map");
  event.target.setPointerCapture?.(event.pointerId);
}

function handlePanMove(event) {
  if (!state.pan.active) return;
  if (state.pan.pointerId !== null && event.pointerId !== state.pan.pointerId) return;

  const dx = event.clientX - state.pan.startClientX;
  const dy = event.clientY - state.pan.startClientY;

  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
    state.pan.moved = true;
  }

  const base = state.zoom.baseViewBox;
  const svgRect = state.svgRoot.getBoundingClientRect();

  const scaleX = base.currentWidth / svgRect.width;
  const scaleY = base.currentHeight / svgRect.height;

  let nextMinX = state.pan.startMinX - dx * scaleX;
  let nextMinY = state.pan.startMinY - dy * scaleY;

  const maxMinX = base.minX + base.width - base.currentWidth;
  const maxMinY = base.minY + base.height - base.currentHeight;

  nextMinX = Math.min(Math.max(nextMinX, base.minX), maxMinX);
  nextMinY = Math.min(Math.max(nextMinY, base.minY), maxMinY);

  base.currentMinX = nextMinX;
  base.currentMinY = nextMinY;

  state.svgRoot.setAttribute(
    "viewBox",
    `${base.currentMinX} ${base.currentMinY} ${base.currentWidth} ${base.currentHeight}`
  );
}

function endPan(event = null) {
  if (!state.pan.active) return;
  if (event && state.pan.pointerId !== null && event.pointerId !== state.pan.pointerId) return;

  state.pan.active = false;
  state.pan.pointerId = null;
  refs.mapContainer.classList.remove("is-panning-map");

  requestAnimationFrame(() => {
    state.pan.moved = false;
  });
}

function bindViewportEvents() {
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
    { passive: false }
  );

  refs.mapContainer.addEventListener("pointerdown", beginPan);
  refs.mapContainer.addEventListener("pointermove", handlePanMove);
  refs.mapContainer.addEventListener("pointermove", handleSettlementDrag);

  window.addEventListener("pointerup", handleGlobalPointerUp);
  window.addEventListener("pointercancel", handleGlobalPointerUp);

  refs.zoomInButton?.addEventListener("click", () => zoomIn());
  refs.zoomOutButton?.addEventListener("click", () => zoomOut());
  refs.zoomResetButton?.addEventListener("click", resetZoom);

  refs.addSettlementButton?.addEventListener("click", () => {
    state.tool = state.tool === "add-settlement" ? null : "add-settlement";
    renderAll();
  });

  refs.measureToolButton?.addEventListener("click", () => {
    state.tool = state.tool === "measure" ? null : "measure";
    state.measurement.start = null;
    state.measurement.end = null;
    renderAll();
  });

  refs.exportSettlementsButton?.addEventListener("click", exportSettlements);
}

function exportSettlements() {
  const payload = JSON.stringify(state.data.settlements, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "settlements.json";
  link.click();
  URL.revokeObjectURL(url);
}

function renderAll() {
  applyRegionStyles();
  renderSettlements();
  renderStateLabels();
  renderMeasurement();
  renderSelectionPanel();

  if (state.tool === "add-settlement") {
    setHint("Режим добавления поселения: кликни по карте.");
  } else if (state.tool === "measure") {
    setHint("Линейка: выбери две точки на карте.");
  } else {
    setHint("Можно выбирать, редактировать и перетаскивать поселения.");
  }

  refs.addSettlementButton?.classList.toggle("active-tool", state.tool === "add-settlement");
  refs.measureToolButton?.classList.toggle("active-tool", state.tool === "measure");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function init() {
  try {
    if (!refs.mapContainer) {
      throw new Error("Не найден элемент #map-container");
    }

    const [kingdoms, provinces, settlements] = await Promise.all([
      loadJson("./data/kingdoms.json"),
      loadJson("./data/provinces.json"),
      loadJson("./data/settlements.json"),
    ]);

    state.data.kingdoms = kingdoms;
    state.data.provinces = provinces;
    state.data.settlements = settlements;

    await loadSvg();
    buildRegions();
    bindRegionEvents();
    bindViewportEvents();
    renderAll();
  } catch (error) {
    console.error(error);
    if (refs.mapContainer) {
      refs.mapContainer.innerHTML = `
        <div style="padding:20px;color:#ffb5b5;">
          Ошибка запуска: ${error.message}
        </div>
      `;
    }
  }
}

init();