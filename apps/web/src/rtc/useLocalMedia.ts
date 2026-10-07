import { useCallback, useEffect, useState } from 'react';

const VIDEO: MediaTrackConstraints = {
  width: { ideal: 320 },
  height: { ideal: 240 },
  frameRate: { ideal: 15, max: 20 },
  facingMode: 'user',
};
const AUDIO: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

/** Acquires camera + mic while `enabled`, falling back to audio-only if the camera is unavailable. */
export function useLocalMedia(enabled: boolean) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let acquired: MediaStream | null = null;

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera needs HTTPS (or localhost)');
        return;
      }
      try {
        acquired = await navigator.mediaDevices.getUserMedia({ video: VIDEO, audio: AUDIO });
        setError(null);
      } catch {
        try {
          acquired = await navigator.mediaDevices.getUserMedia({ audio: AUDIO });
          setError('Camera unavailable, audio only');
        } catch {
          setError('Camera and microphone are blocked');
        }
      }
      if (cancelled) {
        acquired?.getTracks().forEach((t) => t.stop());
        return;
      }
      setStream(acquired);
      setCamOn(!!acquired?.getVideoTracks().length);
      setMicOn(!!acquired?.getAudioTracks().length);
    })();

    return () => {
      cancelled = true;
      acquired?.getTracks().forEach((t) => t.stop());
      setStream(null);
      setCamOn(false);
      setMicOn(false);
    };
  }, [enabled]);

  const toggleCam = useCallback(() => {
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCamOn(track.enabled);
  }, [stream]);

  const toggleMic = useCallback(() => {
    const track = stream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
  }, [stream]);

  return { stream, camOn, micOn, error, toggleCam, toggleMic };
}
