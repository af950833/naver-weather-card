class NaverWeatherCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("naver-weather-card-editor");
  }

  static getStubConfig(hass) {
    const entities = Object.keys(hass?.states || {}).filter((entityId) => entityId.startsWith("weather."));
    const entity = entities.find((entityId) => entityId.includes("naver_weather")) || entities[0] || "";
    const state = hass?.states?.[entity];
    const name = state?.attributes?.friendly_name || "";
    return {
      entity,
      name,
      forecast_days: 5,
    };
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error("entity is required");
    }
    this.config = {
      forecast_days: 5,
      show_air_quality: true,
      show_details: true,
      ...config,
    };
    this._root = this.attachShadow({ mode: "open" });
    this._root.addEventListener("click", this._handleClick);
  }

  set hass(hass) {
    this._hass = hass;
    if (!this.config) return;
    this.render();
  }

  getCardSize() {
    return this.config?.show_air_quality === false ? 3 : 5;
  }

  get _base() {
    return this.config.entity.replace(/^weather\./, "");
  }

  entity(id) {
    return this._hass?.states?.[id];
  }

  sensor(suffix) {
    return this.entity(this.sensorId(suffix));
  }

  sensorId(suffix) {
    return `sensor.${this._base}_${suffix}`;
  }

  state(suffix, fallback = "-") {
    const entity = this.sensor(suffix);
    const value = entity?.state;
    return value && value !== "unknown" && value !== "unavailable" ? value : fallback;
  }

  attr(suffix, name, fallback = undefined) {
    const entity = this.sensor(suffix);
    const value = entity?.attributes?.[name];
    return value ?? fallback;
  }

  render() {
    const weather = this.entity(this.config.entity);
    if (!weather) {
      this._root.innerHTML = this.styles + `<ha-card><div class="error">${this.config.entity} not found</div></ha-card>`;
      return;
    }

    const condition = weather.state || this.attr("weekly_forecast_1", "condition_pm", "sunny");
    const conditionText = this.state("current_condition", this.localizeCondition(condition));
    const summary = this.state("current_summary", "");
    const temp = this.readNumber(this.state("temperature", weather.attributes?.temperature));
    const feelsLike = this.readNumber(this.state("feels_like_temperature", ""));
    const high = this.readNumber(this.state("today_high_temperature", weather.attributes?.temperature));
    const low = this.readNumber(this.state("today_low_temperature", ""));
    const lastUpdate = this.formatUpdateTime(this.state("last_success", ""));
    const location = this.config.name || weather.attributes?.friendly_name || this.state("location", "");
    const forecast = this.forecastItems();
    const detailItems = this.detailItems();
    const airItems = this.airItems();

    this._root.innerHTML = `
      ${this.styles}
      <ha-card>
        <button class="card" type="button" title="${this.escape(location)}" data-entity="${this.escape(this.config.entity)}">
          ${lastUpdate ? `<div class="updated corner">${this.escape(lastUpdate)}</div>` : ""}
          <section class="top">
            <div class="current-icon ${this.conditionClass(condition)}">
              <ha-icon icon="${this.conditionIcon(condition)}"></ha-icon>
            </div>
            <div class="headline">
              <div class="condition">${this.escape(conditionText)}</div>
              <div class="place">${this.escape(location)}</div>
              ${summary ? `<div class="summary">${this.escape(summary)}</div>` : ""}
            </div>
            <div class="temperature">
              <div class="temp-line" data-entity="${this.escape(this.sensorId("temperature"))}">
                <span class="temp">${this.displayTemp(temp)}</span><span class="unit">°C</span>
              </div>
              <div class="feels" data-entity="${this.escape(this.sensorId("feels_like_temperature"))}">
                체감 ${this.displayTemp(feelsLike)}°C
              </div>
              <div class="range">
                <span data-entity="${this.escape(this.sensorId("today_high_temperature"))}">${this.displayTemp(high)}°C</span>
                <span>/</span>
                <span data-entity="${this.escape(this.sensorId("today_low_temperature"))}">${this.displayTemp(low)}°C</span>
              </div>
            </div>
          </section>

          <section class="forecast">
            ${forecast.map((item) => this.renderForecast(item)).join("")}
          </section>

          ${this.config.show_details === false ? "" : `
            <section class="details">
              ${detailItems.map((item, index) => this.renderMetric(item, index)).join("")}
            </section>
          `}

          ${this.config.show_air_quality === false ? "" : `
            <section class="air">
              ${airItems.map((item, index) => this.renderMetric(item, index)).join("")}
            </section>
          `}
        </button>
      </ha-card>
    `;
  }

  forecastItems() {
    const days = Math.max(1, Math.min(Number(this.config.forecast_days || 5), 7));
    return Array.from({ length: days }, (_, index) => {
      const suffix = `weekly_forecast_${index + 1}`;
      const date = this.attr(suffix, "date");
      const label = this.dayLabel(date, index);
      const conditionAm = this.attr(suffix, "condition_am");
      const conditionPm = this.attr(suffix, "condition_pm");
      const condition = this.forecastCondition(conditionAm, conditionPm);
      const high = this.attr(suffix, "temperature_high", this.attr(suffix, "max_temperature", ""));
      const low = this.attr(suffix, "temperature_low", this.attr(suffix, "min_temperature", ""));
      const text = this.attr(suffix, "condition_text_pm") || this.attr(suffix, "condition_text_am") || this.entity(this.sensorId(suffix))?.state || "";
      return { label, condition, high, low, text, entityId: this.sensorId(suffix) };
    });
  }

  forecastCondition(conditionAm, conditionPm) {
    const conditions = [conditionAm, conditionPm].filter(Boolean);
    if (!conditions.length) return "sunny";
    return conditions.sort((a, b) => this.conditionPriority(b) - this.conditionPriority(a))[0];
  }

  conditionPriority(condition) {
    const key = String(condition || "").toLowerCase().replaceAll("_", "-");
    if (key.includes("lightning") || key.includes("storm")) return 90;
    if (key.includes("snow")) return 80;
    if (key.includes("rain") || key.includes("pouring")) return 70;
    if (key.includes("fog") || key.includes("hazy")) return 60;
    if (key.includes("cloud") || key.includes("partly")) return 50;
    if (key.includes("wind")) return 40;
    return 10;
  }

  detailItems() {
    return [
      { label: "습도", value: this.state("humidity"), unit: "%", icon: "mdi:water-percent", entityId: this.sensorId("humidity") },
      { label: "강수확률", value: this.state("rain_probability"), unit: "%", icon: "mdi:weather-pouring", entityId: this.sensorId("rain_probability") },
      { label: "강수량", value: this.state("rainfall"), unit: "mm", icon: "mdi:weather-rainy", entityId: this.sensorId("rainfall") },
      { label: "풍속", value: this.state("wind_speed"), unit: "m/s", icon: "mdi:weather-windy", entityId: this.sensorId("wind_speed") },
      { label: "풍향", value: this.state("wind_bearing"), unit: "", icon: "mdi:windsock", entityId: this.sensorId("wind_bearing") },
      { label: "자외선", value: this.state("uv_grade"), unit: "", icon: "mdi:white-balance-sunny", entityId: this.sensorId("uv_grade") },
    ];
  }

  airItems() {
    return [
      {
        label: "미세먼지",
        value: this.state("fine_dust"),
        unit: "",
        icon: "mdi:blur",
        grade: this.state("fine_dust_grade", ""),
        entityId: this.sensorId("fine_dust"),
      },
      {
        label: "초미세먼지",
        value: this.state("ultra_fine_dust"),
        unit: "",
        icon: "mdi:blur-linear",
        grade: this.state("ultra_fine_dust_grade", ""),
        entityId: this.sensorId("ultra_fine_dust"),
      },
      { label: "오존", value: this.state("ozone_grade"), icon: "mdi:alpha-o-circle", entityId: this.sensorId("ozone_grade") },
      { label: "일산화탄소", value: this.state("carbon_monoxide_grade"), icon: "mdi:molecule-co", entityId: this.sensorId("carbon_monoxide_grade") },
      { label: "아황산가스", value: this.state("sulfur_dioxide_grade"), icon: "mdi:alpha-s-circle", entityId: this.sensorId("sulfur_dioxide_grade") },
      { label: "이산화질소", value: this.state("nitrogen_dioxide_grade"), icon: "mdi:alpha-n-circle", entityId: this.sensorId("nitrogen_dioxide_grade") },
      { label: "통합대기", value: this.state("comprehensive_air_quality_grade"), icon: "mdi:air-filter", entityId: this.sensorId("comprehensive_air_quality_grade") },
      { label: "일출/일몰", value: this.sunTimeValue(), icon: "mdi:weather-sunset", entityId: this.sensorId("sun_times") },
    ];
  }

  sunTimeValue() {
    const value = this.state("sun_times");
    const match = String(value || "").match(/\d{1,2}:\d{2}/);
    return match ? match[0] : value;
  }

  renderForecast(item) {
    return `
      <div class="day" title="${this.escape(item.text)}" data-entity="${this.escape(item.entityId)}">
        <div class="day-label">${this.escape(item.label)}</div>
        <ha-icon class="day-icon ${this.conditionClass(item.condition)}" icon="${this.conditionIcon(item.condition)}"></ha-icon>
        <div class="day-high">${this.displayTemp(item.high)}°</div>
        <div class="day-low">${this.displayTemp(item.low)}°</div>
      </div>
    `;
  }

  renderMetric(item, index = 0) {
    const value = `${this.escape(item.value)}${item.unit ? `<span>${this.escape(item.unit)}</span>` : ""}${item.grade ? ` <span class="metric-grade">${this.escape(item.grade)}</span>` : ""}`;
    const tone = this.metricTone(item);
    const side = index % 2 === 0 ? "left" : "right";
    return `
      <div class="metric metric-${side} tone-${tone} quality-${this.gradeKey(item.grade || item.value)}" data-entity="${this.escape(item.entityId)}">
        <ha-icon icon="${item.icon}"></ha-icon>
        <span class="metric-label">${this.escape(item.label)}</span>
        <span class="metric-value">${value}</span>
      </div>
    `;
  }

  metricTone(item) {
    const icon = String(item?.icon || "").toLowerCase();
    if (icon.includes("water-percent")) return "humidity";
    if (icon.includes("pouring") || icon.includes("rainy")) return "rain";
    if (icon.includes("windy") || icon.includes("windsock")) return "wind";
    if (icon.includes("sunset")) return "sun";
    if (icon.includes("white-balance-sunny")) return "sun";
    return "default";
  }

  _handleClick = (event) => {
    const target = event.target?.closest?.("[data-entity]");
    const entityId = target?.dataset?.entity;
    if (!entityId) return;
    event.preventDefault();
    event.stopPropagation();
    this.dispatchEvent(new CustomEvent("hass-more-info", {
      detail: { entityId },
      bubbles: true,
      composed: true,
    }));
  };

  dayLabel(dateText, index) {
    const date = dateText ? new Date(dateText) : new Date(Date.now() + index * 86400000);
    if (Number.isNaN(date.getTime())) return ["오늘", "내일"][index] || `${index + 1}일`;
    return new Intl.DateTimeFormat("ko-KR", { weekday: "short" }).format(date);
  }

  conditionIcon(condition) {
    const key = String(condition || "").toLowerCase().replaceAll("_", "-");
    if (key.includes("lightning") || key.includes("storm")) return "mdi:weather-lightning";
    if (key.includes("snow")) return "mdi:weather-snowy";
    if (key.includes("rain") || key.includes("pouring")) return "mdi:weather-rainy";
    if (key.includes("fog") || key.includes("hazy")) return "mdi:weather-fog";
    if (key.includes("partly")) return "mdi:weather-partly-cloudy";
    if (key.includes("clear-night")) return "mdi:weather-night";
    if (key.includes("cloud")) return "mdi:weather-cloudy";
    if (key.includes("wind")) return "mdi:weather-windy";
    return "mdi:white-balance-sunny";
  }

  conditionClass(condition) {
    const key = String(condition || "").toLowerCase();
    if (key.includes("rain") || key.includes("pouring")) return "rainy";
    if (key.includes("snow")) return "snowy";
    if (key.includes("cloud") || key.includes("partly")) return "cloudy";
    return "sunny";
  }

  localizeCondition(condition) {
    const map = {
      sunny: "맑음",
      clear: "맑음",
      cloudy: "흐림",
      partlycloudy: "구름많음",
      "partly-cloudy": "구름많음",
      rainy: "비",
      pouring: "비",
      snowy: "눈",
      fog: "안개",
      windy: "바람",
    };
    return map[String(condition || "").toLowerCase()] || condition || "-";
  }

  gradeKey(value) {
    if (!value) return "none";
    const text = String(value);
    if (text.includes("좋음")) return "good";
    if (text.includes("보통")) return "normal";
    if (text.includes("나쁨")) return "bad";
    if (text.includes("매우")) return "very-bad";
    return "none";
  }

  readNumber(value) {
    if (value === undefined || value === null || value === "-") return "";
    const number = Number(String(value).replace(/[^\d.-]/g, ""));
    return Number.isFinite(number) ? number : value;
  }

  displayTemp(value) {
    if (value === undefined || value === null || value === "") return "-";
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(number % 1 ? 1 : 0) : this.escape(value);
  }

  formatUpdateTime(value) {
    if (!value || value === "-") return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return `업데이트 ${value}`;
    return `업데이트 ${new Intl.DateTimeFormat("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date)}`;
  }

  escape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  get styles() {
    return `
      <style>
        :host {
          display: block;
        }

        ha-card {
          overflow: hidden;
          border-radius: var(--ha-card-border-radius, 12px);
        }

        .card {
          position: relative;
          display: block;
          width: 100%;
          padding: 26px 22px 18px;
          border: 0;
          background: var(--ha-card-background, var(--card-background-color, #fff));
          color: var(--primary-text-color);
          font: inherit;
          text-align: left;
          cursor: default;
        }

        .top {
          display: grid;
          grid-template-columns: 62px minmax(0, 1fr) auto;
          align-items: center;
          gap: 16px;
        }

        .current-icon {
          --mdc-icon-size: 52px;
          width: 58px;
          height: 58px;
          display: grid;
          place-items: center;
          border-radius: 50%;
        }

        .current-icon ha-icon {
          --mdc-icon-size: 52px;
        }

        .sunny,
        .day-icon.sunny {
          color: #ffd33d;
        }

        .cloudy,
        .day-icon.cloudy {
          color: #aeb8c2;
        }

        .rainy,
        .day-icon.rainy {
          color: #56a5f5;
        }

        .snowy,
        .day-icon.snowy {
          color: #8bc7ff;
        }

        .condition {
          font-size: 24px;
          font-weight: 600;
          line-height: 1.15;
        }

        .place,
        .summary {
          margin-top: 2px;
          color: var(--secondary-text-color);
          font-size: 13px;
          line-height: 1.3;
        }

        .temperature {
          text-align: right;
          white-space: nowrap;
        }

        .temp-line,
        .feels,
        .range span[data-entity] {
          cursor: pointer;
        }

        .temp {
          font-size: 32px;
          line-height: 1;
          font-weight: 500;
        }

        .unit {
          margin-left: 3px;
          font-size: 18px;
          vertical-align: top;
        }

        .range {
          margin-top: 4px;
          color: var(--secondary-text-color);
          font-size: 14px;
        }

        .feels {
          margin-top: 4px;
          color: var(--secondary-text-color);
          font-size: 13px;
          line-height: 1.2;
        }

        .updated {
          position: absolute;
          top: 8px;
          left: 12px;
          color: var(--secondary-text-color);
          font-size: 11px;
          line-height: 1.2;
        }

        .forecast {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 8px;
          margin-top: 24px;
        }

        .day {
          min-width: 0;
          display: grid;
          justify-items: center;
          gap: 5px;
          cursor: pointer;
          transition: opacity 120ms ease;
        }

        .day:active {
          opacity: 0.72;
        }

        .day-label {
          color: var(--secondary-text-color);
          font-size: 12px;
          font-weight: 700;
        }

        .day-icon {
          --mdc-icon-size: 34px;
          height: 38px;
        }

        .day-high {
          font-size: 14px;
          font-weight: 600;
        }

        .day-low {
          color: var(--secondary-text-color);
          font-size: 13px;
        }

        .details,
        .air {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          column-gap: 24px;
          row-gap: 6px;
        }

        .details {
          margin-top: 16px;
          padding-top: 14px;
          border-top: 1px solid var(--divider-color);
        }

        .air {
          margin-top: 6px;
        }

        .metric {
          min-width: 0;
          display: grid;
          grid-template-columns: 22px minmax(0, 1fr) auto;
          align-items: center;
          gap: 6px;
          padding: 1px 0;
          cursor: pointer;
          line-height: 1.25;
          transition: opacity 120ms ease;
        }

        .metric:active {
          opacity: 0.72;
        }

        .metric ha-icon {
          --mdc-icon-size: 18px;
          color: var(--secondary-text-color);
        }

        .tone-humidity ha-icon {
          color: #4dabf7;
        }

        .tone-rain ha-icon {
          color: #5c7cfa;
        }

        .tone-wind ha-icon {
          color: #5c940d;
        }

        .tone-sun ha-icon {
          color: #f59f00;
        }

        .metric-label {
          overflow: hidden;
          color: var(--primary-text-color);
          font-size: 13px;
          line-height: 1.2;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .metric-value {
          overflow: hidden;
          font-size: 13px;
          font-weight: 600;
          line-height: 1.2;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .metric-value span {
          margin-left: 2px;
          color: var(--secondary-text-color);
          font-size: 11px;
          font-weight: 400;
        }

        .metric-value .metric-grade {
          margin-left: 4px;
          color: inherit;
          font-size: inherit;
          font-weight: inherit;
        }

        .quality-good ha-icon {
          color: #228be6;
        }

        .quality-normal ha-icon {
          color: #2f9e44;
        }

        .quality-bad ha-icon {
          color: #f59f00;
        }

        .quality-very-bad ha-icon {
          color: #e03131;
        }

        .error {
          padding: 16px;
          color: var(--error-color);
        }

        @media (max-width: 520px) {
          .card {
            padding: 24px 16px 16px;
          }

          .top {
            grid-template-columns: 50px minmax(0, 1fr) auto;
            gap: 12px;
          }

          .current-icon,
          .current-icon ha-icon {
            --mdc-icon-size: 44px;
          }

          .condition {
            font-size: 20px;
          }

          .temp {
            font-size: 28px;
          }

          .forecast {
            gap: 4px;
          }

          .details,
          .air {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            column-gap: 18px;
            row-gap: 6px;
          }

          .details .metric,
          .air .metric {
            grid-template-columns: 18px minmax(0, 1fr) auto;
            gap: 5px;
          }

        }
      </style>
    `;
  }
}

class NaverWeatherCardEditor extends HTMLElement {
  setConfig(config) {
    this.config = {
      forecast_days: 5,
      show_air_quality: true,
      show_details: true,
      ...config,
    };
    this.render();
  }

  set hass(hass) {
    this._hass = hass;
    this.render();
  }

  render() {
    if (!this.config) return;
    const weatherEntities = Object.keys(this._hass?.states || {})
      .filter((entityId) => entityId.startsWith("weather."))
      .sort();
    const entityOptions = weatherEntities
      .map((entityId) => {
        const selected = entityId === this.config.entity ? " selected" : "";
        const name = this._hass?.states?.[entityId]?.attributes?.friendly_name;
        const label = name ? `${entityId} (${name})` : entityId;
        return `<option value="${this.escape(entityId)}"${selected}>${this.escape(label)}</option>`;
      })
      .join("");

    this.innerHTML = `
      <style>
        .editor {
          display: grid;
          gap: 16px;
          padding: 8px 0;
        }

        .toggles {
          display: grid;
          gap: 10px;
        }

        ha-entity-picker,
        ha-textfield {
          display: block;
          width: 100%;
        }

        ha-entity-picker {
          min-height: 56px;
        }

        .native-select {
          display: grid;
          gap: 6px;
        }

        .native-select span {
          color: var(--secondary-text-color);
          font-size: 12px;
        }

        select {
          box-sizing: border-box;
          width: 100%;
          height: 42px;
          padding: 0 12px;
          border: 1px solid var(--divider-color);
          border-radius: 6px;
          background: var(--card-background-color);
          color: var(--primary-text-color);
          font: inherit;
        }
      </style>
      <div class="editor">
        <ha-entity-picker
          id="entity"
          label="날씨 엔티티"
          config-value="entity"
          domain-filter="weather"
          allow-custom-entity
        ></ha-entity-picker>

        <label class="native-select">
          <span>기본 날씨 엔티티</span>
          <select id="entity_select" config-value="entity">
            ${entityOptions || `<option value="">weather 엔티티 없음</option>`}
          </select>
        </label>

        <ha-textfield
          id="name"
          label="이름"
          config-value="name"
        ></ha-textfield>

        <ha-textfield
          id="forecast_days"
          label="예보 일수"
          type="number"
          min="1"
          max="7"
          config-value="forecast_days"
        ></ha-textfield>

        <div class="toggles">
          <ha-formfield label="상세 날씨 정보 표시">
            <ha-switch
              id="show_details"
              config-value="show_details"
            ></ha-switch>
          </ha-formfield>

          <ha-formfield label="대기질 정보 표시">
            <ha-switch
              id="show_air_quality"
              config-value="show_air_quality"
            ></ha-switch>
          </ha-formfield>
        </div>
      </div>
    `;

    const entity = this.querySelector("#entity");
    if (entity) {
      entity.hass = this._hass;
      entity.value = this.config.entity || "";
      entity.includeDomains = ["weather"];
      entity.domainFilter = "weather";
      entity.setAttribute("domain-filter", "weather");
      entity.allowCustomEntity = true;
    }

    const entitySelect = this.querySelector("#entity_select");
    if (entitySelect) entitySelect.value = this.config.entity || "";

    const name = this.querySelector("#name");
    if (name) name.value = this.config.name || "";

    const forecastDays = this.querySelector("#forecast_days");
    if (forecastDays) forecastDays.value = this.config.forecast_days ?? 5;

    const showDetails = this.querySelector("#show_details");
    if (showDetails) showDetails.checked = this.config.show_details !== false;

    const showAirQuality = this.querySelector("#show_air_quality");
    if (showAirQuality) showAirQuality.checked = this.config.show_air_quality !== false;

    this.querySelectorAll("[config-value]").forEach((element) => {
      element.addEventListener("value-changed", this._valueChanged);
      element.addEventListener("change", this._valueChanged);
      element.addEventListener("click", this._valueChanged);
    });
  }

  _valueChanged = (event) => {
    const target = event.currentTarget;
    const key = target.getAttribute("config-value");
    let value;
    const oldEntity = this.config.entity;

    if (target.tagName.toLowerCase() === "ha-switch") {
      value = target.checked;
    } else {
      value = event.detail?.value ?? target.value;
    }

    if (key === "forecast_days") {
      value = Math.max(1, Math.min(Number(value || 5), 7));
    }

    const config = { ...this.config, [key]: value };
    if (key === "entity" && value !== oldEntity) {
      const oldName = this._hass?.states?.[oldEntity]?.attributes?.friendly_name || "";
      const newName = this._hass?.states?.[value]?.attributes?.friendly_name || "";
      if (!config.name || config.name === oldName) {
        config.name = newName;
      }
    }
    this.config = config;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config },
        bubbles: true,
        composed: true,
      }),
    );
  };

  escape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
}

if (!customElements.get("naver-weather-card")) {
  customElements.define("naver-weather-card", NaverWeatherCard);
}

if (!customElements.get("naver-weather-card-editor")) {
  customElements.define("naver-weather-card-editor", NaverWeatherCardEditor);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "naver-weather-card")) {
  window.customCards.push({
    type: "naver-weather-card",
    name: "Naver Weather Card",
    description: "Weather card for the naver_weather custom integration.",
  });
}
