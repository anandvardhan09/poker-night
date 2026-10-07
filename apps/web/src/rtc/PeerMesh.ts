import type { RtcSignalData, RtcSignalIn } from '@pk/shared';

export interface PeerTarget {
  userId: string;
  epoch: number;
}

interface Peer {
  userId: string;
  epoch: number;
  /** Id of our RTCPeerConnection and of the remote one we're paired with. */
  cid: string;
  remoteCid: string | null;
  pc: RTCPeerConnection;
  /** The impolite peer (lower user id) initiates; the polite one waits and yields on collisions. */
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  stream: MediaStream | null;
  watchdog: ReturnType<typeof setInterval>;
}

type Send = (to: string, toEpoch: number, fromEpoch: number, data: RtcSignalData) => void;

const RETRY_MS = 8_000;

/**
 * Full-mesh WebRTC between seated players. Each pair has one RTCPeerConnection with one audio
 * and one video transceiver; local tracks are swapped with replaceTrack so toggling devices
 * never needs renegotiation.
 */
export class PeerMesh {
  private peers = new Map<string, Peer>();
  private local: MediaStream | null = null;
  private selfEpoch = 0;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(
    private selfId: string,
    private iceServers: RTCIceServer[],
    private send: Send,
    private onChange: (streams: Map<string, MediaStream>) => void,
  ) {}

  streams(): Map<string, MediaStream> {
    const m = new Map<string, MediaStream>();
    for (const p of this.peers.values()) if (p.stream) m.set(p.userId, p.stream);
    return m;
  }

  private emitChange() {
    if (!this.closed) this.onChange(this.streams());
  }

  setSelfEpoch(epoch: number) {
    if (epoch === this.selfEpoch) return;
    this.selfEpoch = epoch;
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.emitChange();
  }

  setLocalStream(stream: MediaStream | null) {
    this.local = stream;
    for (const p of this.peers.values()) this.applyLocal(p);
  }

  /** Brings connections in line with the currently connected, seated players. */
  sync(targets: PeerTarget[]) {
    if (!this.selfEpoch) return;
    const wanted = new Map(targets.map((t) => [t.userId, t.epoch]));
    let changed = false;
    for (const [id, peer] of this.peers) {
      const epoch = wanted.get(id);
      if (epoch === undefined || epoch > peer.epoch) {
        this.closePeer(id);
        changed = true;
      }
    }
    for (const t of targets) {
      if (!this.peers.has(t.userId) && t.epoch) this.create(t.userId, t.epoch, true);
    }
    if (changed) this.emitChange();
  }

  handleSignal(msg: RtcSignalIn) {
    this.queue = this.queue.then(() => this.process(msg)).catch((e) => console.warn('[rtc]', e));
  }

  close() {
    this.closed = true;
    for (const id of [...this.peers.keys()]) this.closePeer(id);
  }

  // ---------- internals ----------

  private async process({ from, fromEpoch, toEpoch, data }: RtcSignalIn) {
    if (this.closed || toEpoch !== this.selfEpoch) return;
    let peer = this.peers.get(from);
    if (peer && peer.epoch > fromEpoch) return;
    let fresh = false;
    if (!peer || peer.epoch < fromEpoch) {
      if (peer) this.closePeer(from);
      peer = this.create(from, fromEpoch, false);
      fresh = true;
    }

    if (data.hello) {
      if (peer.polite) return;
      const healthy = peer.remoteCid === data.cid && peer.pc.connectionState === 'connected';
      if (!fresh && !healthy) this.recreate(peer);
      return;
    }

    if (data.description) {
      const desc = data.description as RTCSessionDescriptionInit;
      if (desc.type === 'offer') {
        if (peer.polite) {
          // A new initiator connection replaces whatever we had with this player.
          if (peer.remoteCid && peer.remoteCid !== data.cid) peer = this.recreate(peer, false);
        } else if (data.rcid !== peer.cid) {
          return;
        }
        peer.remoteCid = data.cid;
      } else {
        if (data.rcid !== peer.cid) return;
        peer.remoteCid = data.cid;
      }

      const pc = peer.pc;
      const collision = desc.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
      peer.ignoreOffer = !peer.polite && collision;
      if (peer.ignoreOffer) return;
      await pc.setRemoteDescription(desc);
      if (desc.type === 'offer') {
        this.applyLocal(peer);
        await pc.setLocalDescription();
        this.signal(peer, { description: pc.localDescription!.toJSON() });
      }
    } else if (data.candidate && data.cid === peer.remoteCid) {
      try {
        await peer.pc.addIceCandidate(data.candidate);
      } catch (e) {
        if (!peer.ignoreOffer) console.warn('[rtc] candidate', e);
      }
    }
  }

  private signal(peer: Peer, data: Omit<RtcSignalData, 'cid' | 'rcid'>) {
    this.send(peer.userId, peer.epoch, this.selfEpoch, {
      ...data,
      cid: peer.cid,
      rcid: peer.remoteCid ?? undefined,
    });
  }

  private recreate(peer: Peer, announce = true): Peer {
    this.closePeer(peer.userId);
    const next = this.create(peer.userId, peer.epoch, announce);
    this.emitChange();
    return next;
  }

  private create(userId: string, epoch: number, announce: boolean): Peer {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer: Peer = {
      userId,
      epoch,
      cid: crypto.randomUUID(),
      remoteCid: null,
      pc,
      polite: this.selfId > userId,
      makingOffer: false,
      ignoreOffer: false,
      stream: null,
      watchdog: setInterval(() => {
        if (pc.connectionState === 'connected' || this.peers.get(userId) !== peer) return;
        if (peer.polite) this.signal(peer, { hello: true });
        else this.recreate(peer);
      }, RETRY_MS),
    };
    this.peers.set(userId, peer);

    pc.ontrack = ({ track }) => {
      const others = peer.stream?.getTracks().filter((t) => t.kind !== track.kind) ?? [];
      peer.stream = new MediaStream([...others, track]);
      track.onunmute = () => this.emitChange();
      this.emitChange();
    };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.signal(peer, { candidate: candidate.toJSON() });
    };
    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.signal(peer, { description: pc.localDescription!.toJSON() });
      } catch (e) {
        console.warn('[rtc] negotiation', e);
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' && !peer.polite) pc.restartIce();
    };

    if (!peer.polite) {
      pc.addTransceiver('audio', { direction: 'sendrecv' });
      pc.addTransceiver('video', { direction: 'sendrecv' });
      this.applyLocal(peer);
    } else if (announce) {
      this.signal(peer, { hello: true });
    }
    return peer;
  }

  private applyLocal(peer: Peer) {
    for (const t of peer.pc.getTransceivers()) {
      if (t.currentDirection === 'stopped') continue;
      const kind = t.receiver.track.kind;
      const track = this.local?.getTracks().find((x) => x.kind === kind) ?? null;
      if (t.sender.track !== track) t.sender.replaceTrack(track).catch(() => undefined);
      if (t.direction === 'recvonly' || t.direction === 'inactive') t.direction = 'sendrecv';
    }
  }

  private closePeer(userId: string) {
    const peer = this.peers.get(userId);
    if (!peer) return;
    clearInterval(peer.watchdog);
    peer.pc.ontrack = null;
    peer.pc.onicecandidate = null;
    peer.pc.onnegotiationneeded = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    this.peers.delete(userId);
  }
}
