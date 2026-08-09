// ============================================================
// COMMISSIONER ANNOUNCEMENTS
// ------------------------------------------------------------
// Written by the Commissioner at /admin/announcements and stored
// in Supabase. Nothing here is generated.
// ============================================================

import { getPublicClient, getAdminClient } from "./supabase";

export async function getAnnouncements() {
  const supabase = getPublicClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from("announcements")
    .select("*")
    .order("published_on", { ascending: false })
    .order("created_at", { ascending: false });
  return data || [];
}

export async function getAnnouncementById(id) {
  const supabase = getAdminClient();
  if (!supabase) return null;
  const { data } = await supabase
    .from("announcements")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data || null;
}

// Dates come back as "2026-07-25". Parse the parts by hand so the
// displayed day doesn't shift with the viewer's timezone.
export function formatAnnouncementDate(value) {
  if (!value) return "";
  const [y, m, d] = String(value).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
