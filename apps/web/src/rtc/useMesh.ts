import { useEffect, useMemo, useState } from 'react';
import type { IceServerConfig, RtcSignalIn, TableState } from '@pk/shared';
import { rpc, type AppSocket } from '../lib/socket';
import { PeerMesh, type PeerTarget } from './PeerMesh';

const FALLBACK_ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

/** Maintains WebRTC connections to every other connected, seated player. Returns their streams by user id. */
export function useMesh(
  socket: AppSocket | null,
  tableId: string,
  selfId: string | null,
  state: TableState | null,
  localStream: MediaStream | null,
) {
  const [iceServers, setIceServers] = useState<RTCIceServer[] | null>(null);
  const [mesh, setMesh] = useState<PeerMesh | null>(null);
  const [streams, setStreams] = useState<Map<string, MediaStream>>(new Map());

  const mySeat = state?.mySeat ?? null;
  const selfEpoch = mySeat !== null ? state?.seats[mySeat]?.rtcEpoch ?? 0 : 0;
  const seated = mySeat !== null;

  useEffect(() => {
    if (!socket) return;
    rpc<{ iceServers: IceServerConfig[] }>(socket, 'rtc:config')
      .then((c) => setIceServers(c.iceServers as RTCIceServer[]))
      .catch(() => setIceServers(FALLBACK_ICE));
  }, [socket]);

  useEffect(() => {
    if (!socket || !selfId || !iceServers || !seated) return;
    const m = new PeerMesh(
      selfId,
      iceServers,
      (to, toEpoch, fromEpoch, data) => socket.emit('rtc:signal', { tableId, to, toEpoch, fromEpoch, data }),
      setStreams,
    );
    const onSignal = (msg: RtcSignalIn) => {
      if (msg.tableId === tableId) m.handleSignal(msg);
    };
    socket.on('rtc:signal', onSignal);
    setMesh(m);
    return () => {
      socket.off('rtc:signal', onSignal);
      m.close();
      setMesh(null);
      setStreams(new Map());
    };
  }, [socket, selfId, iceServers, seated, tableId]);

  useEffect(() => {
    mesh?.setLocalStream(localStream);
  }, [mesh, localStream]);

  const targetsKey = useMemo(() => {
    if (!state) return '';
    return state.seats
      .filter((p) => p && p.userId !== selfId && p.connected && p.rtcEpoch)
      .map((p) => `${p!.userId}:${p!.rtcEpoch}`)
      .sort()
      .join(',');
  }, [state, selfId]);

  useEffect(() => {
    if (!mesh) return;
    mesh.setSelfEpoch(selfEpoch);
    const targets: PeerTarget[] = targetsKey
      ? targetsKey.split(',').map((t) => {
          const i = t.lastIndexOf(':');
          return { userId: t.slice(0, i), epoch: Number(t.slice(i + 1)) };
        })
      : [];
    mesh.sync(targets);
  }, [mesh, selfEpoch, targetsKey]);

  return streams;
}
