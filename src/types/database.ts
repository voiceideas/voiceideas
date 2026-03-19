export interface Note {
  id: string
  user_id: string
  raw_text: string
  title: string | null
  folder_id: string | null
  created_at: string
}

export interface Folder {
  id: string
  user_id: string
  name: string
  created_at: string
  note_count?: number
}

export interface OrganizedIdea {
  id: string
  user_id: string
  note_ids: string[]
  type: 'topicos' | 'plano' | 'roteiro' | 'mapa'
  title: string
  tags: string[] | null
  content: OrganizedContent
  created_at: string
}

export interface OrganizedContent {
  sections: {
    title: string
    items: string[]
  }[]
  summary?: string
}

export type ShareRole = 'viewer'

export interface OrganizedIdeaShare {
  id: string
  source_idea_id: string
  owner_user_id: string
  created_at: string
}

export interface OrganizedIdeaShareInvite {
  id: string
  share_id: string
  invited_email: string
  role: ShareRole
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  invited_by: string
  accepted_by: string | null
  accepted_at: string | null
  expires_at: string
  created_at: string
}

export interface OrganizedIdeaShareMember {
  id: string
  share_id: string
  user_id: string
  role: ShareRole
  invited_by: string | null
  invite_id: string | null
  created_at: string
}

export interface SharedOrganizedIdea extends OrganizedIdea {
  share_id: string
  shared_at: string
  shared_by_user_id: string
}

export interface UserProfile {
  id: string
  user_id: string
  daily_limit: number
  role: 'user' | 'admin'
  notes_used_today: number
  usage_date: string
  created_at: string
}

export type OrganizationType = OrganizedIdea['type']

export interface Database {
  public: {
    Tables: {
      notes: {
        Row: Note
        Insert: Omit<Note, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<Note, 'id'>>
      }
      folders: {
        Row: Folder
        Insert: Omit<Folder, 'id' | 'created_at' | 'note_count'> & { id?: string; created_at?: string; note_count?: number }
        Update: Partial<Omit<Folder, 'id' | 'note_count'>>
      }
      user_profiles: {
        Row: UserProfile
        Insert: Omit<UserProfile, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<UserProfile, 'id'>>
      }
      organized_ideas: {
        Row: OrganizedIdea
        Insert: Omit<OrganizedIdea, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<OrganizedIdea, 'id'>>
      }
      organized_idea_shares: {
        Row: OrganizedIdeaShare
        Insert: Omit<OrganizedIdeaShare, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<OrganizedIdeaShare, 'id'>>
      }
      organized_idea_share_invites: {
        Row: OrganizedIdeaShareInvite
        Insert: Omit<OrganizedIdeaShareInvite, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<OrganizedIdeaShareInvite, 'id'>>
      }
      organized_idea_share_members: {
        Row: OrganizedIdeaShareMember
        Insert: Omit<OrganizedIdeaShareMember, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<OrganizedIdeaShareMember, 'id'>>
      }
    }
  }
}
