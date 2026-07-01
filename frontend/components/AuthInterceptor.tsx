"use client";

import { useEffect } from "react";
import { createClient } from "@/utils/supabase/client";

export default function AuthInterceptor({ children }: { children: React.ReactNode }) {
  const supabase = createClient();

  useEffect(() => {
    if (typeof window === "undefined") return;

    const originalFetch = window.fetch;
    
    window.fetch = async (input, init) => {
      let url = "";
      if (typeof input === "string") {
        url = input;
      } else if (input instanceof URL) {
        url = input.toString();
      } else if (input && typeof input === "object" && "url" in input) {
        url = (input as any).url;
      }

      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      
      if (url.includes(apiUrl) || url.includes("/api/")) {
        const { data: { session } } = await supabase.auth.getSession();
        const accessToken = session?.access_token;
        
        if (accessToken) {
          const headers = new Headers(init?.headers);
          if (!headers.has("Authorization")) {
            headers.set("Authorization", `Bearer ${accessToken}`);
          }
          
          // If body is FormData (file upload), do NOT set Content-Type header manually
          // fetch will automatically set the boundary if headers don't have Content-Type.
          // But here we are just copying other headers, which is fine.
          return originalFetch(input, {
            ...init,
            headers,
          });
        }
      }
      return originalFetch(input, init);
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [supabase]);

  return <>{children}</>;
}
