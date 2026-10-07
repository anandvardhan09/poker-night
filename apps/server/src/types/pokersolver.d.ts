declare module 'pokersolver' {
  export class Hand {
    static solve(cards: string[], game?: string, canDisqualify?: boolean): Hand;
    static winners(hands: Hand[]): Hand[];
    name: string;
    descr: string;
    rank: number;
    cards: unknown[];
  }
  const pokersolver: { Hand: typeof Hand };
  export default pokersolver;
}
