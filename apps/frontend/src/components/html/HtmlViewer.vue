<script setup lang="ts">
/**
 * HTML 重排阅读器 — 渲染从 arXiv/ar5iv/PMC 抓取的论文 HTML。
 *
 * 渲染策略：
 * - 保留原始 HTML 的 ltx_* class，由 arxiv-compat.css 提供排版
 * - DOMPurify 安全过滤
 * - KaTeX 渲染 MathML <annotation> 中的 LaTeX 源码
 * - 清理 LaTeX 残留命令（\cellcolor 等）
 * - 双语模式：block → PdfParagraph 映射 → 翻译缓存
 */

import { ref, watch, nextTick, computed, onMounted } from 'vue'
import DOMPurify from 'dompurify'
import 'katex/dist/katex.min.css'
import '../../styles/arxiv-compat.css'
import { useHtmlReflowStore } from '../../stores/html-reflow'
import { useTranslationStore } from '../../stores/translation'
import { usePdfStore } from '../../stores/pdf'

const htmlReflowStore = useHtmlReflowStore()
const translationStore = useTranslationStore()
const pdfStore = usePdfStore()
const contentRef = ref<HTMLElement | null>(null)
const fontSize = ref(16)

// ==================== 渲染 ====================

const renderedHtml = computed(() => {
  const raw = htmlReflowStore.htmlContent
  if (!raw) return ''

  return DOMPurify.sanitize(raw, {
    ADD_TAGS: [
      'math', 'semantics', 'annotation',
      'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac',
      'mover', 'munder', 'mtable', 'mtr', 'mtd', 'mtext',
      'mspace', 'msqrt', 'mroot', 'mstyle', 'mpadded',
      'mphantom', 'menclose', 'msubsup', 'munderover',
    ],
    ADD_ATTR: [
      'class', 'style', 'id',
      'data-block-id', 'data-paragraph-id',
      'loading', 'xmlns', 'display', 'encoding',
      'mathvariant', 'stretchy', 'fence', 'separator',
      'accent', 'displaystyle', 'scriptlevel', 'columnalign',
    ],
  })
})

// ==================== DOM 后处理 ====================

/**
 * 将 LaTeX 残留命令渲染为实际 HTML 样式，而非简单删除。
 *
 * - \rowcolor / \cellcolor → 背景色应用到父 <tr> / <td>
 * - \textbf / \textit / \textsc 等 → 对应 HTML 样式标签
 * - \multicolumn / \multirow / \makecell → 保留内容文本
 * - 纯布局命令（\hline, \midrule 等）→ 删除（HTML 表格用 CSS 边框）
 */
function renderLatexArtifacts(container: HTMLElement) {
  // ── 1. 解析 LaTeX 颜色为 CSS 颜色 ──
  function latexColorToCSS(color: string): string {
    color = color.trim()
    // gray!15 → 15% gray = rgba(0,0,0,0.15)，LaTeX 中 gray!15 表示 15% 的灰色混合白色
    const grayMatch = color.match(/^gray!(\d+)$/)
    if (grayMatch) {
      // LaTeX: gray!N = N% gray + (100-N)% white → 灰度 = 255 * (1 - N/100)
      const pct = parseInt(grayMatch[1]!)
      const val = Math.round(255 * (1 - pct / 100))
      return `rgb(${val},${val},${val})`
    }
    // 常见 LaTeX 颜色名
    const colorMap: Record<string, string> = {
      red: '#e74c3c', blue: '#3498db', green: '#27ae60', yellow: '#f1c40f',
      orange: '#e67e22', purple: '#9b59b6', cyan: '#1abc9c', pink: '#e91e63',
      white: '#ffffff', black: '#000000', gray: '#808080', lightgray: '#d3d3d3',
    }
    if (colorMap[color]) return colorMap[color]!
    // {blue!20} → 20% blue
    const namedMatch = color.match(/^(\w+)!(\d+)$/)
    if (namedMatch && colorMap[namedMatch[1]!]) {
      return colorMap[namedMatch[1]!]! + Math.round(parseInt(namedMatch[2]!) * 2.55).toString(16).padStart(2, '0')
    }
    return ''
  }

  // ── 2. 遍历文本节点，应用颜色 + 格式 ──
  // 注意：必须跳过 MathML 内部节点，这些由 renderMath 处理
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const toProcess: Text[] = []
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    // 跳过 MathML 内部（math/annotation/semantics）—— 由 renderMath 处理
    if (node.parentElement?.closest('math, annotation, semantics')) continue
    if (node.textContent && (/\\(cellcolor|rowcolor|textbf|textit|textsc|textrm|textsf|texttt|emph|bfseries|itshape|hline|cline|midrule|toprule|bottomrule|noalign|vskip|smallskip|medskip|bigskip|centering|raggedright|raggedleft|renewcommand|setlength|rule)\b/.test(node.textContent) || /gray!\d+/.test(node.textContent))) {
      toProcess.push(node)
    }
  }

  for (const node of toProcess) {
    let text = node.textContent || ''
    const parent = node.parentElement

    // ── \rowcolor{...} → 背景色应用到最近的 <tr> ──
    text = text.replace(/\\rowcolor\{([^}]*)\}/g, (_m, color) => {
      const css = latexColorToCSS(color)
      if (css) {
        const tr = parent?.closest('tr')
        if (tr) (tr as HTMLElement).style.backgroundColor = css
      }
      return ''
    })

    // ── \cellcolor{...} → 背景色应用到最近的 <td>/<th> ──
    text = text.replace(/\\cellcolor\{([^}]*)\}/g, (_m, color) => {
      const css = latexColorToCSS(color)
      if (css) {
        const td = parent?.closest('td, th')
        if (td) (td as HTMLElement).style.backgroundColor = css
      }
      return ''
    })

    // ── 无参数的 \rowcolor / \cellcolor 残留 ──
    text = text.replace(/\\(cellcolor|rowcolor)\s*/g, '')
    // ── 游离的 gray!N 残留 ──
    text = text.replace(/gray!\d+/g, '')

    // ── 纯布局命令：直接删除 ──
    text = text.replace(/\\(hline|cline\{[^}]*\}|midrule|toprule|bottomrule)/g, '')
    text = text.replace(/\\(noalign|vskip|smallskip|medskip|bigskip)\{?[^}\s]*\}?\s*/g, '')
    text = text.replace(/\\(centering|raggedright|raggedleft)\b\s*/g, '')
    text = text.replace(/\\(renewcommand|setlength)\{[^}]*\}\{[^}]*\}/g, '')
    text = text.replace(/\\rule\{[^}]*\}\{[^}]*\}/g, '')

    node.textContent = text.trim()
  }

  // ── 3. 将 \textbf{} 等格式命令替换为 HTML 标签 ──
  const formatMap: Record<string, { tag: string; style?: string }> = {
    textbf: { tag: 'strong' },
    textit: { tag: 'em' },
    emph: { tag: 'em' },
    textsc: { tag: 'span', style: 'font-variant:small-caps' },
    textrm: { tag: 'span', style: 'font-family:serif' },
    textsf: { tag: 'span', style: 'font-family:sans-serif' },
    texttt: { tag: 'code' },
  }
  // 遍历所有格式命令，替换为 HTML
  for (const [cmd, { tag, style }] of Object.entries(formatMap)) {
    const regex = new RegExp(`\\\\${cmd}\\{([^}]*)\\}`, 'g')
    const walker2 = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    const textNodes: Text[] = []
    while (walker2.nextNode()) {
      const n = walker2.currentNode as Text
      if (n.parentElement?.closest('math, annotation, semantics')) continue
      if (n.textContent && regex.test(n.textContent)) {
        regex.lastIndex = 0
        textNodes.push(n)
      }
    }
    for (const n of textNodes) {
      const frag = document.createDocumentFragment()
      let remaining = n.textContent || ''
      regex.lastIndex = 0
      let match: RegExpExecArray | null
      let lastIdx = 0
      while ((match = regex.exec(remaining)) !== null) {
        if (match.index > lastIdx) {
          frag.appendChild(document.createTextNode(remaining.slice(lastIdx, match.index)))
        }
        const el = document.createElement(tag)
        if (style) el.setAttribute('style', style)
        el.textContent = match[1] ?? ''
        frag.appendChild(el)
        lastIdx = match.index + match[0].length
      }
      if (lastIdx < remaining.length) {
        frag.appendChild(document.createTextNode(remaining.slice(lastIdx)))
      }
      n.parentNode?.replaceChild(frag, n)
    }
  }

  // ── 4. 声明式样式命令（\bfseries 等，影响后续文本） ──
  const declStyles: Record<string, { tag: string; style?: string }> = {
    bfseries: { tag: 'strong' },
    itshape: { tag: 'em' },
  }
  for (const [cmd, { tag, style }] of Object.entries(declStyles)) {
    const walker3 = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    while (walker3.nextNode()) {
      const n = walker3.currentNode as Text
      if (n.parentElement?.closest('math, annotation, semantics')) continue
      const text = n.textContent || ''
      const idx = text.indexOf(`\\${cmd}`)
      if (idx === -1) continue
      const before = text.slice(0, idx)
      const after = text.slice(idx + cmd.length + 1).trimStart()
      if (before) n.parentNode?.insertBefore(document.createTextNode(before), n)
      const el = document.createElement(tag)
      if (style) el.setAttribute('style', style)
      el.textContent = after
      n.parentNode?.insertBefore(el, n)
      n.remove()
    }
  }

  // ── 5. 清理只包含非视觉 LaTeX 命令的空 <span> ──
  container.querySelectorAll('span').forEach(span => {
    const text = span.textContent?.trim() || ''
    if (/^\\(hline|midrule|toprule|bottomrule|centering)$/.test(text) || /^gray!\d+$/.test(text) || text === '') {
      if (!span.querySelector('*')) span.remove()
    }
  })
}

/**
 * 检测 MinerU OCR 产生的垃圾 LaTeX：大量重复的空命令（如 \mathbf { }）。
 * 返回 true 表示该公式是垃圾，应跳过渲染。
 */
function isGarbageLatex(latex: string): boolean {
  // 移除所有空白后长度过短则不判断
  const stripped = latex.replace(/\s+/g, '')
  if (stripped.length < 50) return false
  // 统计空 LaTeX 命令（如 \mathbf{}, \boldsymbol{}, \textbf{} 等花括号内无实际内容）
  const emptyCommands = latex.match(/\\[a-zA-Z]+\s*\{\s*\}/g) || []
  // 计算空命令占据的总字符数
  const emptyLen = emptyCommands.reduce((sum, cmd) => sum + cmd.length, 0)
  // 空命令占比超过 60% 即判定为垃圾
  return emptyLen / latex.length > 0.6
}

/** 用 KaTeX 渲染 MathML <annotation> 中的 LaTeX 源码 */
async function renderMath(container: HTMLElement) {
  let katex: typeof import('katex')
  try {
    katex = await import('katex')
  } catch {
    return
  }

  // MathML → KaTeX：提取 <annotation> 中的 LaTeX 重新渲染
  container.querySelectorAll('math').forEach(mathEl => {
    const annotation = mathEl.querySelector('annotation')
    if (!annotation) return
    const latex = annotation.textContent?.trim()
    if (!latex) return
    if (isGarbageLatex(latex)) { mathEl.replaceWith(document.createTextNode('[⚠ 公式解析异常]')); return }

    // 正文/表格内用 inline，独立公式用 display
    const isDisplay = mathEl.getAttribute('display') === 'block'
    try {
      const span = document.createElement('span')
      span.innerHTML = katex.default.renderToString(latex, {
        displayMode: isDisplay,
        throwOnError: false,
      })
      mathEl.replaceWith(span)
    } catch {
      // 保留原始 MathML 作为 fallback
    }
  })

  // $$...$$ 块级公式（markdown_fallback 来源）
  container.querySelectorAll('.formula-block').forEach(el => {
    const text = el.textContent || ''
    const match = text.match(/\$\$([\s\S]+?)\$\$/)
    if (match?.[1]) {
      try {
        el.innerHTML = katex.default.renderToString(match[1], {
          displayMode: true,
          throwOnError: false,
        })
      } catch { /* skip */ }
    }
  })

  // .math-tex 标记的公式（后端 text_with_math_to_html 生成）
  container.querySelectorAll('.math-tex').forEach(el => {
    const raw = el.textContent || ''
    // 提取 $$...$$ 或 $...$
    const displayMatch = raw.match(/^\$\$([\s\S]+)\$\$$/)
    const inlineMatch = displayMatch ? null : raw.match(/^\$(.+)\$$/)
    const latex = displayMatch?.[1] || inlineMatch?.[1]
    if (!latex) return
    if (isGarbageLatex(latex)) { el.textContent = '[⚠ 公式解析异常]'; return }
    const isDisplay = !!displayMatch || el.classList.contains('math-display')
    try {
      el.innerHTML = katex.default.renderToString(latex, {
        displayMode: isDisplay,
        throwOnError: false,
      })
      el.classList.add('katex-rendered')
    } catch { /* 保留原始 $...$ 文本 */ }
  })

  // 纯文本节点中的 $...$ / $$...$$ （外部 HTML 来源，如 arXiv 原始文本）
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      // 跳过已被 KaTeX 渲染的区域和 .math-tex 节点
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      if (parent.closest('.katex, .katex-rendered, .math-tex, math')) return NodeFilter.FILTER_REJECT
      if (/\$/.test(node.textContent || '')) return NodeFilter.FILTER_ACCEPT
      return NodeFilter.FILTER_REJECT
    },
  })

  const textNodes: Text[] = []
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text)

  const mathPattern = /\$\$(.+?)\$\$|\$(.+?)\$/g

  for (const textNode of textNodes) {
    const text = textNode.textContent || ''
    if (!mathPattern.test(text)) continue
    mathPattern.lastIndex = 0

    const frag = document.createDocumentFragment()
    let last = 0
    let match: RegExpExecArray | null

    while ((match = mathPattern.exec(text)) !== null) {
      // 添加公式前的普通文本
      if (match.index > last) {
        frag.appendChild(document.createTextNode(text.slice(last, match.index)))
      }

      const isDisplay = match[1] != null
      const latex = (match[1] || match[2]) ?? ''
      if (isGarbageLatex(latex)) {
        frag.appendChild(document.createTextNode('[⚠ 公式解析异常]'))
      } else {
        try {
          const span = document.createElement('span')
          span.innerHTML = katex.default.renderToString(latex, {
            displayMode: isDisplay,
            throwOnError: false,
          })
          span.classList.add('katex-rendered')
          frag.appendChild(span)
        } catch {
          frag.appendChild(document.createTextNode(match[0]))
        }
      }
      last = match.index + match[0].length
    }

    if (last < text.length) {
      frag.appendChild(document.createTextNode(text.slice(last)))
    }

    if (last > 0) {
      textNode.parentNode?.replaceChild(frag, textNode)
    }
  }
}

/**
 * 对所有表格（含 arXiv ltx_tabular）包裹滚动容器，防止宽表格溢出。
 */
function wrapPlainTables(container: HTMLElement) {
  const isInsideArxivTableShell = (table: HTMLTableElement) =>
    Boolean(table.closest('.ltx_table, .ltx_transformed_outer'))

  // 第一遍：解除 <span> 包裹
  container.querySelectorAll('table').forEach(table => {
    if (isInsideArxivTableShell(table as HTMLTableElement)) return
    if (table.parentElement?.classList.contains('html-viewer__table-wrap')) return
    const parent = table.parentElement
    if (parent?.tagName === 'SPAN') {
      parent.replaceWith(...Array.from(parent.childNodes))
    }
  })

  // 第二遍：包裹滚动容器
  container.querySelectorAll('table').forEach(table => {
    if (isInsideArxivTableShell(table as HTMLTableElement)) return
    if (table.parentElement?.classList.contains('html-viewer__table-wrap')) return
    // 只有 1-2 行且含 math 的是公式表格（行内公式布局），不处理
    const rows = table.querySelectorAll('tr')
    if (rows.length <= 2 && !table.querySelector('th') && table.querySelector('math, .katex')) return

    const wrapper = document.createElement('div')
    wrapper.className = 'html-viewer__table-wrap scrollbar-none'
    table.parentNode!.insertBefore(wrapper, table)
    wrapper.appendChild(table)
  })
}

// ==================== 双语 ====================

/**
 * 将含 $...$ / $$...$$ 的文本设置到元素，公式部分用 KaTeX 渲染。
 * 若文本不含公式，退化为普通 textContent 赋值。
 */
async function setTextWithMath(el: HTMLElement, text: string) {
  const mathPattern = /\$\$(.+?)\$\$|\$(.+?)\$/g
  if (!mathPattern.test(text)) {
    el.textContent = text
    return
  }
  mathPattern.lastIndex = 0

  let katex: typeof import('katex')
  try {
    katex = await import('katex')
  } catch {
    el.textContent = text
    return
  }

  const frag = document.createDocumentFragment()
  let last = 0
  let match: RegExpExecArray | null

  while ((match = mathPattern.exec(text)) !== null) {
    if (match.index > last) {
      frag.appendChild(document.createTextNode(text.slice(last, match.index)))
    }
    const isDisplay = match[1] != null
    const latex = (match[1] || match[2]) ?? ''
    try {
      const span = document.createElement('span')
      span.innerHTML = katex.default.renderToString(latex, {
        displayMode: isDisplay,
        throwOnError: false,
      })
      span.classList.add('katex-rendered')
      frag.appendChild(span)
    } catch {
      frag.appendChild(document.createTextNode(match[0]))
    }
    last = match.index + match[0].length
  }

  if (last < text.length) {
    frag.appendChild(document.createTextNode(text.slice(last)))
  }

  el.textContent = ''
  el.appendChild(frag)
}

function getTranslationForElement(el: Element): string | null {
  // 优先从 DOM 属性直接读 paragraph-id（annotated HTML 注入的）
  const paraId = el.getAttribute('data-paragraph-id')
  if (paraId) {
    return translationStore.translatedParagraphsCache.get(paraId) || null
  }
  // fallback: 通过 mapping store 查找
  const blockId = parseInt(el.getAttribute('data-block-id') || '-1', 10)
  if (blockId < 0) return null
  const mapping = htmlReflowStore.getMappingForBlock(blockId)
  if (!mapping?.paragraphId) return null
  return translationStore.translatedParagraphsCache.get(mapping.paragraphId) || null
}

async function applyBilingualRendering() {
  await nextTick()
  const container = contentRef.value
  if (!container) return

  const mode = htmlReflowStore.bilingualMode

  container.querySelectorAll('.bilingual-translation').forEach(el => el.remove())
  container.querySelectorAll('[data-block-id]').forEach(el => {
    ;(el as HTMLElement).style.display = ''
  })

  if (mode === 'english') return

  const tasks: Promise<void>[] = []

  container.querySelectorAll('[data-block-id]').forEach(el => {
    const translation = getTranslationForElement(el)
    if (!translation) return

    if (mode === 'chinese') {
      ;(el as HTMLElement).style.display = 'none'
      // 保留原始标签类型，维持排版层级（h2 → h2, p → p）
      const tagName = el.tagName.toLowerCase()
      const useTag = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'figcaption'].includes(tagName) ? tagName : 'div'
      const zhEl = document.createElement(useTag)
      zhEl.className = 'bilingual-translation bilingual-block__zh bilingual-block__zh--only'
      // 复制 data-block-id 以便后续定位
      const bid = el.getAttribute('data-block-id')
      if (bid) zhEl.setAttribute('data-block-id-zh', bid)
      tasks.push(setTextWithMath(zhEl, translation))
      el.parentNode?.insertBefore(zhEl, el.nextSibling)
    } else if (mode === 'both') {
      const zhEl = document.createElement('div')
      zhEl.className = 'bilingual-translation bilingual-block__zh bilingual-block__zh--inline'
      tasks.push(setTextWithMath(zhEl, translation))
      el.parentNode?.insertBefore(zhEl, el.nextSibling)
    }
  })

  await Promise.all(tasks)
}

// ==================== 图表描述去重 ====================

/**
 * MinerU 会将图表描述同时提取为段落和 image.caption，
 * 导致 HTML 中 <p data-block-id> 和 <figcaption> 出现相同文本。
 * 此函数将重复 <p> 的 data-block-id / data-paragraph-id 迁移到
 * 对应 <figcaption>，然后删除该 <p>，确保翻译渲染在正确位置。
 */
function deduplicateCaptions(container: HTMLElement) {
  const figcaptions = container.querySelectorAll('figcaption')
  if (!figcaptions.length) return

  // 归一化：去除首尾空白、压缩连续空白
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ')

  // 建立 figcaption 文本索引
  const captionMap = new Map<string, HTMLElement>()
  figcaptions.forEach(fc => {
    const key = norm(fc.textContent || '')
    if (key) captionMap.set(key, fc as HTMLElement)
  })

  // 遍历带 data-block-id 的 <p>，匹配则迁移属性并删除
  container.querySelectorAll('p[data-block-id]').forEach(p => {
    const key = norm(p.textContent || '')
    const fc = captionMap.get(key)
    if (!fc) return

    // 迁移映射属性到 figcaption
    const blockId = p.getAttribute('data-block-id')
    const paraId = p.getAttribute('data-paragraph-id')
    if (blockId) fc.setAttribute('data-block-id', blockId)
    if (paraId) fc.setAttribute('data-paragraph-id', paraId)

    p.remove()
    captionMap.delete(key) // 一对一，防止重复匹配
  })
}

// ==================== 生命周期 ====================

async function postProcess() {
  await nextTick()
  const container = contentRef.value
  if (!container) return

  renderLatexArtifacts(container)
  deduplicateCaptions(container)
  wrapPlainTables(container)
  await renderMath(container)
  await applyBilingualRendering()
}

watch(() => renderedHtml.value, () => postProcess())

watch(() => htmlReflowStore.bilingualMode, () => applyBilingualRendering())

watch(() => translationStore.translatedParagraphsCache.size, () => {
  if (htmlReflowStore.bilingualMode !== 'english') {
    applyBilingualRendering()
  }
})

onMounted(async () => {
  const pdfId = pdfStore.activeReaderId
  if (pdfId && htmlReflowStore.htmlStatus !== 'loaded') {
    await htmlReflowStore.requestHtml(pdfId)
  }
  // 如果内容已加载，直接后处理
  if (htmlReflowStore.htmlStatus === 'loaded') {
    await postProcess()
  }
})

function adjustFontSize(delta: number) {
  fontSize.value = Math.max(12, Math.min(24, fontSize.value + delta))
}

defineExpose({ adjustFontSize })
</script>

<template>
  <div class="html-viewer" :style="{ fontSize: fontSize + 'px' }">
    <div v-if="htmlReflowStore.htmlStatus === 'loading'" class="html-viewer__loading">
      <div class="loading-spinner" />
      <span class="loading-text">Loading HTML...</span>
    </div>

    <div v-else-if="htmlReflowStore.htmlStatus === 'error'" class="html-viewer__error">
      <span>Failed to load HTML content</span>
    </div>

    <div
      v-else-if="htmlReflowStore.htmlStatus === 'loaded'"
      ref="contentRef"
      class="html-viewer__content"
      v-html="renderedHtml"
    />

    <div v-else class="html-viewer__empty">
      <span>No HTML content available</span>
    </div>
  </div>
</template>

<style scoped>
.html-viewer {
  height: 100%;
  width: 100%;
  min-width: 0;
  overflow-y: auto;
  overflow-x: auto;
  padding: 2.5rem 3rem;
  background: var(--c-bg-primary);
  color: var(--c-text-primary);
  scroll-behavior: smooth;
}

.html-viewer__loading,
.html-viewer__error,
.html-viewer__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 0.75rem;
  color: var(--c-text-secondary);
}

.loading-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--c-border);
  border-top-color: var(--c-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-text {
  font-size: 0.875rem;
}
</style>

<style>
/* ================================================================
 *  通用样式 — 适用于所有来源（arXiv / PMC / markdown_fallback）
 *  arXiv 来源的表格/公式由 arxiv-compat.css 处理，
 *  这里只提供基础排版 + 非 ltx_* 元素的样式。
 * ================================================================ */

.html-viewer__content {
  width: 100%;
  min-width: 0;
  max-width: 780px;
  margin: 0 auto;
  line-height: 1.6;
  font-family: var(--font-sans);
  color: var(--c-text-primary);
  -webkit-font-smoothing: antialiased;
  word-break: normal;
  overflow-wrap: anywhere;
}

/* ---------- 标题（非 arXiv 来源 fallback） ---------- */
.html-viewer__content h1:not(.ltx_title),
.html-viewer__content h2:not(.ltx_title),
.html-viewer__content h3:not(.ltx_title),
.html-viewer__content h4:not(.ltx_title) {
  color: var(--c-text-heading);
  line-height: 1.35;
  font-weight: 650;
}

.html-viewer__content h1:not(.ltx_title) {
  font-size: 1.65em;
  text-align: center;
  margin: 0.6em 0 0.3em;
}

.html-viewer__content h2:not(.ltx_title) {
  font-size: 1.3em;
  margin: 2em 0 0.7em;
  padding-bottom: 0.3em;
  border-bottom: 1.5px solid var(--c-border-light, var(--c-border));
}

.html-viewer__content h3:not(.ltx_title) {
  font-size: 1.12em;
  margin: 1.5em 0 0.5em;
}

/* ---------- 段落（非 arXiv fallback） ---------- */
.html-viewer__content p:not(.ltx_p) {
  margin: 0.65em 0;
  text-align: justify;
  hyphens: auto;
}

/* ---------- 链接 ---------- */
.html-viewer__content a {
  color: var(--c-accent);
  text-decoration: none;
}
.html-viewer__content a:hover {
  text-decoration: underline;
}

/* ---------- 引用 ---------- */
.html-viewer__content cite:not(.ltx_cite) {
  font-style: normal;
  color: var(--c-text-secondary);
  font-size: 0.92em;
}

/* ---------- 图片 & figure ---------- */
.html-viewer__content img:not(.ltx_graphics) {
  max-width: 100%;
  height: auto;
  border-radius: var(--radius-md);
  display: block;
  margin: 0.5em auto;
}

.html-viewer__content figure:not(.ltx_figure):not(.ltx_table) {
  margin: 2em 0;
  padding: 1em;
  text-align: center;
  background: var(--c-bg-secondary);
  border-radius: var(--radius-md);
  border: 1px solid var(--c-border-light, var(--c-border));
}

.html-viewer__content figcaption:not(.ltx_caption) {
  font-size: 0.85em;
  color: var(--c-text-secondary);
  margin-top: 0.75em;
  line-height: 1.55;
  text-align: left;
}

/* ---------- 表格滚动容器 ---------- */
.html-viewer__table-wrap {
  display: block;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow-x: auto;
  overflow-y: visible;
  margin: 1.2em 0;
  -webkit-overflow-scrolling: touch;
}

.html-viewer__table-wrap > table {
  margin: 0;
}

/* 非 arXiv 来源的普通表格 */
.html-viewer__content table:not(.ltx_tabular) {
  border-collapse: collapse;
  width: max-content;
  min-width: 100%;
  font-size: 0.9em;
}

.html-viewer__content table:not(.ltx_tabular) th,
.html-viewer__content table:not(.ltx_tabular) td {
  padding: 0.5em 0.75em;
  text-align: center;
  white-space: nowrap;
  word-break: keep-all;
  overflow-wrap: normal;
  overflow: visible;
  line-height: 1.4;
  vertical-align: middle;
  border-bottom: 1px solid var(--c-border-light, var(--c-border));
}

.html-viewer__content table:not(.ltx_tabular) th {
  font-weight: 650;
  color: var(--c-text-heading);
  border-top: 2px solid var(--c-text-heading);
  border-bottom: 1px solid var(--c-text-heading);
}

.html-viewer__content table:not(.ltx_tabular) tbody tr:last-child td {
  border-bottom: 2px solid var(--c-text-heading);
}

/* 公式表格（1-2 行、无 th、含 math/katex） */
.html-viewer__content table:not(.ltx_tabular):not(.html-viewer__table-wrap > table) {
  width: 100%;
  min-width: 0;
  border: none;
}

.html-viewer__content table:not(.ltx_tabular):not(.html-viewer__table-wrap > table) td {
  border: none;
  padding: 0.5em 0.2em;
  background: transparent;
  white-space: normal;
  overflow: visible;
  line-height: 1.4;
  text-align: center;
}

.html-viewer__content table:not(.ltx_tabular):not(.html-viewer__table-wrap > table) td:last-child {
  text-align: right;
  white-space: nowrap;
  color: var(--c-text-secondary);
  width: 1%;
}

/* ---------- 代码 ---------- */
.html-viewer__content pre,
.html-viewer__content code {
  font-family: var(--font-mono);
  border-radius: var(--radius-sm);
}
.html-viewer__content code {
  background: var(--c-bg-code);
  padding: 0.15em 0.4em;
  font-size: 0.88em;
}
.html-viewer__content pre {
  background: var(--c-bg-code);
  padding: 1em 1.2em;
  overflow-x: auto;
  border: 1px solid var(--c-border-light, var(--c-border));
  line-height: 1.55;
  font-size: 0.88em;
}

/* ---------- 引用块 ---------- */
.html-viewer__content blockquote {
  border-left: 3px solid var(--c-accent);
  background: var(--c-bg-secondary);
  padding: 0.8em 1.2em;
  margin: 1.2em 0;
  color: var(--c-text-secondary);
}

/* ---------- 分隔线 ---------- */
.html-viewer__content hr {
  border: none;
  height: 1px;
  background: var(--c-border-light, var(--c-border));
  margin: 2em 0;
}

/* ---------- KaTeX ---------- */
.html-viewer__content .katex {
  font-size: 1em;
}

.html-viewer__content .katex-display {
  margin: 1em 0;
  overflow-x: auto;
  overflow-y: hidden;
}

/* ---------- 选中高亮 ---------- */
.html-viewer__content ::selection {
  background: var(--c-accent-light, var(--c-accent));
  color: #fff;
}

/* ================================================================
 *  双语翻译
 * ================================================================ */

.bilingual-block__zh--only {
  color: var(--c-text-primary);
  margin: 0.5em 0;
  line-height: 1.8;
}

/* 纯中文模式下保留标题排版层级 */
h1.bilingual-block__zh--only {
  font-size: 1.65em;
  font-weight: 650;
  text-align: center;
  color: var(--c-text-heading);
  margin: 0.6em 0 0.3em;
  line-height: 1.35;
}

h2.bilingual-block__zh--only {
  font-size: 1.3em;
  font-weight: 650;
  color: var(--c-text-heading);
  margin: 2em 0 0.7em;
  padding-bottom: 0.3em;
  border-bottom: 1.5px solid var(--c-border-light, var(--c-border));
  line-height: 1.35;
}

h3.bilingual-block__zh--only {
  font-size: 1.12em;
  font-weight: 650;
  color: var(--c-text-heading);
  margin: 1.5em 0 0.5em;
  line-height: 1.35;
}

h4.bilingual-block__zh--only,
h5.bilingual-block__zh--only,
h6.bilingual-block__zh--only {
  font-size: 1em;
  font-weight: 650;
  color: var(--c-text-heading);
  margin: 1.2em 0 0.4em;
  line-height: 1.35;
}

p.bilingual-block__zh--only {
  text-align: justify;
  margin: 0.65em 0;
}

.bilingual-block__zh--inline {
  font-style: italic;
  color: var(--c-text-tertiary, var(--c-text-secondary));
  margin: 0.15em 0 0.7em;
  font-size: 0.92em;
  line-height: 1.7;
  border-left: 2px solid var(--c-accent-light, var(--c-accent));
  padding-left: 0.7em;
}
</style>
