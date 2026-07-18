import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "./supabase";
import { useAuth } from "./auth";

export type Role = "user" | "mod" | "admin";

export type Profile = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  role: Role;
  theme_prefs: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

/**
 * Fields the profile owner may edit. `role` and identifiers are intentionally
 * excluded — the RLS policy on `profiles` also blocks any attempt to change
 * `role` from the client, but we drop it from the type as a first line of defence.
 */
export type ProfilePatch = Partial<Pick<Profile, "display_name" | "theme_prefs">>;

type ProfileContextValue = {
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  update: (patch: ProfilePatch) => Promise<Profile>;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (userId: string) => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    if (error) {
      setError(error.message);
      setProfile(null);
    } else {
      setProfile(data as Profile);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setError(null);
      return;
    }
    void load(user.id);
  }, [user, load]);

  const refresh = useCallback(async () => {
    if (user) await load(user.id);
  }, [user, load]);

  const update = useCallback<ProfileContextValue["update"]>(
    async (patch) => {
      if (!user) throw new Error("Not signed in");
      const { data, error } = await supabase
        .from("profiles")
        .update(patch)
        .eq("id", user.id)
        .select()
        .single();
      if (error) throw error;
      setProfile(data as Profile);
      return data as Profile;
    },
    [user],
  );

  const value = useMemo<ProfileContextValue>(
    () => ({ profile, loading, error, refresh, update }),
    [profile, loading, error, refresh, update],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used inside <ProfileProvider>");
  return ctx;
}
