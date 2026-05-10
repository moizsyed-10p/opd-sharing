// src/hooks/use-sync-user.ts
import { useConvexAuth, useMutation } from "convex/react";
import { useEffect } from "react";
import { api } from "@/convex/_generated/api.js";

export function useSyncUser() {
  const { isAuthenticated } = useConvexAuth();
  const updateCurrentUser = useMutation(api.users.updateCurrentUser);

  useEffect(() => {
    if (isAuthenticated) {
      updateCurrentUser();
    }
  }, [isAuthenticated, updateCurrentUser]);
}