<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', color: string): void
}>()

// ---- HSV ↔ Hex helpers ----
function hexToHsv(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + 6) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  const s = max === 0 ? 0 : d / max
  return [h, s, max]
}

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x }
  else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x }
  else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c }
  else { r = c; b = x }
  const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

// ---- State ----
const [initH, initS, initV] = hexToHsv(props.modelValue || '#3b82f6')
const hue = ref(initH)
const sat = ref(initS)
const val = ref(initV)
const hexInput = ref(props.modelValue || '#3b82f6')
const activeTab = ref<'matrix' | 'picker'>('matrix')

const currentHex = computed(() => hsvToHex(hue.value, sat.value, val.value))

watch(currentHex, (hex) => {
  hexInput.value = hex
  emit('update:modelValue', hex)
})

watch(() => props.modelValue, (newVal) => {
  if (newVal && newVal !== currentHex.value) {
    const [h, s, v] = hexToHsv(newVal)
    hue.value = h
    sat.value = s
    val.value = v
    hexInput.value = newVal
  }
})

function applyHex() {
  const cleaned = hexInput.value.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(cleaned)) {
    const [h, s, v] = hexToHsv(cleaned)
    hue.value = h
    sat.value = s
    val.value = v
  }
}

// ---- Color Matrix (GoodNotes style) ----
const BASE_HUES = [0, 25, 45, 60, 120, 170, 200, 230, 265, 300, 330]

function matrixColors(baseH: number): string[] {
  const variations: [number, number][] = [
    [0.15, 0.98], [0.35, 0.95], [0.55, 0.92],
    [0.75, 0.88], [0.92, 0.82], [1.0, 0.70],
    [0.90, 0.55], [0.75, 0.42], [0.55, 0.30],
  ]
  return variations.map(([s, v]) => hsvToHex(baseH, s, v))
}

const grayscaleRow = computed(() => {
  const steps = [1.0, 0.92, 0.82, 0.70, 0.55, 0.42, 0.30, 0.18, 0.0]
  return steps.map(v => hsvToHex(0, 0, v))
})

function selectMatrixColor(hex: string) {
  const [h, s, v] = hexToHsv(hex)
  hue.value = h
  sat.value = s
  val.value = v
}

// ---- SV Picker (Photoshop-style) ----
const svCanvas = ref<HTMLCanvasElement | null>(null)
const hueSlider = ref<HTMLCanvasElement | null>(null)
let draggingSV = false
let draggingHue = false

function drawSV() {
  const canvas = svCanvas.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')!
  const w = canvas.width, h = canvas.height

  // Background: pure hue
  const hueColor = hsvToHex(hue.value, 1, 1)
  ctx.fillStyle = hueColor
  ctx.fillRect(0, 0, w, h)

  // White → transparent horizontal gradient
  const whiteGrad = ctx.createLinearGradient(0, 0, w, 0)
  whiteGrad.addColorStop(0, 'rgba(255,255,255,1)')
  whiteGrad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = whiteGrad
  ctx.fillRect(0, 0, w, h)

  // Transparent → black vertical gradient
  const blackGrad = ctx.createLinearGradient(0, 0, 0, h)
  blackGrad.addColorStop(0, 'rgba(0,0,0,0)')
  blackGrad.addColorStop(1, 'rgba(0,0,0,1)')
  ctx.fillStyle = blackGrad
  ctx.fillRect(0, 0, w, h)
}

function drawHueBar() {
  const canvas = hueSlider.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')!
  const h = canvas.height
  const grad = ctx.createLinearGradient(0, 0, 0, h)
  for (let i = 0; i <= 6; i++) {
    grad.addColorStop(i / 6, hsvToHex(i * 60, 1, 1))
  }
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, canvas.width, h)
}

watch(hue, () => { drawSV() })

watch(activeTab, async (newTab) => {
  if (newTab === 'picker') {
    await nextTick()
    drawSV()
    drawHueBar()
  }
})

function handleSVPointer(e: PointerEvent) {
  const canvas = svCanvas.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
  sat.value = x
  val.value = 1 - y
}

function handleHuePointer(e: PointerEvent) {
  const canvas = hueSlider.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
  hue.value = y * 360
}

function onSVDown(e: PointerEvent) {
  draggingSV = true
  handleSVPointer(e)
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
}
function onSVMove(e: PointerEvent) { if (draggingSV) handleSVPointer(e) }
function onSVUp() { draggingSV = false }

function onHueDown(e: PointerEvent) {
  draggingHue = true
  handleHuePointer(e)
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
}
function onHueMove(e: PointerEvent) { if (draggingHue) handleHuePointer(e) }
function onHueUp() { draggingHue = false }

const svThumbStyle = computed(() => ({
  left: `${sat.value * 100}%`,
  top: `${(1 - val.value) * 100}%`,
}))

const hueThumbTop = computed(() => `${(hue.value / 360) * 100}%`)

// ---- Eyedropper ----
const eyedropperSupported = ref(false)

async function pickFromScreen() {
  try {
    const eyeDropper = new (window as any).EyeDropper()
    const result = await eyeDropper.open()
    if (result?.sRGBHex) {
      const [h, s, v] = hexToHsv(result.sRGBHex)
      hue.value = h
      sat.value = s
      val.value = v
    }
  } catch {
    // User cancelled or API error
  }
}

onMounted(() => {
  eyedropperSupported.value = 'EyeDropper' in window
  drawSV()
  drawHueBar()
})
</script>

<template>
  <div class="tcp">
    <!-- Tab switcher -->
    <div class="tcp-tabs">
      <button
        class="tcp-tab"
        :class="{ 'tcp-tab--active': activeTab === 'matrix' }"
        @click="activeTab = 'matrix'"
      >色板</button>
      <button
        class="tcp-tab"
        :class="{ 'tcp-tab--active': activeTab === 'picker' }"
        @click="activeTab = 'picker'"
      >调色盘</button>
    </div>

    <!-- Matrix view (GoodNotes-style) -->
    <div v-if="activeTab === 'matrix'" class="tcp-matrix">
      <!-- Grayscale row -->
      <div class="tcp-matrix__row">
        <button
          v-for="(c, i) in grayscaleRow"
          :key="'g' + i"
          class="tcp-swatch"
          :class="{ 'tcp-swatch--active': currentHex.toLowerCase() === c.toLowerCase() }"
          :style="{ background: c }"
          @click="selectMatrixColor(c)"
        />
      </div>
      <!-- Hue rows -->
      <div
        v-for="(baseH, ri) in BASE_HUES"
        :key="'r' + ri"
        class="tcp-matrix__row"
      >
        <button
          v-for="(c, ci) in matrixColors(baseH)"
          :key="ci"
          class="tcp-swatch"
          :class="{ 'tcp-swatch--active': currentHex.toLowerCase() === c.toLowerCase() }"
          :style="{ background: c }"
          @click="selectMatrixColor(c)"
        />
      </div>
    </div>

    <!-- HSB Picker view (Photoshop-style) -->
    <div v-if="activeTab === 'picker'" class="tcp-hsb">
      <div class="tcp-hsb__body">
        <!-- SV square -->
        <div class="tcp-sv-wrap">
          <canvas
            ref="svCanvas"
            width="280"
            height="180"
            class="tcp-sv-canvas"
            @pointerdown="onSVDown"
            @pointermove="onSVMove"
            @pointerup="onSVUp"
          />
          <div class="tcp-sv-thumb" :style="svThumbStyle" />
        </div>
        <!-- Hue bar -->
        <div class="tcp-hue-wrap">
          <canvas
            ref="hueSlider"
            width="18"
            height="180"
            class="tcp-hue-canvas"
            @pointerdown="onHueDown"
            @pointermove="onHueMove"
            @pointerup="onHueUp"
          />
          <div class="tcp-hue-thumb" :style="{ top: hueThumbTop }" />
        </div>
      </div>
    </div>

    <!-- Footer: preview + hex + eyedropper -->
    <div class="tcp-footer">
      <div class="tcp-preview" :style="{ background: currentHex }" />
      <div class="tcp-hex-group">
        <span class="tcp-hex-label">HEX</span>
        <input
          v-model="hexInput"
          class="tcp-hex-input"
          maxlength="7"
          @keydown.enter="applyHex"
          @blur="applyHex"
        />
      </div>
      <button
        v-if="eyedropperSupported"
        class="tcp-eyedropper"
        title="屏幕取色器"
        @click="pickFromScreen"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2 22l1-1h3l9-9" />
          <path d="M3 21v-3l9-9" />
          <path d="M14.5 5.5l4 4" />
          <path d="M18.5 1.5a2.121 2.121 0 013 3l-1 1-4-4 1-1z" />
          <path d="M12 8l4 4" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.tcp {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--c-bg-primary);
  border: var(--border-width) solid var(--c-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  font-family: var(--font-sans);
  width: 100%;
  user-select: none;
}

/* ---- Tabs ---- */
.tcp-tabs {
  display: flex;
  gap: var(--space-1);
  background: var(--c-bg-secondary);
  border-radius: var(--radius-md);
  padding: 2px;
}

.tcp-tab {
  flex: 1;
  padding: var(--space-1-5) var(--space-2);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  color: var(--c-text-muted);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-default);
}
.tcp-tab:hover { color: var(--c-text-primary); }
.tcp-tab--active {
  background: var(--c-bg-primary);
  color: var(--c-text-primary);
  box-shadow: var(--shadow-xs);
}

/* ---- Matrix (GoodNotes-style grid) ---- */
.tcp-matrix {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.tcp-matrix__row {
  display: flex;
  gap: 3px;
}

.tcp-swatch {
  flex: 1;
  height: 24px;
  border-radius: var(--radius-sm);
  border: 1.5px solid transparent;
  cursor: pointer;
  transition: transform var(--duration-fast), border-color var(--duration-fast), box-shadow var(--duration-fast);
}
.tcp-swatch:hover {
  transform: scale(1.12);
  z-index: 1;
  box-shadow: 0 2px 8px rgba(0,0,0,0.18);
}
.tcp-swatch--active {
  border-color: var(--c-text-primary);
  box-shadow: 0 0 0 2px var(--c-bg-primary), 0 0 0 3.5px var(--c-text-primary);
  transform: scale(1.08);
  z-index: 2;
}

/* ---- HSB picker ---- */
.tcp-hsb__body {
  display: flex;
  gap: var(--space-3);
  align-items: stretch;
}

.tcp-sv-wrap {
  position: relative;
  flex: 1;
  border-radius: var(--radius-md);
  overflow: hidden;
  cursor: crosshair;
}
.tcp-sv-canvas {
  display: block;
  width: 100%;
  height: 180px;
  border-radius: var(--radius-md);
}

.tcp-sv-thumb {
  position: absolute;
  width: 14px;
  height: 14px;
  border: 2px solid #fff;
  border-radius: var(--radius-full);
  box-shadow: 0 0 0 1px rgba(0,0,0,0.25), 0 2px 6px rgba(0,0,0,0.3);
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.tcp-hue-wrap {
  position: relative;
  width: 18px;
  flex-shrink: 0;
  border-radius: var(--radius-md);
  overflow: hidden;
  cursor: pointer;
}
.tcp-hue-canvas {
  display: block;
  width: 100%;
  height: 180px;
  border-radius: var(--radius-md);
}
.tcp-hue-thumb {
  position: absolute;
  left: -2px;
  right: -2px;
  height: 6px;
  border: 2px solid #fff;
  border-radius: var(--radius-full);
  box-shadow: 0 0 0 1px rgba(0,0,0,0.2), 0 1px 4px rgba(0,0,0,0.3);
  transform: translateY(-50%);
  pointer-events: none;
}

/* ---- Footer ---- */
.tcp-footer {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding-top: var(--space-2);
  border-top: var(--border-width) solid var(--c-border-light);
}

.tcp-preview {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  border: var(--border-width) solid var(--c-border);
  box-shadow: var(--shadow-xs);
  flex-shrink: 0;
}

.tcp-hex-group {
  display: flex;
  align-items: center;
  flex: 1;
  gap: var(--space-1);
  background: var(--c-bg-input);
  border: var(--border-width) solid var(--c-border-input);
  border-radius: var(--radius-md);
  padding: 0 var(--space-2);
  height: 32px;
  transition: border-color var(--duration-fast);
}
.tcp-hex-group:focus-within {
  border-color: var(--c-border-focus);
  box-shadow: var(--ring-focus);
}

.tcp-hex-label {
  font-size: 9px;
  font-weight: var(--font-semibold);
  color: var(--c-text-muted);
  letter-spacing: 0.06em;
  flex-shrink: 0;
}

.tcp-hex-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: var(--text-sm);
  font-family: var(--font-mono);
  color: var(--c-text-primary);
  min-width: 0;
}

.tcp-eyedropper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  border: var(--border-width) solid var(--c-border);
  background: var(--c-bg-primary);
  color: var(--c-text-muted);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-default);
  flex-shrink: 0;
}
.tcp-eyedropper:hover {
  border-color: var(--c-border-focus);
  color: var(--c-accent);
  box-shadow: var(--ring-focus);
}
</style>
