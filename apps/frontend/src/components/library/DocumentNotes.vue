<script setup lang="ts">
import { useNotesQuery } from '../../composables/queries/useNoteQueries'
import { useMarkdownRenderer } from '../../composables/useMarkdownRenderer'
import { formatDate } from '../../utils/date'

const { renderMarkdown } = useMarkdownRenderer()

const props = defineProps<{
    pdfId: string
}>()

const emit = defineEmits<{
    (e: 'open-reader', pdfId: string): void
}>()

const { data: notes, isLoading } = useNotesQuery(props.pdfId)
</script>

<template>
    <div class="document-notes-container">
        <div v-if="isLoading" class="flex items-center gap-3 py-6 text-gray-500 justify-center">
            <div class="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
            <span class="text-sm">读取笔记中...</span>
        </div>
        
        <div v-else-if="notes && notes.length > 0" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 py-2">
            <div 
                v-for="note in notes" 
                :key="note.id" 
                class="bg-white dark:bg-[#252526] p-4 rounded-lg border border-gray-100 dark:border-gray-800 shadow-sm relative group/note hover:shadow-md transition-shadow"
            >
                <div class="flex items-center justify-between mb-2">
                    <h4 class="font-semibold text-gray-800 dark:text-gray-200 truncate pr-10 text-sm">
                        {{ note.title || '无标题笔记' }}
                    </h4>
                    <span class="text-[10px] px-1.5 py-0.5 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded">笔记</span>
                </div>
                
                <div class="text-xs text-gray-600 dark:text-gray-400 line-clamp-3 mb-3 leading-relaxed markdown-body prose prose-sm max-w-none dark:prose-invert" v-html="renderMarkdown(note.content)">
                </div>
                
                <div class="flex flex-wrap gap-2 mb-2">
                    <span 
                        v-for="keyword in note.tags" 
                        :key="keyword" 
                        class="text-[10px] bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 px-2 py-0.5 rounded-full"
                    >
                        #{{ keyword }}
                    </span>
                </div>
                
                <div class="text-[10px] text-gray-400 dark:text-gray-500 mt-2 flex justify-between items-center">
                    <span>{{ formatDate(note.updatedAt) }}</span>
                    <button 
                        @click="emit('open-reader', pdfId)" 
                        class="opacity-0 group-hover/note:opacity-100 text-primary-600 hover:underline transition-opacity"
                    >
                        查看详情
                    </button>
                </div>
            </div>
        </div>
        
        <div v-else class="py-12 text-center bg-gray-50/50 dark:bg-gray-800/20 rounded-xl border border-dashed border-gray-200 dark:border-gray-700">
            <div class="text-gray-400 text-sm mb-3">该文献暂无笔记</div>
            <button 
                @click="emit('open-reader', pdfId)" 
                class="ui-btn ui-btn--compact text-xs px-4"
            >
                点击进入阅读器添加笔记
            </button>
        </div>
    </div>
</template>

<!-- line-clamp-3 is now defined globally in styles/base.css -->
