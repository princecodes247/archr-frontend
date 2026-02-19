export interface Point {
    x: number;
    y: number;
}

export interface Player {
    id: string;
    score: number;
}

export interface Room {
    id: string;
    mode: 'solo' | 'multiplayer';
    players: Player[];
    currentTurn: string;
    round: number;
    maxRounds: number;
    wind: Point;
    // Timed solo fields
    timeLimit: number;      // total seconds (60 for solo, 0 for multiplayer)
    timeRemaining: number;  // seconds left
    startedAt: number;      // timestamp when game started
}
