import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase";
import {
  CHANNELS_TABLE,
  CHANNEL_MAX_PER_KIND,
  isChannelKind,
  toWireChannel,
  validateChannelInput,
} from "@/lib/neighborhood/channels";

export const dynamic = "force-dynamic";

// ============================================================
// /api/admin/channels — the TV lineup (milestone 28).
// ------------------------------------------------------------
// Commissioner-only, gated on isAuthed() directly like the
// moderation and broadcast routes (NOT canSeeNeighborhood():
// the neighborhood is public, the lineup is Austin's).
//
// Two lists in one table, told apart by `kind`:
//   tv       — YouTube TV links for the popup broadcast
//   youtube  — public YouTube videos/streams for when nobody
//              is broadcasting
//
// Validation lives in lib/neighborhood/channels.js so the form,
// this route and the room all agree on what a channel is.
// ============================================================

function notAuthed() {
  return NextResponse.json({ error: "Not authorized." }, { status: 401 });
}

export async function GET() {
  if (!(await isAuthed())) return notAuthed();
  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }
  const { data, error } = await supabase
    .from(CHANNELS_TABLE)
    .select("id, kind, name, url, sort, enabled, created_at")
    .order("kind", { ascending: true })
    .order("sort", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, channels: (data || []).map(toWireChannel) });
}

export async function POST(request) {
  if (!(await isAuthed())) return notAuthed();

  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }

  const action = String(payload?.action || "");

  if (action === "delete") {
    const id = String(payload?.id || "");
    if (!id) return NextResponse.json({ error: "Missing channel." }, { status: 400 });
    const { error } = await supabase.from(CHANNELS_TABLE).delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // A one-field toggle, so it skips the full-row validation —
  // there is nothing here to get wrong.
  if (action === "toggle") {
    const id = String(payload?.id || "");
    if (!id) return NextResponse.json({ error: "Missing channel." }, { status: 400 });
    const { data, error } = await supabase
      .from(CHANNELS_TABLE)
      .update({ enabled: !!payload.enabled, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id, kind, name, url, sort, enabled")
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, channel: toWireChannel(data) });
  }

  if (action === "create" || action === "update") {
    const check = validateChannelInput({
      kind: payload?.kind,
      name: payload?.name,
      url: payload?.url,
      sort: payload?.sort,
      enabled: payload?.enabled,
    });
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: 400 });
    }
    const value = check.value;

    if (action === "create") {
      const { count, error: countErr } = await supabase
        .from(CHANNELS_TABLE)
        .select("id", { count: "exact", head: true })
        .eq("kind", value.kind);
      if (countErr) {
        return NextResponse.json({ error: countErr.message }, { status: 500 });
      }
      if ((count || 0) >= CHANNEL_MAX_PER_KIND) {
        return NextResponse.json(
          { error: `That lineup is full (${CHANNEL_MAX_PER_KIND} channels).` },
          { status: 400 }
        );
      }
      const { data, error } = await supabase
        .from(CHANNELS_TABLE)
        .insert(value)
        .select("id, kind, name, url, sort, enabled")
        .maybeSingle();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, channel: toWireChannel(data) });
    }

    const id = String(payload?.id || "");
    if (!id) return NextResponse.json({ error: "Missing channel." }, { status: 400 });
    const { data, error } = await supabase
      .from(CHANNELS_TABLE)
      .update({ ...value, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id, kind, name, url, sort, enabled")
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "That channel is gone." }, { status: 404 });
    return NextResponse.json({ ok: true, channel: toWireChannel(data) });
  }

  if (action === "reorder") {
    const ids = Array.isArray(payload?.ids) ? payload.ids.map(String) : null;
    if (!ids || !isChannelKind(payload?.kind)) {
      return NextResponse.json({ error: "Bad request." }, { status: 400 });
    }
    for (let i = 0; i < ids.length; i += 1) {
      const { error } = await supabase
        .from(CHANNELS_TABLE)
        .update({ sort: i, updated_at: new Date().toISOString() })
        .eq("id", ids[i])
        .eq("kind", payload.kind);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
