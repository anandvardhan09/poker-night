import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type {
  ChatMessage,
  HandHistoryEntry,
  HostOp,
  JoinTableData,
  PlayerAction,
  PreAction,
  PublicSeat,
  Reaction,
  SessionEntry,
  TableState,
} from '@pk/shared';
import { ActionBar } from '../components/ActionBar';
import { BuyInDialog } from '../components/BuyInDialog';
import { Header } from '../components/Header';
import { HostPanel } from '../components/HostPanel';
import { InviteFriends } from '../components/InviteFriends';
import { Modal, Toggle } from '../components/Modal';
import { PlayerCard } from '../components/PlayerCard';
import { PokerTable } from '../components/PokerTable';
import { PreActionBar } from '../components/PreActionBar';
import { ReactionBar } from '../components/ReactionBar';
import { SessionResults } from '../components/SessionResults';
import { SidePanel } from '../components/SidePanel';
import { TournamentBanner } from '../components/TournamentBanner';
import { chips } from '../lib/format';
import { rpc, useSocket } from '../lib/socket';
import { flashTitle, isMuted, onMutedChange, setMuted, sounds } from '../lib/sound';
import { useNow } from '../lib/useNow';
import { useLocalMedia } from '../rtc/useLocalMedia';
import { useMesh } from '../rtc/useMesh';

type Dialog =
  | { kind: 'sit'; seatNo: number }
  | { kind: 'register'; seatNo: number }
  | { kind: 'rebuy' }
  | { kind: 'host' }
  | { kind: 'invite' }
  | { kind: 'session' }
  | { kind: 'player'; seat: PublicSeat }
  | null;

const BETTING = ['preflop', 'flop', 'turn', 'river'];
const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function TablePage() {
  const { id: tableId = '' } = useParams();
  const navigate = useNavigate();
  const { socket, connected, profile } = useSocket();
  const [state, setState] = useState<TableState | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [joinAttempt, setJoinAttempt] = useState(0);
  const password = useRef<string | undefined>(undefined);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [kickTarget, setKickTarget] = useState<{ userId: string; name: string } | null>(null);
  const [kickError, setKickError] = useState<string | null>(null);
  const [closedSession, setClosedSession] = useState<SessionEntry[] | null>(null);
  const [reactions, setReactions] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [muted, setMutedState] = useState(isMuted());
  const clockOffset = useRef(0);

  const myUserId = profile?.id ?? null;
  const mySeat = state?.mySeat ?? null;
  const me = mySeat !== null ? state?.seats[mySeat] ?? null : null;

  useEffect(() => onMutedChange(setMutedState), []);

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
    const onReaction = (r: Reaction) => {
      if (r.tableId !== tableId) return;
      setReactions((m) => new Map(m).set(r.userId, `${r.emoji}:${r.ts}`));
      setTimeout(
        () =>
          setReactions((m) => {
            if (m.get(r.userId) !== `${r.emoji}:${r.ts}`) return m;
            const next = new Map(m);
            next.delete(r.userId);
            return next;
          }),
        2_500,
      );
    };
    const onClosed = (p: { tableId: string; session: SessionEntry[] }) => {
      if (p.tableId === tableId) setClosedSession(p.session);
    };
    socket.on('table:state', onState);
    socket.on('chat:message', onChat);
    socket.on('table:kicked', onKicked);
    socket.on('table:reaction', onReaction);
    socket.on('table:closed', onClosed);
    rpc<JoinTableData>(socket, 'table:join', { tableId, password: password.current })
      .then((d) => {
        onState(d.state);
        setChat(d.chat);
        setNotFound(false);
        setNeedsPassword(false);
      })
      .catch((e: Error) => {
        if (e.message === 'Table not found') setNotFound(true);
        else if (e.message === 'PASSWORD_REQUIRED') setNeedsPassword(true);
        else if (e.message === 'Wrong password') {
          setNeedsPassword(true);
          setPasswordError('Wrong password');
        } else setError(e.message);
      });
    return () => {
      socket.off('table:state', onState);
      socket.off('chat:message', onChat);
      socket.off('table:kicked', onKicked);
      socket.off('table:reaction', onReaction);
      socket.off('table:closed', onClosed);
      if (socket.connected) socket.emit('table:leave', { tableId });
    };
  }, [socket, connected, tableId, navigate, joinAttempt]);

  // Sounds and the tab alert, driven by what changed since the last state.
  const prev = useRef<TableState | null>(null);
  useEffect(() => {
    const p = prev.current;
    prev.current = state;
    if (!state || !p || p.id !== state.id) return;
    if (state.mySeat !== null && state.toAct === state.mySeat && p.toAct !== state.mySeat) {
      sounds.turn();
      flashTitle('🔔 Your turn!');
    }
    if (state.handNo !== p.handNo || state.board.length > p.board.length) sounds.card();
    let bet = false;
    let checked = false;
    let folded = false;
    state.seats.forEach((s, i) => {
      const o = p.seats[i];
      if (!s || !o || s.userId !== o.userId) return;
      if (s.bet > o.bet && state.handNo === p.handNo) bet = true;
      if (s.lastAction !== o.lastAction && s.lastAction === 'Check') checked = true;
      if (s.folded && !o.folded) folded = true;
    });
    if (bet) sounds.chips();
    else if (checked) sounds.check();
    else if (folded) sounds.fold();
    if (state.result && !p.result && state.result.winners.some((w) => w.userId === myUserId)) sounds.win();
  }, [state, myUserId]);

  const media = useLocalMedia(mySeat !== null);
  const streams = useMesh(socket, tableId, myUserId, state, media.stream);

  // Tell others whether our camera / mic are on (re-sent after reconnects and re-seating).
  const epoch = me?.rtcEpoch ?? 0;
  useEffect(() => {
    if (!socket || !connected || mySeat === null) return;
    socket.emit('rtc:media', { tableId, camOn: media.camOn, micOn: media.micOn });
  }, [socket, connected, tableId, mySeat, epoch, media.camOn, media.micOn]);

  const ticking = !!state && (state.toAct !== null || state.nextHandAt !== null || state.blinds.nextLevelAt !== null);
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
  const quiet = (p: Promise<unknown>) => void p.catch(() => undefined);

  const act = (action: PlayerAction) => quiet(command('table:action', { action }));
  const hostOp = async (op: HostOp) => {
    if (!socket) return;
    await rpc(socket, 'table:host', { tableId, op });
  };
  const loadHistory = useCallback(
    () =>
      socket
        ? rpc<HandHistoryEntry[]>(socket, 'table:history', { tableId, limit: 30 })
        : Promise.resolve([] as HandHistoryEntry[]),
    [socket, tableId],
  );

  const confirmDialog = async (amount: number) => {
    if (!dialog) return;
    setDialogError(null);
    try {
      if (dialog.kind === 'sit') await command('table:sit', { seatNo: dialog.seatNo, buyIn: amount });
      else if (dialog.kind === 'register') await command('table:sit', { seatNo: dialog.seatNo, buyIn: 0 });
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

  const submitPassword = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = String(new FormData(e.currentTarget).get('password') ?? '');
    password.current = value;
    setPasswordError(null);
    setJoinAttempt((n) => n + 1);
  };

  if (notFound) {
    return (
      <div className="flex h-full flex-col">
        <Header />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-zinc-400">
          <p>This table doesn't exist or has closed.</p>
          <Link to="/" className="text-amber-300 hover:underline">
            Back to lobby
          </Link>
        </div>
      </div>
    );
  }

  if (needsPassword) {
    return (
      <div className="flex h-full flex-col">
        <Header />
        <form onSubmit={submitPassword} className="mx-auto mt-24 w-full max-w-sm space-y-3 rounded-2xl border border-white/10 bg-zinc-900 p-6">
          <h2 className="text-lg font-semibold">🔒 This table has a password</h2>
          <input name="password" type="password" autoFocus placeholder="Password" className="input" />
          {passwordError && <p className="text-sm text-red-400">{passwordError}</p>}
          <div className="flex justify-between">
            <Link to="/" className="py-2 text-sm text-zinc-400 hover:text-white">
              Back
            </Link>
            <button className="rounded-lg bg-amber-500 px-4 py-2 font-semibold text-zinc-950 hover:bg-amber-400">Join</button>
          </div>
        </form>
      </div>
    );
  }

  const inHand = !!me?.inHand && !!state && BETTING.includes(state.street);
  const isHost = myUserId !== null && state?.hostId === myUserId;
  const sng = state?.settings.mode === 'sng';
  const tournamentOpen = !sng || state?.tournament?.status === 'registering';
  const full = !!state && state.seats.every(Boolean);
  const onWaitlist = !!state?.waitlist.some((w) => w.userId === myUserId);
  const watching = state?.spectators.length ?? 0;
  const lv = state?.blinds;

  return (
    <div className="flex min-h-full flex-col">
      <Header>
        {state && (
          <>
            <span className="font-semibold">{state.name}</span>
            {isHost && (
              <span className="rounded bg-amber-400/20 px-2 py-0.5 text-xs font-semibold text-amber-300">👑 Host</span>
            )}
            <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
              {state.settings.variant === 'omaha' ? 'PLO' : "Hold'em"}
              {sng ? ' · Sit & Go' : ''}
            </span>
            <span className="text-sm text-zinc-400">
              Blinds {chips(state.smallBlind)}/{chips(state.bigBlind)}
              {lv && lv.nextLevelAt !== null && (
                <>
                  {' '}
                  · Lvl {lv.level + 1} · next {chips(lv.nextSmallBlind!)}/{chips(lv.nextBigBlind!)} in{' '}
                  <span className="font-mono text-zinc-200">{fmtClock(lv.nextLevelAt - now)}</span>
                </>
              )}{' '}
              · Hand #{state.handNo}
            </span>
            {watching > 0 && (
              <span className="text-xs text-zinc-400" title={state.spectators.map((s) => s.name).join(', ')}>
                👀 {watching} watching
              </span>
            )}
            <button onClick={copyLink} className="rounded bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700">
              {copied ? 'Link copied!' : 'Copy invite link'}
            </button>
            <button onClick={() => setDialog({ kind: 'invite' })} className="rounded bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700">
              Invite friends
            </button>
            <button onClick={() => setDialog({ kind: 'session' })} className="rounded bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700">
              Session results
            </button>
            {isHost && (
              <button
                onClick={() => setDialog({ kind: 'host' })}
                className="rounded bg-amber-500/90 px-2 py-1 text-xs font-semibold text-zinc-950 hover:bg-amber-400"
              >
                ⚙ Host controls
              </button>
            )}
            <button
              onClick={() => setMuted(!muted)}
              className="rounded bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700"
              title={muted ? 'Turn sounds on' : 'Turn sounds off'}
            >
              {muted ? '🔕' : '🔔'}
            </button>
          </>
        )}
      </Header>

      {!connected && state && (
        <div className="bg-amber-500/15 py-1 text-center text-sm text-amber-200">Connection lost, reconnecting… your seat is saved.</div>
      )}
      {state?.paused && (
        <div className="bg-amber-500/15 py-1 text-center text-sm text-amber-200">
          ⏸ The host paused the game. {BETTING.includes(state.street) ? 'This hand will finish first.' : ''}
        </div>
      )}

      <main className="flex flex-1 flex-col gap-4 p-4 lg:flex-row">
        <div className="flex flex-1 flex-col gap-3">
          {state && <TournamentBanner state={state} isHost={isHost} onStart={() => quiet(command('table:host', { op: { type: 'startTournament' } }))} />}
          {state ? (
            <PokerTable
              state={state}
              myUserId={myUserId}
              streams={streams}
              local={media}
              now={now}
              canSit={mySeat === null && connected && tournamentOpen}
              onSit={(seatNo) => {
                setDialogError(null);
                setDialog({ kind: sng ? 'register' : 'sit', seatNo });
              }}
              onOpenSeat={(seat) => setDialog({ kind: 'player', seat })}
              reactions={reactions}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-zinc-500">Joining table…</div>
          )}

          <div className="flex min-h-14 flex-col items-center gap-3">
            {state?.legal && <ActionBar state={state} onAct={act} onTimeBank={() => quiet(command('table:timeBank', {}))} busy={busy} />}
            {state && (
              <PreActionBar state={state} onChange={(preAction: PreAction | null) => quiet(command('table:preAction', { preAction }))} />
            )}
            {state?.canShowCards && (
              <button
                onClick={() => quiet(command('table:showCards', {}))}
                className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold hover:bg-emerald-500"
              >
                👀 Show my cards
              </button>
            )}
            {error && <p className="text-sm text-red-400">{error}</p>}

            {state && mySeat === null && !sng && full && (
              <button
                onClick={() => quiet(command('table:waitlist', { join: !onWaitlist }))}
                className="rounded-lg bg-zinc-800 px-4 py-1.5 text-sm hover:bg-zinc-700"
              >
                {onWaitlist
                  ? `On the waitlist (#${state.waitlist.findIndex((w) => w.userId === myUserId) + 1}) · Leave`
                  : `Join waitlist${state.waitlist.length ? ` (${state.waitlist.length} waiting)` : ''}`}
              </button>
            )}
            {state && mySeat === null && (
              <p className="text-xs text-zinc-500">
                You're watching.{' '}
                {state.spectators.find((s) => s.userId === myUserId)?.rtcEpoch ? 'You can see and hear the players.' : ''}
              </p>
            )}

            {me && state && (
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
                  onClick={() => quiet(command('table:sitOut', { sittingOut: me.status !== 'sitting_out' }))}
                  className="rounded-lg bg-zinc-800 px-3 py-1.5 hover:bg-zinc-700"
                >
                  {me.status === 'sitting_out' ? "I'm back" : 'Sit out next hand'}
                </button>
                {!sng && (
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
                )}
                <button
                  onClick={() => {
                    if (sng && state.tournament?.status === 'running' && !confirm('Leave the tournament? You will be knocked out.')) return;
                    quiet(command('table:stand', {}));
                  }}
                  className="rounded-lg bg-zinc-800 px-3 py-1.5 text-red-300 hover:bg-zinc-700"
                >
                  {sng && state.tournament?.status === 'running' ? 'Leave tournament' : inHand ? 'Fold & leave' : sng ? 'Unregister' : 'Stand up'}
                </button>
              </div>
            )}

            {me && state && (state.settings.straddle || state.settings.runItTwice) && (
              <div className="flex flex-wrap items-center justify-center gap-4 text-sm">
                {state.settings.straddle && !sng && (
                  <Toggle
                    label="Straddle when I'm UTG"
                    checked={me.wantsStraddle}
                    onChange={(v) => quiet(command('table:prefs', { wantsStraddle: v }))}
                  />
                )}
                {state.settings.runItTwice && (
                  <Toggle
                    label="Run it twice when all-in"
                    checked={me.ritOptIn}
                    onChange={(v) => quiet(command('table:prefs', { ritOptIn: v }))}
                  />
                )}
              </div>
            )}

            {state && <ReactionBar onReact={(emoji) => socket?.emit('table:react', { tableId, emoji })} />}
          </div>
        </div>

        <div className="lg:h-[calc(100vh-6rem)] lg:w-80">
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
            loadHistory={loadHistory}
            handNo={state?.result ? state.handNo : (state?.handNo ?? 1) - 1}
          />
        </div>
      </main>

      {(dialog?.kind === 'sit' || dialog?.kind === 'rebuy') && state && profile && (
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

      {dialog?.kind === 'register' && state && profile && (
        <Modal title={`Register in seat ${dialog.seatNo + 1}`} onClose={() => setDialog(null)}>
          <div className="space-y-3 text-sm">
            <p className="text-zinc-300">
              Buy-in <b className="text-amber-300">{chips(state.settings.sngBuyIn)}</b> chips for a starting stack of{' '}
              <b>{chips(state.settings.sngStartingStack)}</b>. No rebuys.
            </p>
            <p className="text-zinc-500">Your balance: {chips(profile.chipBalance)}</p>
            {dialogError && <p className="text-red-400">{dialogError}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setDialog(null)} className="rounded-lg px-4 py-2 text-zinc-300 hover:bg-zinc-800">
                Cancel
              </button>
              <button
                disabled={profile.chipBalance < state.settings.sngBuyIn}
                onClick={() => confirmDialog(0)}
                className="rounded-lg bg-amber-500 px-4 py-2 font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
              >
                Register
              </button>
            </div>
          </div>
        </Modal>
      )}

      {dialog?.kind === 'host' && state && <HostPanel state={state} onOp={hostOp} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'invite' && <InviteFriends tableId={tableId} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'session' && state && (
        <SessionResults tableName={state.name} entries={state.session} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'player' && state && (
        <PlayerCard
          userId={dialog.seat.userId}
          name={dialog.seat.name}
          avatarUrl={dialog.seat.avatarUrl}
          isBot={dialog.seat.isBot}
          canKick={isHost && !dialog.seat.isBot}
          onKick={() => {
            setKickError(null);
            setKickTarget({ userId: dialog.seat.userId, name: dialog.seat.name });
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {closedSession && state && (
        <SessionResults tableName={state.name} entries={closedSession} final onClose={() => navigate('/')} />
      )}

      {kickTarget && (
        <Modal title="Kick player" onClose={() => setKickTarget(null)}>
          <p className="text-sm text-zinc-300">
            Kick <span className="font-bold text-amber-300">{kickTarget.name}</span> from this table? They won't be able to come
            back.
          </p>
          {kickError && <p className="mt-2 text-sm text-red-400">{kickError}</p>}
          <div className="flex justify-end gap-2 pt-4">
            <button onClick={() => setKickTarget(null)} className="rounded-lg px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
              Cancel
            </button>
            <button
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
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-40"
            >
              Kick
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
