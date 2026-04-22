import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { notesApi } from '../../api'
import type { Note, CreateNoteRequest, UpdateNoteRequest } from '../../types'
import { broadcastSync } from '../../utils/broadcast'
import { STORES, dbPut, dbGet } from '../../utils/db'

/** 将当前 query 缓存的笔记列表同步到 IDB（按文档存储） */
function syncNotesToIdb(queryClient: ReturnType<typeof useQueryClient>, pdfId: string) {
    const current = queryClient.getQueryData<Note[]>(['notes', pdfId])
    if (current) {
        dbPut(STORES.NOTES, { id: pdfId, notes: current }).catch(console.warn)
    }
}

export const useNotesQuery = (pdfId: MaybeRefOrGetter<string | null>) => {
    const queryClient = useQueryClient()
    return useQuery({
        queryKey: computed(() => ['notes', toValue(pdfId)]),
        queryFn: async () => {
            const id = toValue(pdfId)
            if (!id) return []
            if (!queryClient.getQueryData(['notes', id])) {
                const cached = await dbGet<{ id: string; notes: any[] }>(STORES.NOTES, id).catch(() => null)
                if (cached && Array.isArray(cached.notes)) return cached.notes
            }
            const { success, notes } = await notesApi.getNotes(id)
            if (success && Array.isArray(notes)) {
                dbPut(STORES.NOTES, { id, notes }).catch(console.warn)
                return notes
            }
            dbPut(STORES.NOTES, { id, notes: [] }).catch(console.warn)
            return []
        },
        enabled: () => !!toValue(pdfId),
    })
}

export const useCreateNoteMutation = () => {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (data: CreateNoteRequest) => notesApi.createNote(data),
        onMutate: async (variables) => {
            // 取消正在进行的查询，避免覆盖乐观更新
            await queryClient.cancelQueries({ queryKey: ['notes', variables.pdfId] })

            // 保存当前数据快照，用于回滚
            const previousNotes = queryClient.getQueryData<Note[]>(['notes', variables.pdfId])

            // 乐观更新：立即添加新笔记到缓存（使用临时 ID）
            const optimisticNote: Note = {
                id: Date.now(), // 临时 ID，后端返回后会替换
                title: variables.title || '',
                content: variables.content,
                tags: variables.tags || [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }

            queryClient.setQueryData<Note[]>(['notes', variables.pdfId], (old) => {
                return old ? [...old, optimisticNote] : [optimisticNote]
            })

            return { previousNotes, optimisticNote }
        },
        onError: (err, variables, context) => {
            // 失败时回滚到之前的状态
            if (context?.previousNotes) {
                queryClient.setQueryData(['notes', variables.pdfId], context.previousNotes)
            }
            console.error('Failed to create note:', err)
        },
        onSuccess: (res, variables, context) => {
            if (res.success && res.id) {
                // 用真实 ID 替换临时 ID
                queryClient.setQueryData<Note[]>(['notes', variables.pdfId], (old) => {
                    if (!old) return old
                    return old.map(note =>
                        note.id === context?.optimisticNote.id
                            ? { ...note, id: res.id! }
                            : note
                    )
                })

            }
            syncNotesToIdb(queryClient, variables.pdfId)
            broadcastSync('RELOAD_NOTES', variables.pdfId)
        },
    })
}

export const useUpdateNoteMutation = () => {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ id, data, pdfId: _pdfId }: { id: number, data: UpdateNoteRequest, pdfId: string }) =>
            notesApi.updateNote(id, data),
        onMutate: async (variables) => {
            // 取消正在进行的查询
            await queryClient.cancelQueries({ queryKey: ['notes', variables.pdfId] })

            // 保存当前数据快照
            const previousNotes = queryClient.getQueryData<Note[]>(['notes', variables.pdfId])

            // 乐观更新：立即更新笔记
            queryClient.setQueryData<Note[]>(['notes', variables.pdfId], (old) => {
                if (!old) return old
                return old.map(note =>
                    note.id === variables.id
                        ? { ...note, ...variables.data, updatedAt: new Date().toISOString() }
                        : note
                )
            })

            return { previousNotes }
        },
        onError: (err, variables, context) => {
            // 失败时回滚
            if (context?.previousNotes) {
                queryClient.setQueryData(['notes', variables.pdfId], context.previousNotes)
            }
            console.error('Failed to update note:', err)
        },
        onSuccess: (res, variables) => {
            if (res.success) {
                syncNotesToIdb(queryClient, variables.pdfId)
            }
            broadcastSync('RELOAD_NOTES', variables.pdfId)
        },
    })
}

export const useDeleteNoteMutation = () => {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ id, pdfId: _pdfId }: { id: number, pdfId: string }) => notesApi.deleteNote(id),
        onMutate: async (variables) => {
            // 取消正在进行的查询
            await queryClient.cancelQueries({ queryKey: ['notes', variables.pdfId] })

            // 保存当前数据快照
            const previousNotes = queryClient.getQueryData<Note[]>(['notes', variables.pdfId])

            // 乐观更新：立即删除笔记
            queryClient.setQueryData<Note[]>(['notes', variables.pdfId], (old) => {
                if (!old) return old
                return old.filter(note => note.id !== variables.id)
            })

            return { previousNotes }
        },
        onError: (err, variables, context) => {
            // 失败时回滚
            if (context?.previousNotes) {
                queryClient.setQueryData(['notes', variables.pdfId], context.previousNotes)
            }
            console.error('Failed to delete note:', err)
        },
        onSuccess: (_, variables) => {
            syncNotesToIdb(queryClient, variables.pdfId)
            broadcastSync('RELOAD_NOTES', variables.pdfId)
        },
    })
}
