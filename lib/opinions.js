import { getPublicClient } from "./supabase";

export async function getOpinions() {
  const supabase = getPublicClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from("opinions")
    .select("id, title, author, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  return data || [];
}

export async function getOpinionById(id) {
  const supabase = getPublicClient();
  if (!supabase) return null;
  const { data } = await supabase
    .from("opinions")
    .select("*")
    .eq("id", id)
    .single();
  return data || null;
}
