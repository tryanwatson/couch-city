import { useRef, useCallback, useEffect } from 'react';

interface UseHoldToRepeatOptions {
  onAction: () => void;
  disabled?: boolean;
  initialDelay?: number;
  startInterval?: number;
  minInterval?: number;
  accelerationFactor?: number;
}

export function useHoldToRepeat({
  onAction,
  disabled = false,
  initialDelay = 400,
  startInterval = 200,
  minInterval = 50,
  accelerationFactor = 0.85,
}: UseHoldToRepeatOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef(startInterval);
  const activeRef = useRef(false);
  const onActionRef = useRef(onAction);

  useEffect(() => {
    onActionRef.current = onAction;
  }, [onAction]);

  const stop = useCallback(() => {
    activeRef.current = false;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (disabled) stop();
  }, [disabled, stop]);

  useEffect(() => stop, [stop]);

  const scheduleNext = useCallback(() => {
    if (!activeRef.current) return;
    timerRef.current = setTimeout(() => {
      if (!activeRef.current) return;
      onActionRef.current();
      intervalRef.current = Math.max(minInterval, intervalRef.current * accelerationFactor);
      scheduleNext();
    }, intervalRef.current);
  }, [minInterval, accelerationFactor]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      onActionRef.current();
      activeRef.current = true;
      intervalRef.current = startInterval;
      timerRef.current = setTimeout(() => {
        if (!activeRef.current) return;
        onActionRef.current();
        scheduleNext();
      }, initialDelay);
    },
    [disabled, initialDelay, startInterval, scheduleNext],
  );

  const onPointerUp = useCallback(() => stop(), [stop]);
  const onPointerLeave = useCallback(() => stop(), [stop]);
  const onContextMenu = useCallback((e: React.SyntheticEvent) => {
    e.preventDefault();
  }, []);

  return { onPointerDown, onPointerUp, onPointerLeave, onContextMenu };
}
