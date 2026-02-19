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
}
