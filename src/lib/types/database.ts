/**
 * Database types.
 *
 * This file mirrors what `supabase gen types typescript` produces, and is
 * consumed by the Supabase clients so every query is typed end to end.
 *
 * To regenerate against your own project after changing a migration:
 *
 *   npx supabase login
 *   npx supabase gen types typescript --project-id <your-project-ref> \
 *     --schema public > src/lib/types/database.ts
 *
 * (or `npm run types` — see package.json). Until you run it, this
 * hand-maintained version is kept in sync with the migrations in
 * supabase/migrations and is safe to rely on.
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type DecisionCategoryDb =
  | "food" | "entertainment" | "travel" | "shopping"
  | "lifestyle" | "work" | "social" | "health" | "career"
  | "relationships" | "finance" | "hobbies" | "other";
export type DecisionStatusDb = "open" | "decided" | "reflected" | "abandoned";
export type PreferencePolarityDb = "like" | "dislike" | "neutral";
export type NotificationKindDb =
  | "reflection_prompt" | "discover_question" | "digest" | "system";

type Relationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne?: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

type Table<
  Row,
  Rels extends readonly Relationship[] = [],
  Insert = Partial<Row>,
  Update = Partial<Row>,
> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: Rels;
};

/** Shorthand for the common "child.parent_id → parent.id" foreign key. */
type FK<Name extends string, Col extends string, Parent extends string> = {
  foreignKeyName: Name;
  columns: [Col];
  isOneToOne: false;
  referencedRelation: Parent;
  referencedColumns: ["id"];
};

/**
 * Note: declared as a type alias, not an interface. Only type aliases get an
 * implicit index signature, which is what supabase-js needs to accept the
 * schema.
 */
export type Database = {
  public: {
    Tables: {
      preference_categories: Table<{ id: string; slug: string; label: string; description: string | null; sort_order: number }>;
      profiles: Table<{
        id: string;
        full_name: string | null;
        country: string | null;
        language: string | null;
        occupation: string | null;
        avatar_url: string | null;
        onboarded_at: string | null;
        decision_style: string | null;
        age: number | null;
        ai_enabled: boolean;
        ai_consent_updated_at: string | null;
        terms_version: string | null;
        terms_accepted_at: string | null;
        privacy_notice_version: string | null;
        memory_generation: number;
        memory_reset_at: string | null;
        streak_count: number;
        longest_streak: number;
        last_active_date: string | null;
        streak_freezes: number;
        weekly_goal: number;
        timezone: string;
        created_at: string;
      }>;

      forgotten_knowledge_keys: Table<{ user_id: string; key: string }>;

      preferences: Table<{
        category_id: string | null;
        id: string;
        user_id: string;
        key: string;
        value: string | null;
        polarity: PreferencePolarityDb;
        strength: number;
        source: "explicit" | "inferred" | "reflected";
        evidence_count: number;
        last_reinforced_at: string | null;
        created_at: string;
      }, [FK<"preferences_category_id_fkey", "category_id", "preference_categories">]>;

      decision_engine_configs: Table<{
        id: string;
        category: string;
        version: number;
        weights: Json;
        is_active: boolean;
        created_at: string;
      }>;

      knowledge_nodes: Table<{
        id: string;
        user_id: string;
        key: string;
        value: string | null;
        category_slug: string;
        kind: string;
        polarity: PreferencePolarityDb;
        belief_score: number;
        confidence: number;
        evidence_count: number;
        support_weight: number;
        opposition_weight: number;
        source: string;
        last_reinforced_at: string;
        last_verified_at: string | null;
        last_decay_at: string;
        verification_due_at: string | null;
        decay_rate: number;
        status: string;
        metadata: Json;
        created_at: string;
        updated_at: string;
      }>;

      knowledge_edges: Table<{
        id: string;
        user_id: string;
        from_node_id: string;
        to_node_id: string;
        relation: string;
        confidence: number;
        source: string;
        created_at: string;
        updated_at: string;
      }>;

      knowledge_evidence: Table<{
        id: string;
        user_id: string;
        node_id: string;
        kind: string;
        direction: number;
        weight: number;
        source_decision_id: string | null;
        source_question_id: string | null;
        detail: Json;
        created_at: string;
      }>;

      knowledge_verification_queue: Table<{
        id: string;
        user_id: string;
        node_id: string;
        prompt: string;
        status: string;
        created_at: string;
        answered_at: string | null;
      }>;

      questions: Table<{
        id: string;
        category_id: string | null;
        kind: string;
        prompt: string;
        option_a: string | null;
        option_b: string | null;
        maps_to_key_a: string | null;
        maps_to_key_b: string | null;
        context: Json;
        is_onboarding: boolean;
        is_active: boolean;
        sort_order: number;
        created_at: string;
      }>;

      question_branches: Table<{ child_question_id: string; parent_question_id: string; parent_choice: string }>;

      question_answers: Table<{
        id: string;
        user_id: string;
        question_id: string;
        answer: string;
        skipped: boolean;
        created_at: string;
      }, [FK<"question_answers_question_id_fkey", "question_id", "questions">, FK<"question_answers_user_id_fkey", "user_id", "profiles">]>;

      decisions: Table<{
        id: string;
        user_id: string;
        category: DecisionCategoryDb;
        question: string;
        context: Json;
        comparison_revision: number;
        reminder_requested_at: string | null;
        reflection_due_at: string | null;
        reminder_enabled: boolean;
        reminder_version: number;
        expected_outcome: string | null;
        status: DecisionStatusDb;
        selected_option_id: string | null;
        decided_at: string | null;
        created_at: string;
      }, [FK<"decisions_user_id_fkey", "user_id", "profiles">]>;
      // Note: decisions.selected_option_id → decision_options.id is a real FK in
      // the database, but listing it here would make every
      // `decision_options(...)` embed ambiguous to the type parser (and to
      // PostgREST). Queries disambiguate with an explicit
      // `!decision_options_decision_id_fkey` hint instead.

      decision_options: Table<{
        id: string;
        decision_id: string;
        label: string;
        rank: number | null;
        score: number | null;
        score_breakdown: Json;
        created_at: string;
      }, [{ foreignKeyName: "decision_options_decision_id_fkey"; columns: ["decision_id"]; isOneToOne: false; referencedRelation: "decisions"; referencedColumns: ["id"] }]>;

      decision_reflections: Table<{
        id: string;
        decision_id: string;
        user_id: string;
        rating: number | null;
        would_repeat: boolean | null;
        has_regrets: boolean | null;
        would_recommend: boolean | null;
        would_choose_again: boolean | null;
        notes: string | null;
        created_at: string;
      }, [{ foreignKeyName: "decision_reflections_decision_id_fkey"; columns: ["decision_id"]; isOneToOne: true; referencedRelation: "decisions"; referencedColumns: ["id"] }, FK<"decision_reflections_user_id_fkey", "user_id", "profiles">]>;

      notifications: Table<{
        id: string;
        user_id: string;
        kind: NotificationKindDb;
        title: string;
        body: string | null;
        payload: Json;
        read_at: string | null;
        created_at: string;
      }>;

      achievements: Table<{
        slug: string;
        title: string;
        description: string;
        icon: string;
        sort_order: number;
      }>;

      user_achievements: Table<{
        user_id: string;
        achievement_slug: string;
        earned_at: string;
      }, [{ foreignKeyName: "user_achievements_achievement_slug_fkey"; columns: ["achievement_slug"]; isOneToOne: false; referencedRelation: "achievements"; referencedColumns: ["slug"] }, FK<"user_achievements_user_id_fkey", "user_id", "profiles">]>;

      decision_groups: Table<{
        id: string;
        owner_id: string;
        name: string;
        invite_code: string | null;
        created_at: string;
      }>;

      decision_group_members: Table<{
        group_id: string;
        user_id: string;
        role: string;
        joined_at: string;
      }, [FK<"decision_group_members_group_id_fkey", "group_id", "decision_groups">, FK<"decision_group_members_user_id_fkey", "user_id", "profiles">]>;

      group_polls: Table<{
        id: string;
        group_id: string;
        created_by: string;
        question: string;
        status: string;
        created_at: string;
      }, [FK<"group_polls_group_id_fkey", "group_id", "decision_groups">]>;

      group_poll_options: Table<{
        id: string;
        poll_id: string;
        label: string;
        sort_order: number;
      }, [FK<"group_poll_options_poll_id_fkey", "poll_id", "group_polls">]>;

      group_poll_votes: Table<{
        poll_id: string;
        option_id: string;
        user_id: string;
        created_at: string;
      }, [FK<"group_poll_votes_poll_id_fkey", "poll_id", "group_polls">, FK<"group_poll_votes_option_id_fkey", "option_id", "group_poll_options">]>;

      native_push_devices: Table<{id:string;user_id:string;installation_id:string;secret_hash:string;device_epoch:number;intent_hash:string;token:string|null;token_revision:number;enabled:boolean;time_zone:string;quiet_start:number;quiet_end:number;enabled_at:string;updated_at:string;expires_at:string}>;
      push_subscriptions: Table<{
        id: string;
        user_id: string;
        endpoint: string;
        p256dh: string;
        auth: string;
        created_at: string;
      }>;

      ai_memories: Table<{
        id: string;
        user_id: string;
        kind: string;
        content: string;
        confidence: number;
        reviewed_at: string | null;
        source_decision_id: string | null;
        expires_at: string | null;
        created_at: string;
      }>;

      analytics_events: Table<{
        id: string;
        user_id: string;
        name: string;
        properties: Json;
        created_at: string;
      }>;
    };

    Views: { [_ in never]: never };

    Functions: {
      set_native_push_device:{Args:{p_installation_id:string;p_secret:string;p_epoch:number;p_settings:Json};Returns:Json};
      claim_native_push_deliveries:{Args:{p_limit?:number};Returns:{delivery_id:string;claim_token:string;notification_id:string;device_id:string;device_revision:number;recipient_user_id:string;token:string;decision_id:string}[]};
      native_push_delivery_current:{Args:{p_delivery_id:string;p_claim_token:string};Returns:boolean};
      enable_native_daily_questions:{Args:{p_installation_id:string;p_secret:string;p_epoch:number};Returns:boolean};
      claim_native_daily_questions:{Args:{p_policy_version:string};Returns:Json};
      read_native_daily_question:{Args:{p_id:string;p_claim_token:string;p_policy_version:string};Returns:Json};
      finish_native_daily_question:{Args:{p_id:string;p_claim_token:string;p_retry:boolean};Returns:boolean};
      finish_native_push_delivery:{Args:{p_delivery_id:string;p_claim_token:string;p_outcome:string;p_status?:number|null};Returns:boolean};
      read_discovery_state: { Args: Record<string, never>; Returns: Json };
      save_discovery_answers: { Args: {p_request_id:string;p_generation:number;p_answers:Json;p_source?:string}; Returns: Json };
      edit_discovery_answer: { Args: {p_request_id:string;p_generation:number;p_answer_id:string;p_revision:number;p_response?:Json;p_active?:boolean;p_delete?:boolean}; Returns: Json };
      reserve_discovery_question: { Args: {p_request_id:string;p_generation:number;p_question_id:string;p_version:number;p_daily?:boolean;p_change?:boolean;p_reason?:string}; Returns: Json };
      save_discovery_preferences: { Args: {p_generation:number;p_muted:Json;p_optional:boolean;p_depth:number;p_written:boolean;p_metrics:boolean}; Returns: undefined };
      save_discovery_feedback: { Args: {p_request_id:string;p_generation:number;p_insight_id:string;p_feedback:string}; Returns: Json };
      export_discovery_data: { Args: {p_offset?:number}; Returns: Json };
      prune_discovery_activity: { Args: Record<string,never>; Returns: undefined };
      search_beliefs: { Args: { p_search?: string; p_offset?: number }; Returns: Database["public"]["Tables"]["knowledge_nodes"]["Row"][] };
      correct_knowledge_node: { Args: { p_node_id: string; p_polarity: PreferencePolarityDb; p_note?: string }; Returns: undefined };
      edit_ai_memory: { Args: { p_memory_id: string; p_content: string; p_kind: string; p_delete?: boolean }; Returns: undefined };
      create_comparison: { Args: { p_category: DecisionCategoryDb; p_title: string; p_context: Json; p_expected_outcome: string | null; p_options: Json; p_generation: number }; Returns: string };
      create_comparison_once: { Args: { p_request_id: string; p_intent: Json; p_category: DecisionCategoryDb; p_title: string; p_context: Json; p_expected_outcome: string | null; p_options: Json; p_generation: number }; Returns: string };
      create_comparison_with_evidence: { Args: { p_request_id: string; p_intent: Json; p_category: DecisionCategoryDb; p_title: string; p_context: Json; p_expected_outcome: string | null; p_options: Json; p_generation: number; p_evidence: Json }; Returns: string };
      rerank_comparison: { Args: { p_decision_id: string; p_revision: number; p_options: Json; p_context: Json; p_generation: number }; Returns: undefined };
      rerank_comparison_with_evidence: { Args: { p_decision_id: string; p_revision: number; p_options: Json; p_context: Json; p_generation: number; p_evidence: Json }; Returns: undefined };
      read_my_comparison_evidence: { Args: { p_decision_id: string }; Returns: { decision_id: string; comparison_revision: number; scoring_run_id: string; memory_generation: number; snapshot: Json; created_at: string }[] };
      export_my_comparison_evidence: { Args: { p_offset?: number }; Returns: { decision_id: string; comparison_revision: number; scoring_run_id: string; memory_generation: number; snapshot: Json; created_at: string }[] };
      list_comparison_settings: { Args: Record<string, never>; Returns: { id: string; name: string; domain: string; category: DecisionCategoryDb; goal: string; aliases: Json; memory_generation: number; created_at: string; updated_at: string }[] };
      read_my_comparison_setting: { Args: { p_id: string }; Returns: { id: string; name: string; domain: string; category: DecisionCategoryDb; goal: string; aliases: Json; memory_generation: number; created_at: string; updated_at: string }[] };
      get_comparison_settings_state: { Args: Record<string, never>; Returns: Json };
      save_comparison_setting: { Args: { p_id: string | null; p_name: string; p_domain: string; p_category: DecisionCategoryDb; p_goal: string; p_aliases: Json; p_generation: number }; Returns: string };
      delete_comparison_setting: { Args: { p_id: string; p_generation: number }; Returns: undefined };
      schedule_reflection: { Args: { p_decision_id: string; p_due_at: string | null; p_enabled: boolean }; Returns: undefined };

      commit_choice_and_learn: { Args: { p_decision_id: string; p_option_id: string; p_key: string }; Returns: undefined };
      abandon_decision: { Args: { p_decision_id: string }; Returns: undefined };
      erase_learned_memory: { Args: Record<string, never>; Returns: undefined };
      save_ai_memories: { Args: { p_memories: Json; p_expected_generation: number; p_decision_id?: string | null }; Returns: number };
      save_reviewed_memories: { Args: { p_request_id: string; p_memories: Json; p_generation: number }; Returns: number };
      submit_decision_reflection: {
        Args: { p_decision_id: string; p_rating: number; p_would_repeat: boolean | null;
          p_has_regrets: boolean | null; p_would_recommend: boolean | null;
          p_would_choose_again: boolean | null; p_notes: string | null; p_key: string };
        Returns: { saved: boolean; memory_generation: number }[];
      };
      answer_knowledge_verification: { Args: { p_queue_id: string; p_answer: string }; Returns: undefined };
      circle_vote_counts: { Args: { gid: string }; Returns: { poll_id: string; option_id: string; votes: number }[] };
      complete_onboarding: { Args: { p_profile: Json; p_answers: Json; p_expected_generation: number }; Returns: number };
      answer_discover_question: { Args: { p_question_id: string; p_choice: string }; Returns: boolean };

      accept_legal_terms: { Args: { p_version: string; p_age_eligible: boolean }; Returns: undefined };
      reserve_ai_request: { Args: { p_action: string }; Returns: boolean };
      reserve_ai_usage_attempt: { Args: { p_user_id: string; p_request_id: string; p_action: string; p_provider: string; p_model: string; p_memory_generation: number; p_max_cost_micros: number; p_user_daily_budget_micros: number; p_global_daily_budget_micros: number }; Returns: { reserved: boolean; reason: string }[] };
      finish_ai_usage_attempt: { Args: { p_user_id: string; p_request_id: string; p_outcome: string; p_input_tokens?: number | null; p_output_tokens?: number | null; p_actual_cost_micros?: number | null }; Returns: boolean };
      export_my_ai_usage: { Args: Record<string, never>; Returns: { request_id: string; action: string; provider: string; model: string; status: string; outcome: string | null; input_tokens: number | null; output_tokens: number | null; reserved_cost_micros: number; actual_cost_micros: number | null; created_at: string; finished_at: string | null }[] };
      set_ai_enabled: { Args: { p_enabled: boolean }; Returns: undefined };
      create_circle: { Args: { p_name: string }; Returns: string };
      create_circle_poll: { Args: { p_group_id: string; p_question: string; p_options: Json }; Returns: string };
      cast_circle_vote: { Args: { p_poll_id: string; p_option_id: string }; Returns: undefined };
      close_circle_poll: { Args: { p_group_id: string; p_poll_id: string }; Returns: undefined };
      manage_circle: { Args: { p_group_id: string; p_action: string }; Returns: string | null };
      touch_streak: { Args: Record<string, never>; Returns: number };
      refill_streak_freezes: { Args: Record<string, never>; Returns: undefined };
      enqueue_due_reflection_prompts: { Args: Record<string, never>; Returns: number };
      is_circle_member: { Args: { gid: string }; Returns: boolean };
      circle_members: {
        Args: { gid: string };
        Returns: { user_id: string; full_name: string; role: string; joined_at: string }[];
      };
      join_decision_circle: { Args: { code: string }; Returns: string };
      commit_decision_choice: { Args: { p_decision_id: string; p_option_id: string }; Returns: undefined };
      forget_knowledge_key: { Args: { p_key: string }; Returns: undefined };
      apply_knowledge_confidence_decay: { Args: Record<string, never>; Returns: number };
      enqueue_due_knowledge_verifications: { Args: Record<string, never>; Returns: number };
      set_timezone: { Args: { p_timezone: string }; Returns: undefined };
      evaluate_achievements: { Args: Record<string, never>; Returns: string[] };
      discover_next_question: { Args: { p_topic?: string | null }; Returns: Database["public"]["Tables"]["questions"]["Row"][] };
      discover_other_topic: { Args: { p_current_topic?: string | null }; Returns: Database["public"]["Tables"]["questions"]["Row"][] };
      refresh_my_verifications: { Args: Record<string, never>; Returns: number };
      next_unanswered_question: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          category_id: string | null;
          kind: string;
          prompt: string;
          option_a: string | null;
          option_b: string | null;
          maps_to_key_a: string | null;
          maps_to_key_b: string | null;
          context: Json;
          is_onboarding: boolean;
          is_active: boolean;
          sort_order: number;
          created_at: string;
        }[];
      };
      question_progress: {
        Args: Record<string, never>;
        Returns: { total_questions: number; total_answered: number; answered_today: number }[];
      };
    };

    Enums: {
      decision_category: DecisionCategoryDb;
      decision_status: DecisionStatusDb;
      preference_polarity: PreferencePolarityDb;
      notification_kind: NotificationKindDb;
    };

    CompositeTypes: Record<string, never>;
  };
};

/** Convenience aliases: `Tables<"decisions">` is the row type. */
export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type Inserts<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
