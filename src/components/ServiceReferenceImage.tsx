import React, { useEffect, useState } from 'react';
import { Fingerprint } from 'lucide-react';

interface ServiceReferenceImageProps {
  src?: string | null;
  alt: string;
  authToken?: string | null;
  fallbackSrc?: string | null;
  className?: string;
}

export const ServiceReferenceImage: React.FC<ServiceReferenceImageProps> = ({
  src,
  alt,
  authToken,
  fallbackSrc,
  className = 'w-10 h-10 rounded object-cover border border-slate-200 shrink-0',
}) => {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    const trimmed = (src || '').trim();
    setLoadFailed(false);

    if (!trimmed) {
      setResolvedUrl(fallbackSrc || null);
      return;
    }

    if (!trimmed.startsWith('/api/handwriting-references/')) {
      setResolvedUrl(trimmed);
      return;
    }

    let cancelled = false;
    let createdObjectUrl: string | null = null;

    (async () => {
      try {
        const headers: Record<string, string> = {};
        if (authToken) {
          headers.Authorization = `Bearer ${authToken}`;
        }
        const res = await fetch(trimmed, { headers });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const blob = await res.blob();
        if (cancelled) return;
        createdObjectUrl = URL.createObjectURL(blob);
        setResolvedUrl(createdObjectUrl);
      } catch {
        if (!cancelled) {
          if (fallbackSrc) {
            setResolvedUrl(fallbackSrc);
          } else {
            setResolvedUrl(null);
            setLoadFailed(true);
          }
        }
      }
    })();

    return () => {
      cancelled = true;
      if (createdObjectUrl) {
        URL.revokeObjectURL(createdObjectUrl);
      }
    };
  }, [src, authToken, fallbackSrc]);

  if (!resolvedUrl || loadFailed) {
    return (
      <div
        className={`${className} bg-slate-100 flex items-center justify-center text-slate-400`}
        title={alt}
      >
        <Fingerprint className="w-4 h-4" />
      </div>
    );
  }

  return (
    <img
      src={resolvedUrl}
      alt={alt}
      referrerPolicy="no-referrer"
      className={className}
      onError={() => {
        if (fallbackSrc && resolvedUrl !== fallbackSrc) {
          setResolvedUrl(fallbackSrc);
        } else {
          setLoadFailed(true);
        }
      }}
    />
  );
};
