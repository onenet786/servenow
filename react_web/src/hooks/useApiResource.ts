import { useCallback, useEffect, useState } from "react";

type ResourceState<T> = {
  data: T | null;
  error: string | null;
  isLoading: boolean;
  reload: () => void;
};

export function useApiResource<T>(loader: () => Promise<T>, deps: unknown[] = []): ResourceState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [version, setVersion] = useState(0);

  const reload = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setError(null);

    loader()
      .then((result) => {
        if (isMounted) setData(result);
      })
      .catch((err: unknown) => {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Unable to load data");
        }
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [version, ...deps]);

  return { data, error, isLoading, reload };
}
