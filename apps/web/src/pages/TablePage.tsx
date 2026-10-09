import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ChatMessage, JoinTableData, PlayerAction, TableState } from '@pk/shared';
import { ActionBar } from '../components/ActionBar';
import { BuyInDialog } from '../components/BuyInDialog';
import { Header } from '../components/Header';
import { PokerTable } from '../components/PokerTable';
import { SidePanel } from '../components/SidePanel';
import { chips } from '../lib/format';
import { rpc, useSocket } from '../lib/socket';
import { useNow } from '../lib/useNow';
import { useLocalMedia } from '../rtc/useLocalMedia';
import { useMesh } from '../rtc/useMesh';

type Dialog = { kind: 'sit'; seatNo: number } | { kind: 'rebuy' } | null;

export function TablePage() {
  const { id: tableId = '' } = useParams();
  const navigate = useNavigate();
  const { socket, connected, profile } = useSocket();
  const [state, setState] = useState<TableState | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [kickTarget, setKickTarget] = useState<{ userId: string; name: string } | null>(null);
  const [kickError, setKickError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const clockOffset = useRef(0);

  const myUserId = profile?.id ?? null;
  const mySeat = state?.mySeat ?? null;
  const me = mySeat !== null ? state?.seats[mySeat] ?? null : null;

  // Join (and re-join after every reconnect) so the server restores our seat and cards.
  useEffect(() => {
    if (!socket || !connected || !tableId) return;
    const onState = (s: TableState) => {
      if (s.id !== tableId) return;
      clockOffset.current = s.serverTime - Date.now();
      setState(s);
    };
    const onChat = (m: ChatMessage & { tableId: string }) => {
      if (m.tableId === tableId) setChat((c) => [...c.slice(-99), m]);
    };
    const onKicked = (payload: { tableId: string; reason?: string }) => {
      if (payload.tableId === tableId) {
        alert(payload.reason || 'You were kicked from this table by the host');
        navigate('/');
      }
    };
    socket.on('table:state', onState);
    socket.on('chat:message', onChat);
    socket.on('table:kicked', onKicked);
    rpc<JoinTableData>(socket, 'table:join', { tableId })
      .then((d) => {
        onState(d.state);
        setChat(d.chat);
        setNotFound(false);
      })
      .catch((e: Error) => (e.message === 'Table not found' ? setNotFound(true) : setError(e.message)));
    return () => {
      socket.off('table:state', onState);
      socket.off('chat:message', onChat);
      socket.off('table:kicked', onKicked);
      if (socket.connected) socket.emit('table:leave', { tableId });
    };
  }, [socket, connected, tableId, navigate]);

  const media = useLocalMedia(mySeat !== null);
  const streams = useMesh(socket, tableId, myUserId, state, media.stream);

  // Tell others whether our camera / mic are on (re-sent after reconnects and re-seating).
  const epoch = me?.rtcEpoch ?? 0;
  useEffect(() => {
    if (!socket || !connected || mySeat === null) return;
    socket.emit('rtc:media', { tableId, camOn: media.camOn, micOn: media.micOn });
  }, [socket, connected, tableId, mySeat, epoch, media.camOn, media.micOn]);

  const ticking = !!state && (state.toAct !== null || state.nextHandAt !== null);
  const now = useNow(ticking) + clockOffset.current;

  const command = useCallback(
    async (event: Parameters<typeof rpc>[1], payload: object) => {
      if (!socket) return;
      setBusy(true);
      setError(null);
      try {
        await rpc(socket, event, { tableId, ...payload });
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [socket, tableId],
  );

  const act = (action: PlayerAction) => void command('table:action', { action }).catch(() => undefined);

  const confirmDialog = async (amount: number) => {
    if (!dialog) return;
    setDialogError(null);
    try {
      if (dialog.kind === 'sit') await command('table:sit', { seatNo: dialog.seatNo, buyIn: amount });
      else await command('table:rebuy', { amount });
      setDialog(null);
    } catch (e) {
      setDialogError((e as Error).message);
    }
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (notFound) {
    return (
      <div className="flex h-full flex-col">
        <Header />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-zinc-400">
          <p>This table doesn't exist.</p>
          <Link to="/" className="text-amber-300 hover:underline">
            Back to lobby
          </Link>
        </div>
      </div>
    );
  }

  const inHand = !!me?.inHand && state?.street !== 'waiting' && state?.street !== 'showdown';
  const isHost = myUserId !== null && state?.hostId === myUserId;

  return (
    <div className="flex min-h-full flex-col">
      <Header>
        {state && (
          <>
            <span className="font-semibold">{state.name}</span>
            {isHost && (
              <span className="rounded bg-amber-400/20 px-2 py-0.5 text-xs font-semibold text-amber-300">
                👑 Host
              </span>
            )}
            <span className="text-sm text-zinc-400">
              Blinds {chips(state.smallBlind)}/{chips(state.bigBlind)} · Hand #{state.handNo}
            </span>
            <button onClick={copyLink} className="rounded bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700">
              {copied ? 'Link copied!' : 'Copy invite link'}
            </button>
          </>
        )}
      </Header>

      {!connected && state && (
        <div className="bg-amber-500/15 py-1 text-center text-sm text-amber-200">
          Connection lost, reconnecting… your seat is saved.
        </div>
      )}

      <main className="flex flex-1 flex-col gap-4 p-4 lg:flex-row">
        <div className="flex flex-1 flex-col gap-4">
          {state ? (
            <PokerTable
              state={state}
              myUserId={myUserId}
              streams={streams}
              local={media}
              now={now}
              canSit={mySeat === null && connected}
              onSit={(seatNo) => {
                setDialogError(null);
                setDialog({ kind: 'sit', seatNo });
              }}
              onKick={(userId, name) => {
                setKickError(null);
                setKickTarget({ userId, name });
              }}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-zinc-500">Joining table…</div>
          )}

          <div className="flex min-h-14 flex-col items-center gap-3">
            {state?.legal && <ActionBar state={state} onAct={act} busy={busy} />}
            {error && <p className="text-sm text-red-400">{error}</p>}
            {me && (
              <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
                <button
                  onClick={media.toggleMic}
                  disabled={!media.stream?.getAudioTracks().length}
                  className="rounded-lg bg-zinc-800 px-3 py-1.5 hover:bg-zinc-700 disabled:opacity-40"
                >
                  {media.micOn ? '🎙️ Mute' : '🔇 Unmute'}
                </button>
                <button
                  onClick={media.toggleCam}
                  disabled={!media.stream?.getVideoTracks().length}
                  className="rounded-lg bg-zinc-800 px-3 py-1.5 hover:bg-zinc-700 disabled:opacity-40"
                >
                  {media.camOn ? '📷 Camera off' : '📷 Camera on'}
                </button>
                {media.error && <span className="text-xs text-amber-300">{media.error}</span>}
                <span className="mx-2 h-5 w-px bg-white/10" />
                <button
                  onClick={() =>
                    void command('table:sitOut', { sittingOut: me.status !== 'sitting_out' }).catch(() => undefined)
                  }
                  className="rounded-lg bg-zinc-800 px-3 py-1.5 hover:bg-zinc-700"
                >
                  {me.status === 'sitting_out' ? "I'm back" : 'Sit out next hand'}
                </button>
                <button
                  disabled={inHand}
                  onClick={() => {
                    setDialogError(null);
                    setDialog({ kind: 'rebuy' });
                  }}
                  className="rounded-lg bg-zinc-800 px-3 py-1.5 hover:bg-zinc-700 disabled:opacity-40"
                >
                  Add chips
                </button>
                <button
                  onClick={() => void command('table:stand', {}).catch(() => undefined)}
                  className="rounded-lg bg-zinc-800 px-3 py-1.5 text-red-300 hover:bg-zinc-700"
                >
                  {inHand ? 'Fold & leave' : 'Stand up'}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="lg:w-80">
          <SidePanel
            chat={chat}
            log={state?.log ?? []}
            myUserId={myUserId}
            isHost={isHost}
            onSend={(text) => socket?.emit('chat:send', { tableId, text })}
            onKick={(userId, name) => {
              setKickError(null);
              setKickTarget({ userId, name });
            }}
          />
        </div>
      </main>

      {dialog && state && profile && (
        <BuyInDialog
          title={dialog.kind === 'sit' ? `Sit at seat ${dialog.seatNo + 1}` : 'Add chips'}
          bigBlind={state.bigBlind}
          balance={profile.chipBalance}
          currentStack={dialog.kind === 'rebuy' ? me?.stack ?? 0 : 0}
          error={dialogError}
          onCancel={() => setDialog(null)}
          onConfirm={confirmDialog}
        />
      )}

      {kickTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setKickTarget(null)}
        >
          <div
            className="w-full max-w-sm space-y-4 rounded-2xl border border-white/10 bg-zinc-900 p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-white">Kick Player</h2>
            <p className="text-sm text-zinc-300">
              Are you sure you want to kick <span className="font-bold text-amber-300">{kickTarget.name}</span> from this table?
            </p>
            {kickError && <p className="text-sm text-red-400">{kickError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setKickTarget(null)}
                className="rounded-lg px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setKickError(null);
                  try {
                    await command('table:kick', { targetUserId: kickTarget.userId });
                    setKickTarget(null);
                  } catch (e) {
                    setKickError((e as Error).message);
                  }
                }}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-40 transition"
              >
                Kick
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
