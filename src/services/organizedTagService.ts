import { getIdeaTags, normalizeTagList } from '../lib/organizedTags'
import { supabase } from '../lib/supabase'
import type { OrganizedIdea } from '../types/database'

export interface OrganizedTagMutation {
  ideaId: string
  tags: string[]
}

function normalizeTagKey(tag: string) {
  return tag.trim().toLocaleLowerCase('pt-BR')
}

function sameTagList(left: string[], right: string[]) {
  if (left.length !== right.length) return false

  return left.every((tag, index) => normalizeTagKey(tag) === normalizeTagKey(right[index] || ''))
}

export function planRenameOrganizedTag(
  ideas: OrganizedIdea[],
  currentTag: string,
  nextTag: string,
): OrganizedTagMutation[] {
  const currentKey = normalizeTagKey(currentTag)
  const normalizedNextTag = normalizeTagList([nextTag])[0]

  if (!normalizedNextTag || currentKey === normalizeTagKey(normalizedNextTag)) {
    return []
  }

  return ideas.flatMap((idea) => {
    const existingTags = getIdeaTags(idea)
    if (!existingTags.some((tag) => normalizeTagKey(tag) === currentKey)) {
      return []
    }

    const nextTags = normalizeTagList(
      existingTags.map((tag) => (normalizeTagKey(tag) === currentKey ? normalizedNextTag : tag)),
    )

    return sameTagList(existingTags, nextTags)
      ? []
      : [{ ideaId: idea.id, tags: nextTags }]
  })
}

export function planMergeOrganizedTags(
  ideas: OrganizedIdea[],
  tagsToMerge: string[],
  mergedTag: string,
): OrganizedTagMutation[] {
  const mergeKeys = new Set(tagsToMerge.map(normalizeTagKey))
  const normalizedMergedTag = normalizeTagList([mergedTag])[0]

  if (mergeKeys.size < 2 || !normalizedMergedTag) {
    return []
  }

  return ideas.flatMap((idea) => {
    const existingTags = getIdeaTags(idea)
    if (!existingTags.some((tag) => mergeKeys.has(normalizeTagKey(tag)))) {
      return []
    }

    let insertedMergedTag = false
    const nextTags = normalizeTagList(
      existingTags.flatMap((tag) => {
        if (!mergeKeys.has(normalizeTagKey(tag))) {
          return [tag]
        }

        if (insertedMergedTag) {
          return []
        }

        insertedMergedTag = true
        return [normalizedMergedTag]
      }),
    )

    return sameTagList(existingTags, nextTags)
      ? []
      : [{ ideaId: idea.id, tags: nextTags }]
  })
}

export function planDeleteOrganizedTags(
  ideas: OrganizedIdea[],
  tagsToDelete: string[],
): OrganizedTagMutation[] {
  const deleteKeys = new Set(tagsToDelete.map(normalizeTagKey))

  if (deleteKeys.size === 0) {
    return []
  }

  return ideas.flatMap((idea) => {
    const existingTags = getIdeaTags(idea)
    if (!existingTags.some((tag) => deleteKeys.has(normalizeTagKey(tag)))) {
      return []
    }

    const nextTags = normalizeTagList(
      existingTags.filter((tag) => !deleteKeys.has(normalizeTagKey(tag))),
    )

    return sameTagList(existingTags, nextTags)
      ? []
      : [{ ideaId: idea.id, tags: nextTags }]
  })
}

export async function applyOrganizedTagMutations(
  mutations: OrganizedTagMutation[],
): Promise<void> {
  if (mutations.length === 0) {
    return
  }

  await Promise.all(
    mutations.map(async (mutation) => {
      const { error } = await supabase
        .from('organized_ideas')
        .update({ tags: mutation.tags })
        .eq('id', mutation.ideaId)

      if (error) {
        throw new Error(error.message)
      }
    }),
  )
}
