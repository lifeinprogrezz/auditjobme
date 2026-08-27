export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      applications: {
        Row: {
          applied_at: string
          confirmed_at: string | null
          id: string
          job_id: string
          notes: string | null
          status: string
          user_id: string
        }
        Insert: {
          applied_at?: string
          confirmed_at?: string | null
          id?: string
          job_id: string
          notes?: string | null
          status?: string
          user_id: string
        }
        Update: {
          applied_at?: string
          confirmed_at?: string | null
          id?: string
          job_id?: string
          notes?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      artifacts: {
        Row: {
          content: Json
          context: string | null
          created_at: string
          id: string
          job_id: string | null
          kind: string
          model: string | null
          public_slug: string | null
          updated_at: string
          user_id: string
          visibility: string
        }
        Insert: {
          content?: Json
          context?: string | null
          created_at?: string
          id?: string
          job_id?: string | null
          kind: string
          model?: string | null
          public_slug?: string | null
          updated_at?: string
          user_id: string
          visibility?: string
        }
        Update: {
          content?: Json
          context?: string | null
          created_at?: string
          id?: string
          job_id?: string | null
          kind?: string
          model?: string | null
          public_slug?: string | null
          updated_at?: string
          user_id?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "artifacts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      audits: {
        Row: {
          accent_color: string | null
          audit_data: Json
          audit_label: string | null
          company_name: string
          created_at: string
          duration_seconds: number | null
          id: string
          is_published: boolean
          job_link: string | null
          pdf_path: string | null
          role_name: string | null
          slug: string | null
          user_id: string
        }
        Insert: {
          accent_color?: string | null
          audit_data: Json
          audit_label?: string | null
          company_name: string
          created_at?: string
          duration_seconds?: number | null
          id?: string
          is_published?: boolean
          job_link?: string | null
          pdf_path?: string | null
          role_name?: string | null
          slug?: string | null
          user_id: string
        }
        Update: {
          accent_color?: string | null
          audit_data?: Json
          audit_label?: string | null
          company_name?: string
          created_at?: string
          duration_seconds?: number | null
          id?: string
          is_published?: boolean
          job_link?: string | null
          pdf_path?: string | null
          role_name?: string | null
          slug?: string | null
          user_id?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          careers_url: string | null
          coord_city: string | null
          coord_precision: string
          description: string | null
          founded_year: number | null
          headcount_bucket: string | null
          hq_city: string | null
          hq_country: string | null
          lat: number | null
          linkedin_url: string | null
          lng: number | null
          logo_domain: string | null
          name: string
          open_roles_count: number | null
          sector: string | null
          slug: string
          source: string | null
          stage: string | null
          uk_sponsor_status: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          careers_url?: string | null
          coord_city?: string | null
          coord_precision?: string
          description?: string | null
          founded_year?: number | null
          headcount_bucket?: string | null
          hq_city?: string | null
          hq_country?: string | null
          lat?: number | null
          linkedin_url?: string | null
          lng?: number | null
          logo_domain?: string | null
          name: string
          open_roles_count?: number | null
          sector?: string | null
          slug: string
          source?: string | null
          stage?: string | null
          uk_sponsor_status?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          careers_url?: string | null
          coord_city?: string | null
          coord_precision?: string
          description?: string | null
          founded_year?: number | null
          headcount_bucket?: string | null
          hq_city?: string | null
          hq_country?: string | null
          lat?: number | null
          linkedin_url?: string | null
          lng?: number | null
          logo_domain?: string | null
          name?: string
          open_roles_count?: number | null
          sector?: string | null
          slug?: string
          source?: string | null
          stage?: string | null
          uk_sponsor_status?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      company_offices: {
        Row: {
          address: string | null
          city: string | null
          city_key: string
          company_slug: string
          lat: number
          lng: number
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          city_key: string
          company_slug: string
          lat: number
          lng: number
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          city_key?: string
          company_slug?: string
          lat?: number
          lng?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_offices_company_slug_fkey"
            columns: ["company_slug"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["slug"]
          },
        ]
      }
      company_requests: {
        Row: {
          careers_url: string | null
          company_name: string
          created_at: string
          id: string
          note: string | null
          status: string
          user_id: string
        }
        Insert: {
          careers_url?: string | null
          company_name: string
          created_at?: string
          id?: string
          note?: string | null
          status?: string
          user_id: string
        }
        Update: {
          careers_url?: string | null
          company_name?: string
          created_at?: string
          id?: string
          note?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      connections: {
        Row: {
          company: string
          company_key: string
          connected_on: string | null
          created_at: string
          full_name: string
          id: string
          linkedin_url: string | null
          position: string | null
          user_id: string
        }
        Insert: {
          company: string
          company_key: string
          connected_on?: string | null
          created_at?: string
          full_name: string
          id?: string
          linkedin_url?: string | null
          position?: string | null
          user_id: string
        }
        Update: {
          company?: string
          company_key?: string
          connected_on?: string | null
          created_at?: string
          full_name?: string
          id?: string
          linkedin_url?: string | null
          position?: string | null
          user_id?: string
        }
        Relationships: []
      }
      daily_matches: {
        Row: {
          batch_date: string
          created_at: string
          fit_bullets: Json | null
          id: string
          job_url: string
          notified_at: string | null
          rank: number | null
          reason: string | null
          rubric_version: string | null
          score: number | null
          seen_at: string | null
          user_id: string
        }
        Insert: {
          batch_date?: string
          created_at?: string
          fit_bullets?: Json | null
          id?: string
          job_url: string
          notified_at?: string | null
          rank?: number | null
          reason?: string | null
          rubric_version?: string | null
          score?: number | null
          seen_at?: string | null
          user_id: string
        }
        Update: {
          batch_date?: string
          created_at?: string
          fit_bullets?: Json | null
          id?: string
          job_url?: string
          notified_at?: string | null
          rank?: number | null
          reason?: string | null
          rubric_version?: string | null
          score?: number | null
          seen_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      daily_top_sets: {
        Row: {
          created_at: string
          day: string
          id: string
          job_ids: string[]
          user_id: string
        }
        Insert: {
          created_at?: string
          day?: string
          id?: string
          job_ids?: string[]
          user_id: string
        }
        Update: {
          created_at?: string
          day?: string
          id?: string
          job_ids?: string[]
          user_id?: string
        }
        Relationships: []
      }
      device_fingerprints: {
        Row: {
          audit_id: string
          created_at: string
          fingerprint_id: string
          id: string
          user_id: string
        }
        Insert: {
          audit_id: string
          created_at?: string
          fingerprint_id: string
          id?: string
          user_id: string
        }
        Update: {
          audit_id?: string
          created_at?: string
          fingerprint_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_fingerprints_audit_id_fkey"
            columns: ["audit_id"]
            isOneToOne: false
            referencedRelation: "audits"
            referencedColumns: ["id"]
          },
        ]
      }
      dismissed_jobs: {
        Row: {
          dismissed_at: string
          id: string
          job_id: string
          user_id: string
        }
        Insert: {
          dismissed_at?: string
          id?: string
          job_id: string
          user_id: string
        }
        Update: {
          dismissed_at?: string
          id?: string
          job_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dismissed_jobs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          created_at: string
          id: string
          message: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          user_id?: string
        }
        Relationships: []
      }
      headcount_bucket_backup_20260726: {
        Row: {
          captured_at: string
          headcount_bucket: string | null
          slug: string
        }
        Insert: {
          captured_at?: string
          headcount_bucket?: string | null
          slug: string
        }
        Update: {
          captured_at?: string
          headcount_bucket?: string | null
          slug?: string
        }
        Relationships: []
      }
      inbound_emails: {
        Row: {
          action: string
          application_id: string | null
          ats: string | null
          classification: string
          detail: string | null
          from_domain: string | null
          id: string
          message_id: string | null
          received_at: string
          user_id: string
        }
        Insert: {
          action: string
          application_id?: string | null
          ats?: string | null
          classification: string
          detail?: string | null
          from_domain?: string | null
          id?: string
          message_id?: string | null
          received_at?: string
          user_id: string
        }
        Update: {
          action?: string
          application_id?: string | null
          ats?: string | null
          classification?: string
          detail?: string | null
          from_domain?: string | null
          id?: string
          message_id?: string | null
          received_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbound_emails_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_tokens: {
        Row: {
          created_at: string
          gmail_confirmation_at: string | null
          gmail_confirmation_code: string | null
          gmail_confirmation_url: string | null
          gmail_confirmed_at: string | null
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          gmail_confirmation_at?: string | null
          gmail_confirmation_code?: string | null
          gmail_confirmation_url?: string | null
          gmail_confirmed_at?: string | null
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          gmail_confirmation_at?: string | null
          gmail_confirmation_code?: string | null
          gmail_confirmation_url?: string | null
          gmail_confirmed_at?: string | null
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      jobs: {
        Row: {
          city: string | null
          company: string
          company_id: string | null
          created_at: string
          extracted_at: string | null
          extraction: Json | null
          extraction_version: string | null
          first_seen_at: string
          has_jd: boolean | null
          id: string
          is_live: boolean
          jd_hash: string | null
          jd_source_detail: string | null
          jd_text: string | null
          liveness_checked_at: string | null
          location: string | null
          posted_at: string | null
          remote: boolean
          role_family: string | null
          seniority: string | null
          source: string | null
          title: string
          url: string
          workplace: string | null
        }
        Insert: {
          city?: string | null
          company: string
          company_id?: string | null
          created_at?: string
          extracted_at?: string | null
          extraction?: Json | null
          extraction_version?: string | null
          first_seen_at?: string
          id?: string
          is_live?: boolean
          jd_hash?: string | null
          jd_source_detail?: string | null
          jd_text?: string | null
          liveness_checked_at?: string | null
          location?: string | null
          posted_at?: string | null
          remote?: boolean
          role_family?: string | null
          seniority?: string | null
          source?: string | null
          title: string
          url: string
          workplace?: string | null
        }
        Update: {
          city?: string | null
          company?: string
          company_id?: string | null
          created_at?: string
          extracted_at?: string | null
          extraction?: Json | null
          extraction_version?: string | null
          first_seen_at?: string
          id?: string
          is_live?: boolean
          jd_hash?: string | null
          jd_source_detail?: string | null
          jd_text?: string | null
          liveness_checked_at?: string | null
          location?: string | null
          posted_at?: string | null
          remote?: boolean
          role_family?: string | null
          seniority?: string | null
          source?: string | null
          title?: string
          url?: string
          workplace?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["slug"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          citizenship: string | null
          created_at: string
          cv_changed_at: string | null
          cv_hash: string | null
          cv_text: string | null
          display_name: string | null
          email: string | null
          eu_work_authorized: boolean | null
          id: string
          languages: string[] | null
          onboarded_at: string | null
          open_to_remote: boolean | null
          scores_ready_notified_at: string | null
          stale_refreshed_at: string | null
          target_cities: string[] | null
          target_roles: string[] | null
          target_sectors: string[] | null
          target_seniority: string | null
          updated_at: string
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          citizenship?: string | null
          created_at?: string
          cv_changed_at?: string | null
          cv_hash?: string | null
          cv_text?: string | null
          display_name?: string | null
          email?: string | null
          eu_work_authorized?: boolean | null
          id: string
          languages?: string[] | null
          onboarded_at?: string | null
          open_to_remote?: boolean | null
          scores_ready_notified_at?: string | null
          stale_refreshed_at?: string | null
          target_cities?: string[] | null
          target_roles?: string[] | null
          target_sectors?: string[] | null
          target_seniority?: string | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          citizenship?: string | null
          created_at?: string
          cv_changed_at?: string | null
          cv_hash?: string | null
          cv_text?: string | null
          display_name?: string | null
          email?: string | null
          eu_work_authorized?: boolean | null
          id?: string
          languages?: string[] | null
          onboarded_at?: string | null
          open_to_remote?: boolean | null
          scores_ready_notified_at?: string | null
          stale_refreshed_at?: string | null
          target_cities?: string[] | null
          target_roles?: string[] | null
          target_sectors?: string[] | null
          target_seniority?: string | null
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      purchases: {
        Row: {
          created_at: string
          credits: number
          id: string
          product_id: string
          stripe_session_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          credits: number
          id?: string
          product_id: string
          stripe_session_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          credits?: number
          id?: string
          product_id?: string
          stripe_session_id?: string
          user_id?: string
        }
        Relationships: []
      }
      referral_tokens: {
        Row: {
          created_at: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      referrals: {
        Row: {
          created_at: string
          referee_id: string
          referrer_id: string
          signed_up_at: string
        }
        Insert: {
          created_at?: string
          referee_id: string
          referrer_id: string
          signed_up_at?: string
        }
        Update: {
          created_at?: string
          referee_id?: string
          referrer_id?: string
          signed_up_at?: string
        }
        Relationships: []
      }
      saved_jobs: {
        Row: {
          id: string
          job_id: string
          saved_at: string
          user_id: string
        }
        Insert: {
          id?: string
          job_id: string
          saved_at?: string
          user_id: string
        }
        Update: {
          id?: string
          job_id?: string
          saved_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_jobs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      score_batches: {
        Row: {
          batch_date: string | null
          id: string
          job_ids: string[]
          provider_batch_id: string
          retrieved_at: string | null
          rubric_version: string
          status: string
          submitted_at: string
          user_id: string
          worker: string
        }
        Insert: {
          batch_date?: string | null
          id?: string
          job_ids?: string[]
          provider_batch_id: string
          retrieved_at?: string | null
          rubric_version: string
          status?: string
          submitted_at?: string
          user_id: string
          worker: string
        }
        Update: {
          batch_date?: string | null
          id?: string
          job_ids?: string[]
          provider_batch_id?: string
          retrieved_at?: string | null
          rubric_version?: string
          status?: string
          submitted_at?: string
          user_id?: string
          worker?: string
        }
        Relationships: []
      }
      scores: {
        Row: {
          cv_hash: string | null
          id: string
          job_id: string
          rubric_version: string
          score: number | null
          scored_at: string
          signals: Json | null
          user_id: string
        }
        Insert: {
          cv_hash?: string | null
          id?: string
          job_id: string
          rubric_version?: string
          score?: number | null
          scored_at?: string
          signals?: Json | null
          user_id: string
        }
        Update: {
          cv_hash?: string | null
          id?: string
          job_id?: string
          rubric_version?: string
          score?: number | null
          scored_at?: string
          signals?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scores_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      status_events: {
        Row: {
          application_id: string | null
          changed_at: string
          from_status: string | null
          id: string
          to_status: string
          user_id: string
        }
        Insert: {
          application_id?: string | null
          changed_at?: string
          from_status?: string | null
          id?: string
          to_status: string
          user_id: string
        }
        Update: {
          application_id?: string | null
          changed_at?: string
          from_status?: string | null
          id?: string
          to_status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "status_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          batch: boolean
          cost_usd: number | null
          created_at: string
          id: string
          input_tokens: number | null
          kind: string
          latency_ms: number | null
          model: string | null
          output_tokens: number | null
          user_id: string | null
        }
        Insert: {
          batch?: boolean
          cost_usd?: number | null
          created_at?: string
          id?: string
          input_tokens?: number | null
          kind: string
          latency_ms?: number | null
          model?: string | null
          output_tokens?: number | null
          user_id?: string | null
        }
        Update: {
          batch?: boolean
          cost_usd?: number | null
          created_at?: string
          id?: string
          input_tokens?: number | null
          kind?: string
          latency_ms?: number | null
          model?: string | null
          output_tokens?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      whitelisted_emails: {
        Row: {
          created_at: string
          email: string
          id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
        }
        Relationships: []
      }
    }
    Views: {
      public_profiles: {
        Row: {
          avatar_url: string | null
          display_name: string | null
          id: string | null
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          display_name?: string | null
          id?: string | null
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          display_name?: string | null
          id?: string | null
          username?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      claim_referral: {
        Args: { ref_token: string }
        Returns: boolean
      }
      count_audits_by_fingerprint: {
        Args: { p_fingerprint: string }
        Returns: number
      }
      delete_own_account: { Args: never; Returns: undefined }
      generate_audit_slug: {
        Args: { p_company: string; p_user_id: string }
        Returns: string
      }
      get_global_avg_duration: { Args: never; Returns: number }
      get_or_create_forwarding_token: { Args: never; Returns: string }
      get_or_create_referral_token: { Args: never; Returns: string }
      link_jobs_to_companies: { Args: never; Returns: number }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
