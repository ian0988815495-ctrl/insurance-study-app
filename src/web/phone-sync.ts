import { createClient } from "@supabase/supabase-js";
import type { ActivePractice } from "./active-practice.ts";
import type { OfflineState } from "./offline-store.ts";

export type PhoneSyncSnapshot = { state: OfflineState; activePractice: ActivePractice | null };

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
const client = url && publishableKey ? createClient(url, publishableKey) : null;

export const isPhoneSyncConfigured = Boolean(client);

export async function getPhoneSyncSession() {
  if (!client) return null;
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function signInPhoneSync(email: string, password: string) {
  if (!client) throw new Error("手機同步尚未設定。");
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

export async function signUpPhoneSync(email: string, password: string) {
  if (!client) throw new Error("手機同步尚未設定。");
  const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: window.location.href.split("#")[0] } });
  if (error) throw error;
  return data.session;
}

export async function signOutPhoneSync() {
  if (!client) return;
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export async function loadPhoneSync() {
  if (!client) return null;
  const session = await getPhoneSyncSession();
  if (!session) return null;
  const { data, error } = await client.from("question_bank_progress").select("state, active_practice").eq("user_id", session.user.id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { state: data.state as OfflineState, activePractice: data.active_practice as ActivePractice | null } satisfies PhoneSyncSnapshot;
}

export async function savePhoneSync(snapshot: PhoneSyncSnapshot) {
  if (!client) return false;
  const session = await getPhoneSyncSession();
  if (!session) return false;
  const { error } = await client.from("question_bank_progress").upsert({ user_id: session.user.id, state: snapshot.state, active_practice: snapshot.activePractice, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw error;
  return true;
}
