import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { FileImage } from "lucide-react";

export function AuthImage({
  fileId,
  className,
}: {
  fileId: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let isMounted = true;

    async function fetchImage() {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (!token) return;

        const res = await fetch(`/api/drive-file/${fileId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) throw new Error("Failed to fetch image");

        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);

        if (isMounted) {
          setSrc(objectUrl);
        }
      } catch (e) {
        console.error("AuthImage fetch error", e);
      }
    }

    fetchImage();

    return () => {
      isMounted = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [fileId]);

  if (!src) {
    return (
      <div
        className={`bg-blue-100 flex items-center justify-center rounded ${className || ""}`}
      >
        <FileImage className="w-4 h-4 gap-2 text-blue-600" />
      </div>
    );
  }

  return (
    <img
      src={src}
      className={`object-cover rounded ${className || ""}`}
      alt="Recent Upload"
    />
  );
}
