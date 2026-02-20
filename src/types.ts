export interface Point {
    x: number;
    y: number;
}

export interface Player {
    id: string;       // socket.id (ephemeral)
    userId: string;   // persistent user ID
    score: number;
}

export interface Room {
    id: string;
    mode: 'solo' | 'multiplayer';
    players: Player[];
    currentTurn: string;   // userId of current player
    round: number;
    maxRounds: number;
    wind: Point;
    // Timed solo fields
    timeLimit: number;      // total seconds (60 for solo, 0 for multiplayer)
    timeRemaining: number;  // seconds left
    startedAt: number;      // timestamp when game started
}
