import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import type { Room } from '../types';

// const SOCKET_URL = 'http://192.168.1.184:3000';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000';

const STORAGE_KEY = 'archr_userId';

interface SocketState {
    socket: Socket | null;
    connected: boolean;
    room: Room | null;
    playerId: string | undefined;     // userId (persistent)
    playerName: string | undefined;   // auto-generated name
    finalScore: number | null;

    // Actions
    connect: () => void;
    disconnect: () => void;
    setRoom: (room: Room | null) => void;
    setFinalScore: (score: number | null) => void;
}

export const useSocketStore = create<SocketState>((set, get) => ({
    socket: null,
    connected: false,
    room: null,
    playerId: undefined,
    playerName: undefined,
    finalScore: null,

    connect: () => {
        // Prevent double-connect
        if (get().socket) return;

        console.log('Initializing socket connection to', SOCKET_URL);
        const newSocket = io(SOCKET_URL);

        newSocket.on('connect', () => {
            console.log('Socket connected:', newSocket.id);

            // Send stored userId (or nothing) for registration
            const storedUserId = localStorage.getItem(STORAGE_KEY) || undefined;

            newSocket.emit('register', { userId: storedUserId }, (response: { userId: string; name: string }) => {
                // Callback-based acknowledgment
                console.log('Registered with userId:', response.userId, 'name:', response.name);
                localStorage.setItem(STORAGE_KEY, response.userId);
                set({ connected: true, playerId: response.userId, playerName: response.name });
            });

            // Fallback: if server uses emit instead of callback
            newSocket.on('registered', (data: { userId: string; name: string }) => {
                console.log('Registered (event) with userId:', data.userId, 'name:', data.name);
                localStorage.setItem(STORAGE_KEY, data.userId);
                set({ connected: true, playerId: data.userId, playerName: data.name });
            });
        });

        newSocket.on('disconnect', () => {
            console.log('Socket disconnected');
            set({ connected: false });
        });

        // Solo timer updates
        newSocket.on('timerUpdate', (data: { timeRemaining: number }) => {
            const room = get().room;
            if (room) {
                set({ room: { ...room, timeRemaining: data.timeRemaining } });
            }
        });

        set({ socket: newSocket });
    },

    disconnect: () => {
        const { socket } = get();
        if (socket) {
            console.log('Cleaning up socket connection');
            socket.disconnect();
            set({ socket: null, connected: false });
        }
    },

    setRoom: (room) => set({ room }),
    setFinalScore: (finalScore) => set({ finalScore }),
}));
