"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { discoverFailure as failure, readQuestionState, readVerifications } from "@/lib/discover/loaders";
import { recordKnowledgeSignal } from "@/lib/services/knowledge";
import { discoverTopic, type DiscoverTopic, type AnswerResult, type DailyQuestion, type VerificationItem } from "@/lib/discover/types";

/** Save one explicit preference; the unchosen option is not a dislike. */
export async function answerQuestion(questionId: string, choice: "a" | "b" | "skip", topic: DiscoverTopic | null = null): Promise<AnswerResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Your session expired. Please sign in again.");
  const { error } = await supabase.rpc("answer_discover_question", { p_question_id: questionId, p_choice: choice });
  // Another tab may already have answered the displayed question. Advance to
  // the current queue instead of trapping the user on a conflicting retry.
  if (error && error.message !== "This question was already answered") {
    throw new Error(failure(error, "Couldn't save your answer. Try again."));
  }
  // The required answer has committed (or an identical/other-tab answer already
  // exists). Optional rewards must not make that acknowledgement look failed.
  const [, nextState] = await Promise.allSettled([
    (async () => supabase.rpc("evaluate_achievements"))(),
    readQuestionState(supabase, topic),
  ]);
  if (nextState.status === "rejected") {
    throw new Error(error ? "This question was already answered. Reload Discover to load the next question."
      : "Your answer was saved. Reload Discover to load the next question.");
  }
  revalidatePath("/discover"); revalidatePath("/profile");
  return nextState.value;
}

/** Follow-ups, topic filtering and local-day progress are resolved in SQL. */
export async function loadQuestionState(topic: DiscoverTopic | null = null): Promise<AnswerResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Your session expired. Please sign in again.");
  return readQuestionState(supabase, topic);
}

/** Changing topic neither answers nor skips the displayed question. */
export async function changeTopic(currentTopic: string | null): Promise<AnswerResult> {
  if (currentTopic!==null && (typeof currentTopic!=="string" || currentTopic.length>60)) throw new Error("Choose a valid Discover topic.");
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)throw new Error("Your session expired. Please sign in again.");
  const {data,error}=await supabase.rpc("discover_other_topic",{p_current_topic:currentTopic});
  if(error)throw new Error(failure(error,"Couldn't change topics. Your current question is still available."));
  const question=(data?.[0] as DailyQuestion|undefined)??null;
  if(!question)throw new Error("No unanswered questions are available in another topic right now. You can keep this question or return later.");
  const state=await readQuestionState(supabase,discoverTopic(question.context?.topic));
  return {...state,next:question};
}

export async function confirmInsight(prefKey: string, confirmed: boolean): Promise<{ error?: string }> {
  if (typeof prefKey !== "string" || prefKey.length > 256 || !/^[a-z0-9]+([._-][a-z0-9]+)*$/.test(prefKey)
    || typeof confirmed !== "boolean") return { error: "Choose a valid pattern check." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session expired. Please sign in again." };
  const [current, profile] = await Promise.all([
    supabase.from("knowledge_nodes").select("id,key,value,category_slug,polarity,source,status,evidence_count,metadata")
      .eq("user_id", user.id).eq("key", prefKey).eq("status", "active").maybeSingle(),
    supabase.from("profiles").select("memory_generation").eq("id", user.id).single(),
  ]);
  if (current.error || profile.error) return { error: "Couldn't check this pattern. Please try again." };
  const pattern = current.data;
  const metadata = pattern?.metadata && typeof pattern.metadata === "object" && !Array.isArray(pattern.metadata) ? pattern.metadata : {};
  if (!pattern || pattern.status !== "active" || pattern.polarity !== "like" || !["inferred", "reflected"].includes(pattern.source)
    || pattern.evidence_count < 2 || /\.scope\./.test(pattern.key) || metadata.manual_polarity !== undefined
    || !profile.data || !Number.isSafeInteger(profile.data.memory_generation) || profile.data.memory_generation < 0) {
    return { error: "This pattern changed or is no longer available. Reload Discover before checking it." };
  }
  if (confirmed) {
    const saved = await recordKnowledgeSignal(supabase, { key: pattern.key, value: pattern.value,
      categorySlug: pattern.category_slug, polarity: "like", source: "explicit", weight: 0.5,
      kind: "confirmation", verified: true, detail: { confirmed: true }, memoryGeneration: profile.data.memory_generation });
    if (!saved) return { error: "Couldn't save that pattern check. Reload Discover before retrying." };
  } else {
    // Rejecting an inferred preference does not establish the opposite one.
    // The owner-scoped RPC locks the profile and checks the active node identity;
    // a reset/forget between the read and correction cannot recreate the node.
    const { error } = await supabase.rpc("correct_knowledge_node", { p_node_id: pattern.id, p_polarity: "neutral",
      p_note: "I did not confirm this inferred preference in Discover." });
    if (error) return { error: "Couldn't clear this pattern. Reload Discover before retrying." };
  }
  revalidatePath("/discover"); revalidatePath("/discover/checks"); revalidatePath("/profile"); revalidatePath("/dashboard");
  return {};
}

export async function loadVerifications(limit = 3): Promise<VerificationItem[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  return readVerifications(supabase, user.id, limit);
}

export async function answerVerification(queueId: string, answer: "still_true" | "not_anymore" | "forget"): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session expired. Please sign in again." };
  const { error } = await supabase.rpc("answer_knowledge_verification", { p_queue_id: queueId, p_answer: answer });
  if (error) return { error: failure(error, "Couldn't save that check. Please try again.") };
  revalidatePath("/discover"); revalidatePath("/discover/checks"); revalidatePath("/profile");
  return {};
}
