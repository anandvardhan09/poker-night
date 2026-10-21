import { useEffect, useMemo, useState } from 'react';
import type { IceServerConfig, RtcSignalIn, TableState } from '@pk/shared';
import { rpc, type AppSocket } from '../lib/socket';
import { PeerMesh, type PeerTarget } from './PeerMesh';

const FALLBACK_ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

/**
 * Maintains WebRTC connections to every other connected, seated player (and, for seated players, to
 * spectators who receive video). Returns their streams by user id.
 */
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
  const seated = mySeat !== null;
  const spectatorEpoch = state?.spectators.find((x) => x.userId === selfId)?.rtcEpoch ?? 0;
  const selfEpoch = seated ? state?.seats[mySeat]?.rtcEpoch ?? 0 : spectatorEpoch;
  const inMesh = seated || spectatorEpoch > 0;

  useEffect(() => {
    if (!socket) return;
    rpc<{ iceServers: IceServerConfig[] }>(socket, 'rtc:config')
      .then((c) => setIceServers(c.iceServers as RTCIceServer[]))
      .catch(() => setIceServers(FALLBACK_ICE));
  }, [socket]);

  useEffect(() => {
    if (!socket || !selfId || !iceServers || !inMesh) return;
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
  }, [socket, selfId, iceServers, inMesh, tableId]);

  useEffect(() => {
    mesh?.setLocalStream(localStream);
  }, [mesh, localStream]);

  const targetsKey = useMemo(() => {
    if (!state) return '';
    const players = state.seats
      .filter((p) => p && p.userId !== selfId && p.connected && p.rtcEpoch && !p.isBot)
      .map((p) => `${p!.userId}:${p!.rtcEpoch}`);
    // Seated players also send their video to spectators; spectators only connect to players.
    const watchers = seated
      ? state.spectators.filter((x) => x.rtcEpoch && x.userId !== selfId).map((x) => `${x.userId}:${x.rtcEpoch}`)
      : [];
    return [...players, ...watchers].sort().join(',');
  }, [state, selfId, seated]);

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
