import { useState, useEffect, useCallback, useEffectEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { Folder } from '../types/database'

type FolderRpcResult = Folder[] | null

function shouldFallbackToLegacyFolderFetch(message: string) {
  return (
    message.includes('list_user_folders_with_counts') ||
    message.includes('PGRST202') ||
    message.includes('Could not find the function')
  )
}

export function useFolders() {
  const [folders, setFolders] = useState<Folder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchFoldersLegacy = useCallback(async (userId: string) => {
    const { data: folderData, error: folderError } = await supabase
      .from('folders')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (folderError) {
      throw new Error(folderError.message)
    }

    if (!folderData) {
      setFolders([])
      return
    }

    const foldersWithCount: Folder[] = []
    for (const folder of folderData) {
      const { count, error: countError } = await supabase
        .from('notes')
        .select('*', { count: 'exact', head: true })
        .eq('folder_id', folder.id)

      if (countError) {
        throw new Error(countError.message)
      }

      foldersWithCount.push({
        ...folder,
        note_count: count || 0,
      })
    }

    setFolders(foldersWithCount)
  }, [])

  const fetchFolders = useCallback(async () => {
    setLoading(true)
    setError(null)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setFolders([])
      setLoading(false)
      return
    }

    try {
      const { data, error: rpcError } = await supabase.rpc('list_user_folders_with_counts')

      if (rpcError) {
        await fetchFoldersLegacy(user.id)
        setLoading(false)
        return
      }

      setFolders((data as FolderRpcResult) || [])
      setLoading(false)
    } catch (fetchError: unknown) {
      const message = fetchError instanceof Error ? fetchError.message : 'Erro ao carregar pastas'

      if (shouldFallbackToLegacyFolderFetch(message)) {
        try {
          await fetchFoldersLegacy(user.id)
        } catch (legacyError: unknown) {
          setError(legacyError instanceof Error ? legacyError.message : message)
          setFolders([])
        }
      } else {
        setError(message)
        setFolders([])
      }

      setLoading(false)
    }
  }, [fetchFoldersLegacy])

  const fetchFoldersEvent = useEffectEvent(fetchFolders)

  useEffect(() => {
    void fetchFoldersEvent()
  }, [])

  const createFolder = async (name: string, noteIds: string[]) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Nao autenticado')

    // Create folder
    const { data: folder, error: createError } = await supabase
      .from('folders')
      .insert({ user_id: user.id, name })
      .select()
      .single()

    if (createError) throw new Error(createError.message)

    // Move notes to folder
    if (noteIds.length > 0) {
      const { error: updateError } = await supabase
        .from('notes')
        .update({ folder_id: folder.id })
        .in('id', noteIds)

      if (updateError) throw new Error(updateError.message)
    }

    await fetchFolders()
    return folder as Folder
  }

  const renameFolder = async (id: string, name: string) => {
    const { error } = await supabase
      .from('folders')
      .update({ name })
      .eq('id', id)

    if (error) throw new Error(error.message)
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)))
  }

  const deleteFolder = async (id: string) => {
    // Notes will have folder_id set to null (ON DELETE SET NULL)
    const { error } = await supabase
      .from('folders')
      .delete()
      .eq('id', id)

    if (error) throw new Error(error.message)
    setFolders((prev) => prev.filter((f) => f.id !== id))
  }

  const moveNotesToFolder = async (noteIds: string[], folderId: string) => {
    const { error } = await supabase
      .from('notes')
      .update({ folder_id: folderId })
      .in('id', noteIds)

    if (error) throw new Error(error.message)
    await fetchFolders()
  }

  const removeNotesFromFolder = async (noteIds: string[]) => {
    const { error } = await supabase
      .from('notes')
      .update({ folder_id: null })
      .in('id', noteIds)

    if (error) throw new Error(error.message)
    await fetchFolders()
  }

  return {
    folders,
    loading,
    error,
    createFolder,
    renameFolder,
    deleteFolder,
    moveNotesToFolder,
    removeNotesFromFolder,
    refetch: fetchFolders,
  }
}
