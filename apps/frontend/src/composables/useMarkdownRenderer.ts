import { reactive } from 'vue'
import hljs from 'highlight.js'
import DOMPurify from 'dompurify'
import rehypeKatex from 'rehype-katex'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import 'highlight.js/styles/atom-one-dark.css'
import 'katex/dist/katex.min.css'
import type { Citation } from '../types'

const markdownProcessor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeKatex, { strict: 'ignore' })
    .use(rehypeStringify)

// ── 链接安全：外部链接强制新标签页打开并隔离 opener ──
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
        const href = node.getAttribute('href') || ''
        if (href && !href.startsWith('#')) {
            node.setAttribute('target', '_blank')
            node.setAttribute('rel', 'noopener noreferrer')
        }
    }
})

/** 仅允许 http / https 协议的 URL */
function isSafeUrl(url: string): boolean {
    try {
        const parsed = new URL(url)
        return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
        return false
    }
}

function decodeHtmlEntities(value: string) {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
}

function escapeHtml(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function renderCodeBlocks(html: string) {
    return html.replace(
        /<pre><code(?: class="language-([^"]+)")?>([\s\S]*?)<\/code><\/pre>/g,
        (_match, lang, code) => {
            const decodedCode = decodeHtmlEntities(code)

            if (lang && hljs.getLanguage(lang)) {
                try {
                    const highlighted = hljs.highlight(decodedCode, {
                        language: lang,
                        ignoreIllegals: true,
                    }).value
                    return `<pre class="hljs p-3 rounded-lg text-xs overflow-x-auto"><code>${highlighted}</code></pre>`
                } catch (_error) {
                    // Fall through to plain escaped rendering.
                }
            }

            return `<pre class="hljs p-3 rounded-lg text-xs overflow-x-auto"><code>${escapeHtml(decodedCode)}</code></pre>`
        }
    )
}

export function useMarkdownRenderer() {
    const tooltipState = reactive({
        visible: false,
        x: 0,
        y: 0,
        content: null as Citation | null
    })

    let tooltipTimeout: ReturnType<typeof setTimeout> | null = null

    const renderMarkdown = (content: string) => {
        if (!content) return ''

        let html = String(markdownProcessor.processSync(content))
        html = renderCodeBlocks(html)

        html = html.replace(/\[(\d+)\]/g, (_match, id) => {
            return `<span class="citation-ref text-primary-600 bg-primary-50 px-1 rounded cursor-pointer font-medium hover:bg-primary-100 transition-colors select-none" data-id="${id}">[${id}]</span>`
        })

        return DOMPurify.sanitize(html, {
            ADD_TAGS: ['iframe'],
            ADD_ATTR: ['target', 'data-id', 'class']
        })
    }

    // #11: 使用 getBoundingClientRect() 直接获取视口坐标，配合模板中 fixed 定位使用
    const handleMessageMouseOver = (event: MouseEvent, citations: Citation[]) => {
        const el = (event.target as HTMLElement).closest?.('.citation-ref') as HTMLElement | null
        if (el) {
            const index = parseInt(el.getAttribute('data-id') || '0') - 1
            const citationData = citations[index]

            if (citationData) {
                if (tooltipTimeout) clearTimeout(tooltipTimeout)

                const rect = el.getBoundingClientRect()
                tooltipState.x = rect.left
                tooltipState.y = rect.top - 10
                tooltipState.content = citationData
                tooltipState.visible = true
            }
        }
    }

    const handleMessageMouseOut = (event: MouseEvent) => {
        const el = (event.target as HTMLElement).closest?.('.citation-ref')
        if (el) {
            tooltipTimeout = setTimeout(() => {
                tooltipState.visible = false
                tooltipState.content = null
            }, 300)
        }
    }

    const handleMessageClick = (event: MouseEvent, citations: Citation[]) => {
        const el = (event.target as HTMLElement).closest?.('.citation-ref') as HTMLElement | null
        if (el) {
            const index = parseInt(el.getAttribute('data-id') || '0') - 1
            const citationData = citations[index]

            if (citationData?.url && isSafeUrl(citationData.url)) {
                window.open(citationData.url, '_blank', 'noopener,noreferrer')
            }
        }
    }

    const handleTooltipEnter = () => {
        if (tooltipTimeout) clearTimeout(tooltipTimeout)
    }

    const handleTooltipLeave = () => {
        tooltipState.visible = false
        tooltipState.content = null
    }

    return {
        tooltipState,
        renderMarkdown,
        handleMessageMouseOver,
        handleMessageMouseOut,
        handleMessageClick,
        handleTooltipEnter,
        handleTooltipLeave
    }
}
